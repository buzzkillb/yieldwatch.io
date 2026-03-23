import { db, schema } from '../db';
import { fetchTreasuryYieldCurve } from './fetcher';

const API_RETRY_DELAY = 60000;

async function getStoredDateCount(): Promise<number> {
  const result = await db.select().from(schema.yieldCurveRates).limit(1);
  return result.length;
}

async function saveYieldData(data: Awaited<ReturnType<typeof fetchTreasuryYieldCurve>>): Promise<number> {
  if (!data.success || !data.data) {
    throw new Error(data.error || 'Fetch failed');
  }
  
  let savedCount = 0;
  
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
        savedCount++;
      } catch (error) {
        console.error(`[Seed] Error saving rate ${maturity} for ${day.date}:`, error);
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
        console.error(`[Seed] Error saving stats for ${stat.maturity}:`, error);
      }
    }
  }
  
  return savedCount;
}

async function seedHistorical(): Promise<void> {
  console.log('[Seed] Starting historical data load...');
  console.log('[Seed] This will fetch data from 1990 to present and may take several minutes...');
  
  let totalRecords = 0;
  let attempts = 0;
  const maxAttempts = 5;
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`[Seed] Attempt ${attempts}/${maxAttempts}: Fetching Treasury yield curve data...`);
    
    const result = await fetchTreasuryYieldCurve(3, 10000);
    
    if (result.success && result.data) {
      const dataCount = result.data.length;
      console.log(`[Seed] Received ${dataCount} days of data`);
      
      console.log('[Seed] Saving data to database...');
      const recordsSaved = await saveYieldData(result);
      totalRecords += recordsSaved;
      
      console.log(`[Seed] Successfully saved ${recordsSaved} records (${totalRecords} total)`);
      
      const uniqueDates = new Set(result.data.map(d => d.date)).size;
      const uniqueMaturities = new Set(result.data.flatMap(d => d.rates.map(r => r.maturity))).size;
      console.log(`[Seed] Data summary: ${uniqueDates} unique dates, ${uniqueMaturities} maturities`);
      
      console.log('[Seed] Historical data load complete!');
      return;
    } else {
      console.error(`[Seed] Fetch failed: ${result.error}`);
      
      if (attempts < maxAttempts) {
        console.log(`[Seed] Retrying in ${API_RETRY_DELAY / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, API_RETRY_DELAY));
      }
    }
  }
  
  throw new Error(`Failed to fetch data after ${maxAttempts} attempts`);
}

async function main(): Promise<void> {
  console.log('[Seed] Treasury Yield Curve Data Seeder');
  console.log('[Seed] =================================');
  console.log(`[Seed] Database: ${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}`);
  console.log(`[Seed] Database name: ${process.env.POSTGRES_DB || 'treasury'}`);
  
  try {
    const count = await getStoredDateCount();
    
    if (count > 0) {
      console.log(`[Seed] Database already has ${count} records. Skipping seed.`);
      console.log('[Seed] To re-seed, first run: bun run db:clear (manual)');
      return;
    }
    
    console.log('[Seed] Database is empty. Starting seed process...');
    await seedHistorical();
    
    console.log('[Seed] =================================');
    console.log('[Seed] Seed completed successfully!');
    console.log('[Seed] You can now start the API with: bun run dev');
    
    process.exit(0);
  } catch (error) {
    console.error('[Seed] Fatal error during seed:', error);
    process.exit(1);
  }
}

main();
