import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { fetchTreasuryYieldCurve, fetchLatestDate } from './fetcher';

const CHECK_INTERVAL_MS = parseInt(process.env.SCHEDULER_CHECK_INTERVAL_MS || '900000', 10);
const CRON_HOUR = parseInt(process.env.SCHEDULER_CRON_HOUR || '16', 10);
const CRON_MINUTE = parseInt(process.env.SCHEDULER_CRON_MINUTE || '30', 10);

const ARCHIVE_CSV_URLS = [
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rate-archives/par-yield-curve-rates-1990-2023.csv',
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2024/all?type=daily_treasury_yield_curve&field_tdr_date_value=2024&_format=csv',
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2025/all?type=daily_treasury_yield_curve&field_tdr_date_value=2025&_format=csv',
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&_format=csv',
];

const CSV_COLUMNS: Record<string, string> = {
  '4Wk': '4WK', '4 MO': '4WK', '4 WEEK': '4WK',
  '6Wk': '6WK', '6 MO': '6WK', '6 WEEK': '6WK',
  '6 WEEKS': '6WK', '6WEEKS': '6WK',
  '2Mo': '2MO', '2 MO': '2MO', '2 MONTH': '2MO',
  '3Mo': '3MO', '3 MO': '3MO', '3 MONTH': '3MO',
  '4Mo': '4MO', '4 MO': '4MO', '4 MONTH': '4MO',
  '6Mo': '6MO', '6 MO': '6MO', '6 MONTH': '6MO',
  '1Mo': '1MO', '1 MO': '1MO', '1 MONTH': '1MO',
  '1.5Mo': '1.5MO', '1.5 MO': '1.5MO', '1.5 Month': '1.5MO',
  '1Yr': '1YR', '1 YR': '1YR', '1 YEAR': '1YR',
  '2Yr': '2YR', '2 YR': '2YR', '2 YEAR': '2YR',
  '3Yr': '3YR', '3 YR': '3YR', '3 YEAR': '3YR',
  '5Yr': '5YR', '5 YR': '5YR', '5 YEAR': '5YR',
  '7Yr': '7YR', '7 YR': '7YR', '7 YEAR': '7YR',
  '10Yr': '10YR', '10 YR': '10YR', '10 YEAR': '10YR',
  '20Yr': '20YR', '20 YR': '20YR', '20 YEAR': '20YR',
  '30Yr': '30YR', '30 YR': '30YR', '30 YEAR': '30YR',
};

const KNOWN_MATURITY_KEYS = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];

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
          } catch (error) {
            // Skip duplicate key errors silently
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

function getCronTime(): { hour: number; minute: number } {
  const cronTz = process.env.CRON_TZ || 'America/New_York';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: cronTz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '16');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '30');
    return { hour, minute };
  } catch {
    return { hour: CRON_HOUR, minute: CRON_MINUTE };
  }
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
    console.log(`[Scheduler] Update complete at ${new Date().toISOString()}`);
  } else {
    console.log(`[Scheduler] Fetch failed: ${result.error}. Will retry in 15 minutes.`);
  }
}

async function dailyUpdateLoop(): Promise<void> {
  console.log(`[Scheduler] Starting daily update loop...`);
  console.log(`[Scheduler] Cron timezone: ${process.env.CRON_TZ || 'America/New_York'}`);
  const { hour, minute } = getCronTime();
  console.log(`[Scheduler] Target update time: ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${process.env.CRON_TZ || 'America/New_York'}`);
  
  while (true) {
    const now = new Date();
    
    if (shouldRunNow()) {
      const hasToday = await isTodayDataExists();
      
      if (!hasToday) {
        console.log(`[Scheduler] Target time reached, checking for new data...`);
        await checkAndUpdate();
      } else {
        console.log(`[Scheduler] Today's data already exists, skipping update`);
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      
      console.log(`[Scheduler] Fetching latest XML data to ensure up-to-date rates...`);
      await checkAndUpdate();
    } else {
      console.log(`[Scheduler] Database has existing data, starting normal update loop`);
    }
    
    await dailyUpdateLoop();
  } catch (error) {
    console.error(`[Scheduler] Fatal error:`, error);
    process.exit(1);
  }
}

main();
