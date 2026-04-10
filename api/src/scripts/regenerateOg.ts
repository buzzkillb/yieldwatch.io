import { db, schema } from '../db';
import { desc, eq } from 'drizzle-orm';
import { generateOgChart } from '../utils/ogChart';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];

async function regenerateOgImages() {
  console.log('[RegenerateOG] Fetching all summaries...');

  const summaries = await db
    .select({ date: schema.dailySummaries.date })
    .from(schema.dailySummaries)
    .orderBy(desc(schema.dailySummaries.date));

  console.log(`[RegenerateOG] Found ${summaries.length} summaries`);

  const publicDir = join(process.cwd(), 'public');
  const ogDir = join(publicDir, 'og');
  if (!existsSync(ogDir)) {
    mkdirSync(ogDir, { recursive: true });
  }

  let successCount = 0;
  let failCount = 0;

  for (const summary of summaries) {
    const date = summary.date;
    const pngPath = join(ogDir, `${date}.png`);

    if (existsSync(pngPath)) {
      console.log(`[RegenerateOG] ${date} already has OG image, skipping`);
      successCount++;
      continue;
    }

    try {
      const ratesData = await db
        .select()
        .from(schema.yieldCurveRates)
        .where(eq(schema.yieldCurveRates.date, date));

      if (ratesData.length === 0) {
        console.log(`[RegenerateOG] No rates for ${date}, skipping`);
        failCount++;
        continue;
      }

      const rates = ratesData
        .map(r => ({
          maturity: r.maturity,
          rate: parseFloat(r.rate),
        }))
        .sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity));

      const pngBuffer = await generateOgChart(rates);
      writeFileSync(pngPath, pngBuffer);

      console.log(`[RegenerateOG] Generated OG image for ${date}`);
      successCount++;
    } catch (error) {
      console.error(`[RegenerateOG] Error for ${date}:`, error);
      failCount++;
    }

    if ((successCount + failCount) % 50 === 0) {
      console.log(`[RegenerateOG] Progress: ${successCount} success, ${failCount} failed`);
    }
  }

  console.log(`[RegenerateOG] Complete! ${successCount} succeeded, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

regenerateOgImages();