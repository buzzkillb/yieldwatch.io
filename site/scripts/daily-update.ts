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

const ratesPath = join(dataDir, 'rates.json');
const summariesPath = join(dataDir, 'summaries.json');
const rates = JSON.parse(await readFile(ratesPath, 'utf8'));
const summaries = JSON.parse(await readFile(summariesPath, 'utf8'));
const known = new Set(rates.map(r => r.date));

// 1. Fetch + parse the Treasury XML.
const res = await fetch(TREASURY_XML_URL);
if (!res.ok) throw new Error(`Treasury XML fetch failed: ${res.status}`);
const rows = parseYieldXml(await res.text());
const newRows = rows.filter(r => !known.has(r.date)).sort((a, b) => a.date.localeCompare(b.date));

if (newRows.length === 0 && !force) {
  console.log('No new rate rows found. Nothing to do.');
  process.exit(0);
}
console.log(`New rate rows: ${newRows.map(r => r.date).join(', ') || '(none, --force regenerate)'}`);

// 2. Rate lookup that walks back over holidays/missing days.
const byDate = new Map(rates.map(r => [r.date, r.rates]));
for (const row of newRows) byDate.set(row.date, row.rates);

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

const modelId = await discoverModelId();
console.log('Using model:', modelId);

const dateFormatted = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });

let generated = 0;
for (const row of newRows) {
  const today = row.date;
  if (summaries.some(s => s.date === today) && !force) continue;

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
      }, `short ${today}`);
      const short = await parseLLMResponse(shortRes, `short ${today}`);
      if (!isValidSummary(short)) throw new Error('invalid short summary');

      const longRes = await fetchLLMWithRetry({
        model: modelId,
        messages: [
          { role: 'system', content: buildLongSystemPrompt(ratesData) },
          { role: 'user', content: longUserMessage(today) },
        ],
        max_tokens: 6000,
        temperature: 0.4,
      }, `long ${today}`);
      const long = await parseLLMResponse(longRes, `long ${today}`);
      if (!isValidSummary(long)) throw new Error('invalid long summary');

      const entry = { date: today, dateFormatted: dateFormatted(today), summary: short, blogSummary: long, rates: row.rates };
      const idx = summaries.findIndex(s => s.date === today);
      if (idx >= 0) summaries[idx] = entry; else summaries.push(entry);
      generated++;
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.error(`Attempt ${attempt} failed for ${today}:`, err, '— retrying in 30s');
      attempt++;
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}

// 3. Persist (rates ascending, summaries newest-first — same as export).
if (newRows.length > 0) {
  rates.push(...newRows);
  rates.sort((a, b) => a.date.localeCompare(b.date));
  await writeFile(ratesPath, JSON.stringify(rates));
}
summaries.sort((a, b) => b.date.localeCompare(a.date));
await writeFile(summariesPath, JSON.stringify(summaries));

console.log(`Daily update complete: ${generated} new summaries, ${rates.length} rate days total.`);
