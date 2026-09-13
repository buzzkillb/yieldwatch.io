import { db, schema } from '../db';
import { eq, desc, asc } from 'drizzle-orm';
import { fetchTreasuryYieldCurve } from './fetcher';
import {
  getRatesForDate,
  getPreviousBusinessDay,
  getDateMinusDays,
  getPreviousBusinessDayFromDate,
  getDayOfWeek,
  sleep,
  generateAndSaveSummaries,
} from './summaryService';
import { generateOgChart } from '../utils/ogChart';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const CHECK_INTERVAL_MS = (() => {
  const val = parseInt(process.env.SCHEDULER_CHECK_INTERVAL_MS || '900000', 10);
  if (isNaN(val) || val < 60000 || val > 3600000) {
    console.warn('[Scheduler] Invalid SCHEDULER_CHECK_INTERVAL_MS, using default 900000 (15min)');
    return 900000;
  }
  return val;
})();
const CRON_HOUR = parseInt(process.env.SCHEDULER_CRON_HOUR || '16', 10);
const CRON_MINUTE = parseInt(process.env.SCHEDULER_CRON_MINUTE || '30', 10);

const ARCHIVE_CSV_URLS = [
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rate-archives/par-yield-curve-rates-1990-2023.csv',
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2024/all?type=daily_treasury_yield_curve&field_tdr_date_value=2024&_format=csv',
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2025/all?type=daily_treasury_yield_curve&field_tdr_date_value=2025&_format=csv',
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&_format=csv',
];

const CSV_COLUMNS: Record<string, string> = {
  '1 MO': '4WK', '1MONTH': '4WK', '1 MONTH': '4WK', '1Mo': '4WK',
  '1.5 MO': '6WK', '1.5MONTH': '6WK', '1.5 MONTH': '6WK', '1.5Mo': '6WK', '1.5 Month': '6WK',
  '2 MO': '2MO', '2 MONTH': '2MO', '2Mo': '2MO',
  '3 MO': '3MO', '3 MONTH': '3MO', '3Mo': '3MO',
  '4 MO': '4MO', '4 MONTH': '4MO', '4Mo': '4MO',
  '6 MO': '6MO', '6 MONTH': '6MO', '6Mo': '6MO',
  '1 YR': '1YR', '1 YEAR': '1YR', '1Yr': '1YR',
  '2 YR': '2YR', '2 YEAR': '2YR', '2Yr': '2YR',
  '3 YR': '3YR', '3 YEAR': '3YR', '3Yr': '3YR',
  '5 YR': '5YR', '5 YEAR': '5YR', '5Yr': '5YR',
  '7 YR': '7YR', '7 YEAR': '7YR', '7Yr': '7YR',
  '10 YR': '10YR', '10 YEAR': '10YR', '10Yr': '10YR',
  '20 YR': '20YR', '20 YEAR': '20YR', '20Yr': '20YR',
  '30 YR': '30YR', '30 YEAR': '30YR', '30Yr': '30YR',
};

const KNOWN_MATURITY_KEYS = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];

async function generateDailySummary(targetDate?: string): Promise<void> {
  try {
    console.log('[Scheduler] Generating daily rate summaries with LLM gateway...');

    let todayDate: string;
    if (targetDate) {
      todayDate = targetDate;
    } else {
      const latestDateInDb = await db
        .select({ date: schema.yieldCurveRates.date })
        .from(schema.yieldCurveRates)
        .orderBy(desc(schema.yieldCurveRates.date))
        .limit(1);

      if (latestDateInDb.length === 0) {
        console.log('[Scheduler] No data in database for summary');
        return;
      }
      todayDate = latestDateInDb[0].date;
    }

    const { short: shortSummary, long: blogSummary } = await generateAndSaveSummaries(todayDate);

    if (!shortSummary) {
      console.log('[Scheduler] No short summary generated for', todayDate);
      return;
    }

    console.log(`[Scheduler] Daily summaries saved to database for ${todayDate}`);
    console.log(`[Scheduler] Short summary: ${shortSummary}`);
    if (blogSummary) {
      console.log(`[Scheduler] Blog summary: ${blogSummary.substring(0, 100)}...`);
    }

    const ogImageResult = await generateOgImageForDate(todayDate);
    if (!ogImageResult) {
      console.log("[Scheduler] WARNING: Failed to generate OG image for today's blog post");
    }

  } catch (error) {
    console.error('[Scheduler] Error generating daily summary:', error);
  }
}

function normalizeColumnName(col: string): string | null {
  const cleaned = col.trim();
  return CSV_COLUMNS[cleaned] || CSV_COLUMNS[cleaned.toUpperCase()] || null;
}

async function fetchAndImportHistorical(): Promise<boolean> {
  console.log('[Scheduler] Database is empty, starting historical data import...');
  console.log('[Scheduler] This may take several minutes...');
  
  let totalRecords = 0;
  
  for (const url of ARCHIVE_CSV_URLS) {
    try {
      console.log(`[Scheduler] Fetching ${url}`);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'TreasuryDashboard/1.0' },
      });
      
      if (!response.ok) {
        console.error(`[Scheduler] Failed to fetch CSV: ${response.status}`);
        continue;
      }
      
      const csv = await response.text();
      const data = parseCSV(csv);
      console.log(`[Scheduler] Parsed ${data.length} days from archive`);
      
      for (const day of data) {
        for (const { maturity, rate } of day.rates) {
          try {
            await db
              .insert(schema.yieldCurveRates)
              .values({
                date: day.date,
                maturity,
                rate: rate.toString(),
              })
              .onConflictDoUpdate({
                target: [schema.yieldCurveRates.date, schema.yieldCurveRates.maturity],
                set: { rate: rate.toString(), createdAt: new Date() },
              });
            totalRecords++;
          } catch (error: any) {
            if (error?.code !== '23505') {
              console.error(`[Scheduler] Error saving rate ${maturity} for ${day.date}:`, error);
            }
          }
        }
        
        if (totalRecords % 5000 === 0) {
          console.log(`[Scheduler] Imported ${totalRecords} records...`);
        }
      }
    } catch (error) {
      console.error(`[Scheduler] Error importing from ${url}:`, error);
    }
  }
  
  console.log(`[Scheduler] Historical import complete: ${totalRecords} records`);
  return totalRecords > 0;
}

function parseCSV(csv: string): { date: string; rates: { maturity: string; rate: number }[] }[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const columnMap: Record<string, string> = {};
  
  headers.forEach((header, index) => {
    const normalized = normalizeColumnName(header);
    if (normalized && !columnMap[normalized]) {
      columnMap[normalized] = String(index);
    }
  });
  
  const results: { date: string; rates: { maturity: string; rate: number }[] }[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;
    
    const dateIdx = columnMap['Date'] || '0';
    const dateValue = values[parseInt(dateIdx)];
    if (!dateValue) continue;
    
    const date = parseDate(dateValue);
    if (!date) continue;
    
    const rates: { maturity: string; rate: number }[] = [];
    
    for (const maturity of KNOWN_MATURITY_KEYS) {
      const colIdx = columnMap[maturity];
      if (colIdx) {
        const rateStr = values[parseInt(colIdx)];
        if (rateStr) {
          const rate = parseFloat(rateStr);
          if (!isNaN(rate)) {
            rates.push({ maturity, rate });
          }
        }
      }
    }
    
    if (rates.length > 0) {
      results.push({ date, rates });
    }
  }
  
  return results;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseDate(dateStr: string): string | null {
  const cleaned = dateStr.trim();
  const mmddyyyy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    const [, month, day, year] = mmddyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

function shouldRunNow(): boolean {
  const cronHour = CRON_HOUR;
  const cronMinute = CRON_MINUTE;
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.CRON_TZ || 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  
  if (isNaN(currentHour) || isNaN(currentMinute)) {
    return false;
  }
  
  if (currentHour > cronHour || (currentHour === cronHour && currentMinute >= cronMinute)) {
    return true;
  }
  return false;
}

async function isTodayDataExists(): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const result = await db
    .select()
    .from(schema.yieldCurveRates)
    .where(eq(schema.yieldCurveRates.date, today))
    .limit(1);
  return result.length > 0;
}

async function saveYieldData(data: Awaited<ReturnType<typeof fetchTreasuryYieldCurve>>): Promise<boolean> {
  if (!data.success || !data.data) return false;
  
  console.log(`[Scheduler] Saving yield curve data to database...`);
  
  for (const day of data.data) {
    for (const { maturity, rate } of day.rates) {
      try {
        await db
          .insert(schema.yieldCurveRates)
          .values({
            date: day.date,
            maturity,
            rate: rate.toString(),
          })
          .onConflictDoUpdate({
            target: [schema.yieldCurveRates.date, schema.yieldCurveRates.maturity],
            set: {
              rate: rate.toString(),
              createdAt: new Date(),
            },
          });
      } catch (error) {
        console.error(`[Scheduler] Error saving rate ${maturity} for ${day.date}:`, error);
      }
    }
  }
  
  if (data.yearHighLow) {
    for (const stat of data.yearHighLow) {
      try {
        await db
          .insert(schema.rateStats)
          .values({
            maturity: stat.maturity,
            yearHigh: stat.yearHigh.toString(),
            yearHighDate: stat.yearHighDate,
            yearLow: stat.yearLow.toString(),
            yearLowDate: stat.yearLowDate,
          })
          .onConflictDoUpdate({
            target: schema.rateStats.maturity,
            set: {
              yearHigh: stat.yearHigh.toString(),
              yearHighDate: stat.yearHighDate,
              yearLow: stat.yearLow.toString(),
              yearLowDate: stat.yearLowDate,
              updatedAt: new Date(),
            },
          });
      } catch (error) {
        console.error(`[Scheduler] Error saving stats for ${stat.maturity}:`, error);
      }
    }
  }
  
  console.log(`[Scheduler] Successfully saved yield curve data`);
  return true;
}

async function regenerateOgImage(): Promise<void> {
  try {
    console.log('[Scheduler] Regenerating OG image...');
    
    const latestData = await db
      .select()
      .from(schema.yieldCurveRates)
      .orderBy(desc(schema.yieldCurveRates.date), asc(schema.yieldCurveRates.maturity))
      .limit(14);

    if (latestData.length === 0) {
      console.log('[Scheduler] No data for OG image');
      return;
    }

    const latestDate = latestData[0].date;
    const rates = latestData
      .filter(r => r.date === latestDate)
      .map(r => ({ maturity: r.maturity, rate: parseFloat(r.rate) }));

    const pngBuffer = await generateOgChart(rates);

    const publicDir = join(process.cwd(), 'public');
    if (!existsSync(publicDir)) {
      mkdirSync(publicDir, { recursive: true });
    }

    const pngPath = join(publicDir, 'og.png');
    writeFileSync(pngPath, pngBuffer);
    
    console.log(`[Scheduler] OG image regenerated: ${pngPath}`);
  } catch (error) {
    console.error('[Scheduler] Error regenerating OG image:', error);
  }
}

async function generateOgImageForDate(date: string): Promise<string | null> {
  try {
    const data = await db
      .select()
      .from(schema.yieldCurveRates)
      .where(eq(schema.yieldCurveRates.date, date));

    if (data.length === 0) {
      console.log(`[Scheduler] No data for OG image for date: ${date}`);
      return null;
    }

    const rates = data.map(r => ({ maturity: r.maturity, rate: parseFloat(r.rate) }));
    const pngBuffer = await generateOgChart(rates);

    const publicDir = join(process.cwd(), 'public');
    const ogDir = join(publicDir, 'og');
    if (!existsSync(ogDir)) {
      mkdirSync(ogDir, { recursive: true });
    }

    const pngPath = join(ogDir, `${date}.png`);
    writeFileSync(pngPath, pngBuffer);
    
    const mainOgPath = join(ogDir, 'og.png');
    writeFileSync(mainOgPath, pngBuffer);
    
    console.log(`[Scheduler] OG image generated for ${date}: ${pngPath}`);
    return pngPath;
  } catch (error) {
    console.error(`[Scheduler] Error generating OG image for ${date}:`, error);
    return null;
  }
}

async function warmQueryCache(): Promise<void> {
  const apiHost = process.env.API_HOST || 'http://api:3000';

  const latestDateResult = await db
    .select({ date: schema.yieldCurveRates.date })
    .from(schema.yieldCurveRates)
    .orderBy(desc(schema.yieldCurveRates.date))
    .limit(1);

  if (latestDateResult.length === 0) {
    console.log('[Scheduler] No data in database yet, skipping cache warming');
    return;
  }

  const latestDate = latestDateResult[0].date;
  const today = new Date().toISOString().split('T')[0];
  const periods = [
    { from: getDateMonthsAgo(3), to: today, name: '3M' },
    { from: getDateMonthsAgo(6), to: today, name: '6M' },
    { from: getDateMonthsAgo(1), to: today, name: '1Y' },
    { from: getDateMonthsAgo(2), to: today, name: '2Y' },
    { from: getDateMonthsAgo(5), to: today, name: '5Y' },
    { from: '1990-01-01', to: today, name: 'ALL' },
  ];

  console.log('[Scheduler] Warming query cache...');
  for (const period of periods) {
    try {
      const url = `${apiHost}/api/rates/cache/warm?from=${period.from}&to=${period.to}`;
      const response = await fetch(url);
      const data = await response.json() as { success?: boolean; cacheKey?: string; error?: string };
      if (data.success) {
        console.log(`[Scheduler] Cache warmed for ${period.name}: ${data.cacheKey}`);
      } else {
        console.log(`[Scheduler] Cache warm failed for ${period.name}: ${data.error}`);
      }
    } catch (error) {
      console.error(`[Scheduler] Error warming cache for ${period.name}:`, error);
    }
  }
  console.log('[Scheduler] Query cache warming complete');
}

function getDateMonthsAgo(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().split('T')[0];
}

async function checkAndUpdate(): Promise<void> {
  console.log(`[Scheduler] Checking for updates at ${new Date().toISOString()}...`);
  
  const latestDateInDb = await db
    .select({ date: schema.yieldCurveRates.date })
    .from(schema.yieldCurveRates)
    .orderBy(schema.yieldCurveRates.date)
    .limit(1);
  
  if (latestDateInDb.length > 0) {
    const latestDate = latestDateInDb[0].date;
    console.log(`[Scheduler] Latest date in database: ${latestDate}`);
  }
  
  const result = await fetchTreasuryYieldCurve(3, 5000);
  
  if (result.success) {
    await saveYieldData(result);
    await regenerateOgImage();
    await generateDailySummary();
    await warmQueryCache();
    console.log(`[Scheduler] Update complete at ${new Date().toISOString()}`);
  } else {
    console.log(`[Scheduler] Fetch failed: ${result.error}. Will retry in 15 minutes.`);
  }
}

async function hasSummaryForDate(date: string): Promise<boolean> {
  const result = await db
    .select({ date: schema.dailySummaries.date })
    .from(schema.dailySummaries)
    .where(eq(schema.dailySummaries.date, date))
    .limit(1);
  return result.length > 0;
}

/**
 * Backfill: regenerate summaries for recent dates that have yield data but no summary.
 * Covers days where the LLM call failed and never got retried.
 */
async function backfillMissingSummaries(): Promise<void> {
  try {
    const datesWithRates = await db
      .selectDistinct({ date: schema.yieldCurveRates.date })
      .from(schema.yieldCurveRates)
      .orderBy(desc(schema.yieldCurveRates.date))
      .limit(30);

    const datesWithSummaries = await db
      .select({ date: schema.dailySummaries.date })
      .from(schema.dailySummaries);

    const summarySet = new Set(datesWithSummaries.map(s => s.date));
    const missing = datesWithRates.map(d => d.date).filter(d => !summarySet.has(d));

    if (missing.length === 0) {
      console.log('[Scheduler] Backfill: no missing summaries found');
      return;
    }

    console.log(`[Scheduler] Backfill: generating summaries for ${missing.length} missing date(s): ${missing.join(', ')}`);
    for (const date of missing) {
      await generateDailySummary(date);
      if (!(await hasSummaryForDate(date))) {
        console.log(`[Scheduler] Backfill: still no summary for ${date}, will retry on next loop iteration`);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Backfill error:', error);
  }
}

async function dailyUpdateLoop(): Promise<void> {
  console.log(`[Scheduler] Starting daily update loop...`);
  console.log(`[Scheduler] Cron timezone: ${process.env.CRON_TZ || 'America/New_York'}`);
  console.log(`[Scheduler] Target update time: ${CRON_HOUR.toString().padStart(2, '0')}:${CRON_MINUTE.toString().padStart(2, '0')} ${process.env.CRON_TZ || 'America/New_York'}`);
  
  while (true) {
    const now = new Date();
    
    if (shouldRunNow()) {
      const hasToday = await isTodayDataExists();
      
      if (!hasToday) {
        console.log(`[Scheduler] Target time reached, checking for new data...`);
        await checkAndUpdate();
      } else {
        // Yield data exists but the summary may have failed earlier (e.g. MiniMax 529s).
        // Self-heal: regenerate the summary if it's missing.
        const today = new Date().toISOString().split('T')[0];
        const hasSummary = await hasSummaryForDate(today);
        if (!hasSummary) {
          console.log(`[Scheduler] Yield data exists but summary missing for ${today}, regenerating...`);
          await generateDailySummary(today);
          await backfillMissingSummaries();
        } else {
          console.log(`[Scheduler] Today's data already exists, skipping update`);
        }
      }
      
      const nextMidnight = new Date(now);
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      nextMidnight.setHours(0, 1, 0, 0);
      
      const msUntilMidnight = nextMidnight.getTime() - now.getTime();
      console.log(`[Scheduler] Next check scheduled at ${nextMidnight.toISOString()} (in ${Math.round(msUntilMidnight / 1000 / 60)} minutes)`);
      
      await sleep(msUntilMidnight);
    } else {
      await sleep(CHECK_INTERVAL_MS);
    }
  }
}

async function main(): Promise<void> {
  console.log(`[Scheduler] Treasury Yield Curve Scheduler starting...`);
  console.log(`[Scheduler] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Scheduler] Database: ${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}`);
  
  try {
    const countResult = await db.select().from(schema.yieldCurveRates).limit(1);
    
    if (countResult.length === 0) {
      console.log(`[Scheduler] Database is empty. Loading historical data from Treasury archives...`);
      const hasData = await fetchAndImportHistorical();
      
      if (!hasData) {
        console.log(`[Scheduler] Failed to import historical data, will try daily XML feed`);
      }
      
      await regenerateOgImage();
      console.log(`[Scheduler] Fetching latest XML data to ensure up-to-date rates...`);
      await checkAndUpdate();
    } else {
      console.log(`[Scheduler] Database has existing data, starting normal update loop`);
      await backfillMissingSummaries();
      await generateDailySummary();
      await warmQueryCache();
    }
    
    await dailyUpdateLoop();
  } catch (error) {
    console.error(`[Scheduler] Fatal error:`, error);
    process.exit(1);
  }
}

main();
