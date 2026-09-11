// Batch-backfill summaries across a date range.
// Thin CLI wrapper around summaryService — all logic lives there.
import { db, schema } from '../db';
import { eq, gte, lte } from 'drizzle-orm';
import { generateAndSaveSummaries } from '../services/summaryService';
import { generateOgChart } from '../utils/ogChart';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const startDate = process.argv[2];
const endDate = process.argv[3];

if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
  console.error('Usage: bun run src/scripts/batchBackfill.ts YYYY-MM-DD YYYY-MM-DD');
  console.error('Example: bun run src/scripts/batchBackfill.ts 2024-03-01 2024-03-31');
  process.exit(1);
}

console.log(`[BatchBackfill] Starting batch backfill from ${startDate} to ${endDate}`);

function getBusinessDaysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  const current = new Date(start + 'T00:00:00Z');
  const endDateObj = new Date(end + 'T00:00:00Z');

  while (current <= endDateObj) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) {
      days.push(current.toISOString().split('T')[0]);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}

async function backfillDate(date: string): Promise<boolean> {
  const existing = await db
    .select()
    .from(schema.dailySummaries)
    .where(eq(schema.dailySummaries.date, date))
    .limit(1);

  if (existing.length > 0) {
    console.log(`[BatchBackfill] ${date} already has summary, skipping`);
    return true;
  }

  console.log(`[BatchBackfill] Processing ${date}...`);

  const { short } = await generateAndSaveSummaries(date);

  if (!short) {
    console.log(`[BatchBackfill] No summary generated for ${date}, skipping OG image`);
    return false;
  }

  // Also backfill the per-date OG image for blog post cards
  const { getRatesForDate } = await import('../services/summaryService');
  const rates = await getRatesForDate(date);
  if (rates.length > 0) {
    try {
      const pngBuffer = await generateOgChart(rates);
      const ogDir = join(process.cwd(), 'public/og');
      if (!existsSync(ogDir)) {
        mkdirSync(ogDir, { recursive: true });
      }
      writeFileSync(join(ogDir, `${date}.png`), pngBuffer);
      console.log(`[BatchBackfill] OG image generated for ${date}`);
    } catch (ogError) {
      console.log(`[BatchBackfill] OG image failed for ${date} (summary still saved): ${ogError}`);
    }
  }

  return true;
}

async function main(): Promise<void> {
  try {
    const businessDays = getBusinessDaysInRange(startDate, endDate);
    console.log(`[BatchBackfill] Found ${businessDays.length} business days to process`);

    let successCount = 0;
    let failCount = 0;

    for (const date of businessDays) {
      const result = await backfillDate(date);
      if (result) {
        successCount++;
      } else {
        failCount++;
      }

      if ((successCount + failCount) % 10 === 0) {
        console.log(`[BatchBackfill] Progress: ${successCount} success, ${failCount} failed`);
      }
    }

    console.log(`[BatchBackfill] Complete! ${successCount} succeeded, ${failCount} failed`);
    process.exit(failCount > 0 ? 1 : 0);
  } catch (error) {
    console.error('[BatchBackfill] Error:', error);
    process.exit(1);
  }
}

main();
