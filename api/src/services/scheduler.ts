import { db, schema } from '../db';
import { eq, desc, asc, lt, and, gte } from 'drizzle-orm';
import { fetchTreasuryYieldCurve, fetchLatestDate } from './fetcher';
import { generateOgChart } from '../utils/ogChart';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

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
  '4Wk': '4WK', '4 MO': '4WK', '4 WEEK': '4WK',
  '6Wk': '6WK', '6 MO': '6WK', '6 WEEK': '6WK',
  '6 WEEKS': '6WK', '6WEEKS': '6WK',
  '2Mo': '2MO', '2 MO': '2MO', '2 MONTH': '2MO',
  '3Mo': '3MO', '3 MO': '3MO', '3 MONTH': '3MO',
  '4Mo': '4MO', '4 MO': '4MO', '4 MONTH': '4MO',
  '6Mo': '6MO', '6 MO': '6MO', '6 MONTH': '6MO',
  '1 Mo': '4WK', '1Mo': '4WK', '1 MO': '4WK', '1 MONTH': '4WK', '1MONTH': '4WK',
  '1.5 Mo': '6WK', '1.5Mo': '6WK', '1.5 MO': '6WK', '1.5 Month': '6WK', '1.5MONTH': '6WK',
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

function getPreviousBusinessDay(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  let daysBack = 1;
  
  while (daysBack <= 7) {
    date.setUTCDate(date.getUTCDate() - 1);
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      break;
    }
    daysBack++;
  }
  
  return date.toISOString().split('T')[0];
}

function getDateMinusDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().split('T')[0];
}

function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getUTCDay()];
}

async function getRatesForDate(date: string): Promise<{ maturity: string; rate: number }[]> {
  const results = await db
    .select()
    .from(schema.yieldCurveRates)
    .where(eq(schema.yieldCurveRates.date, date));
  
  return results.map(r => ({
    maturity: r.maturity,
    rate: parseFloat(r.rate)
  }));
}

function formatDateForPrompt(dateStr: string): { date: string; day: string } {
  return {
    date: dateStr,
    day: getDayOfWeek(dateStr)
  };
}

async function generateDailySummary(): Promise<void> {
  if (!MINIMAX_API_KEY) {
    console.log('[Scheduler] MINIMAX_API_KEY not set, skipping daily summary generation');
    return;
  }

  try {
    console.log('[Scheduler] Generating daily rate summaries with MiniMax...');

    const latestDateInDb = await db
      .select({ date: schema.yieldCurveRates.date })
      .from(schema.yieldCurveRates)
      .orderBy(desc(schema.yieldCurveRates.date))
      .limit(1);

    if (latestDateInDb.length === 0) {
      console.log('[Scheduler] No data in database for summary');
      return;
    }

    const todayDate = latestDateInDb[0].date;
    const yesterdayDate = getPreviousBusinessDay(todayDate);
    const lastWeekDate = getDateMinusDays(todayDate, 7);

    const [todayRates, yesterdayRates, lastWeekRates] = await Promise.all([
      getRatesForDate(todayDate),
      getRatesForDate(yesterdayDate),
      getRatesForDate(lastWeekDate)
    ]);

    if (todayRates.length === 0) {
      console.log('[Scheduler] No rates data for summary');
      return;
    }

    const dates = {
      today: formatDateForPrompt(todayDate),
      yesterday: formatDateForPrompt(yesterdayDate),
      lastWeek: formatDateForPrompt(lastWeekDate),
    };

    const dataPrompt = `- Today (${dates.today.day}, ${dates.today.date}): ${JSON.stringify(todayRates)}
- Last business day (${dates.yesterday.day}, ${dates.yesterday.date}): ${JSON.stringify(yesterdayRates)}
- Last week (${dates.lastWeek.day}, ${dates.lastWeek.date}): ${JSON.stringify(lastWeekRates)}`;

    const shortSystemPrompt = `You are a plain-spoken writer describing U.S. Treasury yield curve data. Treasury publishes rates on business days only - weekends and holidays are skipped.

Rules:
- Write 2-4 sentences as one paragraph
- Always mention the 30-year rate prominently
- You MUST include comparison to last week in every output
- When describing changes, use simple language like "up from last week" or "higher than yesterday"
- Do NOT use phrases like "percentage points" or "basis points" - just say "higher" or "lower"
- If the yield curve is inverted, state that fact only - do not explain what it means
- Stick to observable data comparisons - do not explain what rate movements mean for investors or markets
- Keep it factual and straightforward
- Never use bullet points, dashes, or list format
- Never use foreign characters or non-ASCII symbols
- Write in plain English only

${dataPrompt}`;

    const longSystemPrompt = `You are a financial journalist writing a daily market brief about U.S. Treasury yields. Treasury publishes rates on business days only - weekends and holidays are skipped.

Rules:
- Write exactly 3 paragraphs of 4-6 sentences each
- Open paragraph 1 with the 30-year rate and key movements prominently
- Paragraph 2 should cover rate changes across the curve with comparisons to yesterday and last week
- Paragraph 3 should summarize curve shape, inversions, and notable patterns
- Use plain language - explain what the numbers mean without being educational
- Do NOT use "percentage points" or "basis points" - just say "higher" or "lower"
- Do NOT explain what rate movements mean for investors or markets
- Keep it factual and informative - a trader should find this useful
- Never use bullet points, dashes, or list format
- Never use foreign characters or non-ASCII symbols
- Write in plain English only
- Separate paragraphs with a blank line

${dataPrompt}`;

    const shortUserMessage = `Write a brief paragraph about today's Treasury yield curve rates. Keep it to 2-4 sentences.`;
    const longUserMessage = `Write a detailed daily market brief about today's Treasury yield curve rates in exactly 3 paragraphs. This will be published on a blog. Cover the overall curve shape, notable rate movements, and how today compares to recent history. Separate paragraphs with a blank line.`;

    const [shortResponse, longResponse] = await Promise.all([
      fetch('https://api.minimax.io/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': MINIMAX_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'MiniMax-M2.7',
          max_tokens: 1000,
          system: shortSystemPrompt,
          messages: [{ role: 'user', content: [{ type: 'text', text: shortUserMessage }] }],
          temperature: 1
        })
      }),
      fetch('https://api.minimax.io/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': MINIMAX_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'MiniMax-M2.7',
          max_tokens: 3000,
          system: longSystemPrompt,
          messages: [{ role: 'user', content: [{ type: 'text', text: longUserMessage }] }],
          temperature: 1
        })
      })
    ]);

    const parseResponse = async (response: Response): Promise<string> => {
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[Scheduler] MiniMax API error: ${response.status} - ${errorText}`);
        return '';
      }
      const data = await response.json() as { content?: { type: string; text?: string }[] };
      if (data.content && Array.isArray(data.content)) {
        for (const block of data.content) {
          if (block.type === 'text' && block.text) {
            return block.text.trim();
          }
        }
      }
      return '';
    };

    const [shortSummary, blogSummary] = await Promise.all([
      parseResponse(shortResponse),
      parseResponse(longResponse)
    ]);

    if (!shortSummary) {
      console.log('[Scheduler] No short summary generated from MiniMax');
      return;
    }

    await db
      .insert(schema.dailySummaries)
      .values({
        date: todayDate,
        summary: shortSummary,
        blogSummary: blogSummary || null,
      })
      .onConflictDoUpdate({
        target: schema.dailySummaries.date,
        set: {
          summary: shortSummary,
          blogSummary: blogSummary || null,
          createdAt: new Date(),
        },
      });
    console.log(`[Scheduler] Daily summaries saved to database for ${todayDate}`);
    console.log(`[Scheduler] Short summary: ${shortSummary}`);
    if (blogSummary) {
      console.log(`[Scheduler] Blog summary: ${blogSummary.substring(0, 100)}...`);
    }

    const ogImageResult = await generateOgImageForDate(todayDate);
    if (!ogImageResult) {
      console.log('[Scheduler] WARNING: Failed to generate OG image for today\'s blog post');
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
      const data = await response.json();
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

function getDateYearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
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
      
      await regenerateOgImage();
      console.log(`[Scheduler] Fetching latest XML data to ensure up-to-date rates...`);
      await checkAndUpdate();
    } else {
      console.log(`[Scheduler] Database has existing data, starting normal update loop`);
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
