import { db, schema } from '../db';
import postgres from 'postgres';

const ARCHIVE_CSV_URLS = [
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rate-archives/par-yield-curve-rates-1990-2023.csv',
];

const CSV_COLUMNS: Record<string, string> = {
  '4Wk': '4WK',
  '4 MO': '4WK',
  '4 WEEK': '4WK',
  '6Wk': '6WK',
  '6 MO': '6WK',
  '6 WEEK': '6WK',
  '2Mo': '2MO',
  '2 MO': '2MO',
  '2 MONTH': '2MO',
  '3Mo': '3MO',
  '3 MO': '3MO',
  '3 MONTH': '3MO',
  '6Mo': '6MO',
  '6 MO': '6MO',
  '6 MONTH': '6MO',
  '1Yr': '1YR',
  '1 YR': '1YR',
  '1 YEAR': '1YR',
  '2Yr': '2YR',
  '2 YR': '2YR',
  '2 YEAR': '2YR',
  '3Yr': '3YR',
  '3 YR': '3YR',
  '3 YEAR': '3YR',
  '5Yr': '5YR',
  '5 YR': '5YR',
  '5 YEAR': '5YR',
  '7Yr': '7YR',
  '7 YR': '7YR',
  '7 YEAR': '7YR',
  '10Yr': '10YR',
  '10 YR': '10YR',
  '10 YEAR': '10YR',
  '20Yr': '20YR',
  '20 YR': '20YR',
  '20 YEAR': '20YR',
  '30Yr': '30YR',
  '30 YR': '30YR',
  '30 YEAR': '30YR',
};

const KNOWN_MATURITY_KEYS = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];

function normalizeColumnName(col: string): string | null {
  const cleaned = col.trim();
  return CSV_COLUMNS[cleaned] || CSV_COLUMNS[cleaned.toUpperCase()] || CSV_COLUMNS[cleaned.replace(/\s+/g, '')] || null;
}

async function fetchCsv(url: string): Promise<string> {
  console.log(`[Archive] Fetching ${url}`);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'TreasuryDashboard/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.status}`);
  }
  return response.text();
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
    
    const dateIdx = columnMap['Date'] || columnMap['date'] || '0';
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
  
  const yyyymmdd = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) {
    return cleaned;
  }
  
  return null;
}

async function saveHistoricalData(data: { date: string; rates: { maturity: string; rate: number }[] }[]): Promise<number> {
  let savedCount = 0;
  
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
            set: {
              rate: rate.toString(),
              createdAt: new Date(),
            },
          });
        savedCount++;
      } catch (error) {
        console.error(`[Archive] Error saving ${maturity} for ${day.date}:`, error);
      }
    }
    
    if (savedCount % 1000 === 0) {
      console.log(`[Archive] Saved ${savedCount} records...`);
    }
  }
  
  return savedCount;
}

async function getExistingDateCount(): Promise<number> {
  try {
    const result = await db.select().from(schema.yieldCurveRates).limit(1);
    return result.length;
  } catch {
    return 0;
  }
}

async function getDateRange(): Promise<{ min: string; max: string } | null> {
  try {
    const result = await db
      .select({ min: schema.yieldCurveRates.date })
      .from(schema.yieldCurveRates)
      .orderBy(schema.yieldCurveRates.date)
      .limit(1);
    
    if (result.length === 0) return null;
    
    const maxResult = await db
      .select({ max: schema.yieldCurveRates.date })
      .from(schema.yieldCurveRates)
      .orderBy(schema.yieldCurveRates.date)
      .limit(1);
    
    return {
      min: String(result[0].min),
      max: String(maxResult[0].max),
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log('[Archive] Treasury Historical Data Importer');
  console.log('[Archive] =================================');
  
  try {
    const existingCount = await getExistingDateCount();
    const dateRange = await getDateRange();
    
    if (existingCount > 0 && dateRange) {
      console.log(`[Archive] Database already has ${existingCount} records`);
      console.log(`[Archive] Existing date range: ${dateRange.min} to ${dateRange.max}`);
      console.log('[Archive] Skipping historical import. Delete yield_curve_rates table to re-import.');
      return;
    }
    
    console.log('[Archive] Starting historical data import...');
    console.log('[Archive] This may take several minutes for full import...');
    
    let totalRecords = 0;
    
    for (const url of ARCHIVE_CSV_URLS) {
      const csv = await fetchCsv(url);
      const data = parseCSV(csv);
      console.log(`[Archive] Parsed ${data.length} days from CSV`);
      
      const saved = await saveHistoricalData(data);
      totalRecords += saved;
      console.log(`[Archive] Saved ${saved} records (total: ${totalRecords})`);
    }
    
    const newRange = await getDateRange();
    console.log('[Archive] =================================');
    console.log('[Archive] Import complete!');
    console.log(`[Archive] Total records: ${totalRecords}`);
    if (newRange) {
      console.log(`[Archive] Date range: ${newRange.min} to ${newRange.max}`);
    }
    
  } catch (error) {
    console.error('[Archive] Fatal error:', error);
    process.exit(1);
  }
}

main();
