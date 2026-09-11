// Backfill a single date's summaries + OG image.
// Thin CLI wrapper around summaryService — all logic lives there.
import { generateAndSaveSummaries } from '../services/summaryService';
import { getRatesForDate } from '../services/summaryService';
import { generateOgChart } from '../utils/ogChart';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const targetDate = process.argv[2];
if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  console.error('Usage: bun run src/scripts/backfill.ts YYYY-MM-DD');
  console.error('Example: bun run src/scripts/backfill.ts 2026-03-15');
  process.exit(1);
}

console.log(`[Backfill] Starting backfill for ${targetDate}`);

async function backfillDate(date: string): Promise<void> {
  console.log(`[Backfill] Processing ${date}...`);

  const { short } = await generateAndSaveSummaries(date);

  if (!short) {
    console.log(`[Backfill] No summary generated for ${date}, skipping OG image`);
    return;
  }

  const rates = await getRatesForDate(date);
  const pngBuffer = await generateOgChart(rates);

  const ogDir = join(process.cwd(), 'public/og');
  if (!existsSync(ogDir)) {
    mkdirSync(ogDir, { recursive: true });
  }

  const pngPath = join(ogDir, `${date}.png`);
  writeFileSync(pngPath, pngBuffer);
  console.log(`[Backfill] OG image generated for ${date}: ${pngPath}`);
}

async function main(): Promise<void> {
  try {
    await backfillDate(targetDate);
    console.log(`[Backfill] Complete for ${targetDate}`);
    process.exit(0);
  } catch (error) {
    console.error('[Backfill] Error:', error);
    process.exit(1);
  }
}

main();
