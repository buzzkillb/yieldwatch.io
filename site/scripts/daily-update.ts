// Daily data update — replaces the VPS scheduler + Postgres.
// Fetches the Treasury yield-curve XML, parses new rows, generates short/long
// summaries via the LLM gateway (reusing the API's own prompt/retry code),
// and appends to src/data/*.json. CI then commits + pushes, which triggers a
// Cloudflare Pages build.
// Usage: bun site/scripts/daily-update.ts [--force]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The API's db module validates credentials at import time. We never query
// Postgres here, so placeholders are enough to satisfy the import chain.
process.env.POSTGRES_USER ??= 'unused';
process.env.POSTGRES_PASSWORD ??= 'unused';

const { parseYieldXml } = await import('../../api/src/utils/parse');
const {
  getPreviousBusinessDay, getPreviousBusinessDayFromDate, getDateMinusDays,
  getOneYearAgoBusinessDay, isValidSummary,
  buildShortSystemPrompt, buildLongSystemPrompt,
  shortUserMessage, longUserMessage,
  discoverModelId, fetchLLMWithRetry, parseLLMResponse,
} = await import('../../api/src/services/summaryService');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src', 'data');
const TREASURY_XML_URL = 'https://home.treasury.gov/sites/default/files/interest-rates/yield.xml';
const force = process.argv.includes('--force');
const REQUIRED_TENORS = ['3MO', '2YR', '10YR', '30YR'];
const LEGACY_REQUIRED_TENORS = ['10YR'];

const ratesPath = join(dataDir, 'rates.json');
const summariesPath = join(dataDir, 'summaries.json');
const rates = JSON.parse(await readFile(ratesPath, 'utf8'));
const summaries = JSON.parse(await readFile(summariesPath, 'utf8'));
const known = new Set(rates.map(r => r.date));

// 1. Fetch + parse the Treasury XML. Retry transient failures instead of
// failing the whole scheduled run on one bad response.
async function fetchTreasuryXml(): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(TREASURY_XML_URL, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Treasury XML fetch failed: ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < 3) await new Promise(r => setTimeout(r, 15000));
    }
  }
  throw lastError;
}

const rows = parseYieldXml(await fetchTreasuryXml());
for (const row of rows) {
  const tenors = new Set(row.rates.map(r => r.maturity));
  const required = row.date >= '2010-01-01' ? REQUIRED_TENORS : LEGACY_REQUIRED_TENORS;
  const missing = required.filter(t => !tenors.has(t));
  if (missing.length) throw new Error(`Treasury row ${row.date} missing ${missing.join(', ')}`);
  for (const r of row.rates) {
    if (!Number.isFinite(r.rate) || r.rate < 0) throw new Error(`Invalid rate ${r.rate} (${r.maturity}) on ${row.date}`);
  }
}

const newRows = rows.filter(r => !known.has(r.date)).sort((a, b) => a.date.localeCompare(b.date));

// Backfill gaps only within the era this site actually publishes summaries
// for. rates.json starts in 1990; generating posts for all ~9,000 historical
// days would be wasteful.
const summaryDates = new Set(summaries.map(s => s.date));
const earliestSummaryDate = summaries.length ? summaries[summaries.length - 1].date : null;
const missingSummaryDates = rates
  .filter(r => (!earliestSummaryDate || r.date >= earliestSummaryDate) && !summaryDates.has(r.date))
  .map(r => r.date);
const targetDates = new Set<string>([
  ...newRows.map(r => r.date),
  ...missingSummaryDates,
]);

if (targetDates.size === 0 && !force) {
  console.log('No new rate rows or missing summaries found. Nothing to do.');
  process.exit(0);
}
console.log(`New rate rows: ${newRows.map(r => r.date).join(', ') || '(none)'}`);
console.log(`Summaries to generate: ${[...targetDates].sort().join(', ') || '(none)'}`);

// 2. Persist new rate rows before touching the LLM. If the gateway is down,
// the day's official rates are still committed and the next run backfills the
// missing summary.
if (newRows.length > 0) {
  rates.push(...newRows);
  rates.sort((a, b) => a.date.localeCompare(b.date));
  await writeFile(ratesPath, JSON.stringify(rates));
}

// 3. Rate lookup that walks back over holidays/missing days.
const byDate = new Map(rates.map(r => [r.date, r.rates]));
for (const row of rows) byDate.set(row.date, row.rates);

function findRates(target: string): { maturity: string; rate: number }[] | null {
  let d = target;
  for (let i = 0; i < 12; i++) {
    if (byDate.has(d)) return byDate.get(d)!;
    const dt = new Date(d + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - 1);
    d = dt.toISOString().slice(0, 10);
  }
  return null;
}

let modelId: string;
try {
  modelId = await discoverModelId();
  console.log('Using model:', modelId);
} catch (err) {
  console.error('Could not discover the LLM model; rates were saved and summaries will be backfilled next run:', err);
  process.exit(1);
}

const dateFormatted = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });

let generated = 0;
const failures: string[] = [];
for (const today of [...targetDates].sort()) {
  const row = byDate.has(today) ? { date: today, rates: byDate.get(today)! } : null;
  if (!row) {
    failures.push(`${today} (no rate data)`);
    continue;
  }
  const existing = summaries.find(s => s.date === today);
  if (existing && !force) continue;

  const yesterday = getPreviousBusinessDay(today);
  const lastWeek = getPreviousBusinessDayFromDate(today, 5);
  const thirtyDays = getDateMinusDays(today, 30);
  const yearAgoDate = getOneYearAgoBusinessDay(today);

  const ratesData = {
    todayRates: row.rates,
    yesterdayRates: findRates(yesterday) ?? [],
    lastWeekRates: findRates(lastWeek) ?? [],
    thirtyDaysRates: findRates(thirtyDays) ?? [],
    dates: { today, yesterday, lastWeek, thirtyDays },
    yearAgoRates: findRates(yearAgoDate) ?? undefined,
    yearAgoDate,
  };

  let attempt = 1;
  for (;;) {
    try {
      const shortRes = await fetchLLMWithRetry({
        model: modelId,
        messages: [
          { role: 'system', content: buildShortSystemPrompt(ratesData) },
          { role: 'user', content: shortUserMessage(today) },
        ],
        max_tokens: 1000,
        temperature: 0.4,
        stream: true,
        chat_template_kwargs: { enable_thinking: false },
      }, `short ${today}`);
      const short = await parseLLMResponse(shortRes, `short ${today}`);
      if (!isValidSummary(short)) throw new Error('invalid short summary');

      const longRes = await fetchLLMWithRetry({
        model: modelId,
        messages: [
          { role: 'system', content: buildLongSystemPrompt(ratesData) },
          { role: 'user', content: longUserMessage(today) },
        ],
        max_tokens: 2500,
        temperature: 0.4,
        stream: true,
        chat_template_kwargs: { enable_thinking: false },
      }, `long ${today}`);
      const long = await parseLLMResponse(longRes, `long ${today}`);
      if (!isValidSummary(long)) throw new Error('invalid long summary');

      const entry = { date: today, dateFormatted: dateFormatted(today), summary: short, blogSummary: long, rates: row.rates };
      const idx = summaries.findIndex(s => s.date === today);
      if (idx >= 0) summaries[idx] = entry; else summaries.push(entry);
      generated++;
      break;
    } catch (err) {
      if (attempt >= 3) {
        console.error(`Giving up on ${today} after ${attempt} attempts:`, err);
        failures.push(today);
        break;
      }
      console.error(`Attempt ${attempt} failed for ${today}:`, err, '- retrying in 30s');
      attempt++;
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}

// 4. Persist summaries (newest-first — same as export). Rate rows were
// already written above.
summaries.sort((a, b) => b.date.localeCompare(a.date));
await writeFile(summariesPath, JSON.stringify(summaries));

console.log(`Daily update complete: ${generated} summaries generated, ${rates.length} rate days total.`);
if (failures.length) {
  console.error(`Failed dates (will retry next run): ${failures.join(', ')}`);
  process.exitCode = 1;
}
