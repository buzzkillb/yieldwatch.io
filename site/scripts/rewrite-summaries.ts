// One-off archive de-duplication pass.
// Rewrites every existing blogSummary in site/src/data/summaries.json via the
// LLM gateway so the 193 archived posts stop reading as one templated sentence
// pattern. Every number in the output is validated against the reference rate
// window (today / last week / 30 days ago / year ago); rejects keep the
// original text. Also derives a fresh short `summary` from paragraph 1.
//
// Usage: bun site/scripts/rewrite-summaries.ts [--limit=N] [--only=YYYY-MM-DD]
// Progress checkpoint: /tmp/yw-rewrite-progress.json (safe to re-run).
process.env.POSTGRES_USER ??= 'unused';
process.env.POSTGRES_PASSWORD ??= 'unused';

import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  getPreviousBusinessDay, getPreviousBusinessDayFromDate, getDateMinusDays,
  getOneYearAgoBusinessDay, discoverModelId, fetchLLMWithRetry, parseLLMResponse,
} = await import('../../api/src/services/summaryService');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src', 'data');
const ratesPath = join(dataDir, 'rates.json');
const summariesPath = join(dataDir, 'summaries.json');
const progressPath = '/tmp/yw-rewrite-progress.json';

const limit = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const targetsFile = (process.argv.find(a => a.startsWith('--targets=')) || '').split('=')[1];
const deriveOnly = process.argv.includes('--derive-short-only');
let targetDates: string[] | null = null;
if (targetsFile) targetDates = JSON.parse(await readFile(targetsFile, 'utf8'));

interface RatePoint { maturity: string; rate: number }
interface SummaryEntry { date: string; dateFormatted: string; summary: string; blogSummary: string; rates: RatePoint[] }

const rates: { date: string; rates: RatePoint[] }[] = JSON.parse(await readFile(ratesPath, 'utf8'));
const summaries: SummaryEntry[] = JSON.parse(await readFile(summariesPath, 'utf8'));

// Date-walking lookup over holidays/missing days (same semantics as daily-update).
const byDate = new Map(rates.map(r => [r.date, r.rates]));
function findRates(target: string): RatePoint[] | null {
  let d = target;
  for (let i = 0; i < 12; i++) {
    if (byDate.has(d)) return byDate.get(d)!;
    const dt = new Date(d + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - 1);
    d = dt.toISOString().slice(0, 10);
  }
  return null;
}

function ratesBlock(label: string, r: RatePoint[] | null): string {
  if (!r || r.length === 0) return `${label}: (not available)`;
  return `${label}: ${r.map(x => `${x.maturity} ${x.rate.toFixed(2)}`).join(', ')}`;
}

// Structural angles, deterministic per date. Distinct hash from the generator's
// getEditorialAngle so rewrites reshuffle relative to the original text.
const ANGLES = [
  'Lead with the largest single change anywhere on the curve, then cover the rest.',
  'Lead with the short end of the curve (bills out to 1-year), then longer maturities.',
  'Lead with the long end (20-year, 30-year), then work toward the bills.',
  'Lead with the overall shape of the curve and the gaps between neighboring maturities, then individual rates.',
  'Lead with how rates moved versus one week ago, then give current levels.',
  'Lead with how rates compare to 30 days ago, then last week, then today.',
  'Lead with the quietest maturities and where the curve was steadiest, then the notable exceptions.',
  'Lead with the middle of the curve (2-year through 7-year), then the wings.',
  'Lead with the highest and lowest rates on the curve and where they sit, then the day-to-day moves.',
  'Lead with the 2-year Treasury rate and the front-to-back progression across maturities.',
];
function angleFor(date: string): string {
  let h = 7;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0;
  return ANGLES[h % ANGLES.length];
}

function systemPrompt(date: string): string {
  return `You are a financial journalist revising the archive of a daily U.S. Treasury yield publication so that no two daily briefs read alike.

Hard rules:
- Keep every number exactly as given in the data and the original text. Never invent, round, or drop a rate. You may only use numbers that appear in the original brief or the reference data.
- Plain, factual, third-person. No opinions, no interpretation of what moves mean, no predictions or outlook.
- 3 paragraphs separated by a blank line. 700 to 1600 characters total.
- Use this structure for this specific brief: ${angleFor(date)}
- Vary sentence openings within the brief. Never open the first sentence with "The" followed by a maturity and "yield" or "rate". Never use the pattern "closed at ... percent on <weekday>" as the opening.
- Refer to at least four rates by full searchable name at least once each, e.g. "30-year Treasury yield", "10-year Treasury rate", "2-year Treasury rate", "Treasury yield curve", "4-week Treasury bill rate".
- Always write rates as "X.XX percent" (example: 4.06 percent). Never write a bare decimal rate without the word percent after it.
- Do not state the size of a change as a decimal number (never "up 0.04"). Describe moves as higher or lower, or state both levels.
- Do not use "percentage points" or "basis points"; describe moves as higher or lower, or state both levels.
${BANNED_OPENINGS.length ? `- Do not begin the first sentence with any of these (already used on other days): ${BANNED_OPENINGS.map(o => `"${o}"`).join('; ')}` : ''}
- No bullet points, no markdown, no headings, no dashes as list markers, no non-ASCII characters, no quotes around the text.
- Banned openers and filler: "In today's market", "Investors are watching", "market landscape", "navigate", "testament", "pivotal".
- Output only the rewritten brief.`;
}

function userPrompt(entry: SummaryEntry, lastErr?: string | null): string {
  const today = entry.date;
  const yesterday = getPreviousBusinessDay(today);
  const lastWeek = getPreviousBusinessDayFromDate(today, 5);
  const thirtyDays = getDateMinusDays(today, 30);
  const yearAgoDate = getOneYearAgoBusinessDay(today);
  return `Original brief for ${today} to rewrite:

${entry.blogSummary}

Reference data (all values are percent, format maturity rate):
${ratesBlock(`Today (${today})`, entry.rates)}
${ratesBlock(`Previous business day (${yesterday})`, findRates(yesterday))}
${ratesBlock(`One week ago (${lastWeek})`, findRates(lastWeek))}
${ratesBlock(`30 days ago (${thirtyDays})`, findRates(thirtyDays))}
${ratesBlock(`One year ago (${yearAgoDate})`, findRates(yearAgoDate))}

Rewrite the original brief following the structure rule. Output only the rewritten brief.${lastErr ? `\n\nYour previous draft was rejected: ${lastErr}. Use ONLY numbers copied from the original brief or listed in the reference data.` : ''}`;
}

// Deterministic style fixup: every validated rate decimal gets the word
  // "percent" right after it (before any trailing punctuation) if missing.
function fixupPercent(text: string): string {
  return text.replace(/\b(\d+\.\d{2})\b(?!\s?percent)/g, (m, num, off, full) => {
    const rest = full.slice(off + m.length);
    return rest.startsWith('.') ? `${num} percent.` : `${num} percent`;
  });
}

function validate(text: string, entry: SummaryEntry, refSets: RatePoint[][]): string | null {
  if (text.length < 600 || text.length > 5000) return `length ${text.length}`;
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(text)) return 'non-ascii';
  if (/[#*`]/.test(text)) return 'markdown';
  if (/^\s*-\s/m.test(text)) return 'list-dash';
  if (/\b[Ii]\b/.test(text)) return 'first-person';
  if ((text.match(/Treasury/g) || []).length < 3) return 'too-few-treasury';
  const first = text.split(/\n/)[0];
  if (/^The \S+ (Treasury )?(yield|rate) (closed|rose|fell) at/i.test(first)) return 'template-opener';
  const allowed = new Set(refSets.flat().map(r => r.rate.toFixed(2)));
  // Numbers already present in the original brief are always acceptable to carry over.
  for (const n of entry.blogSummary.match(/\b(\d+\.\d{2})\b/g) || []) allowed.add(n);
  const mentioned = text.match(/\b(\d+\.\d{2})\b/g) || [];
  if (mentioned.length < 5) return 'too-few-numbers';
  for (const m of mentioned) {
    if (!allowed.has(m)) return `unknown number ${m}`;
  }
  const allDecimals = text.match(/\d+\.\d{2}/g) || [];
  const withPercent = text.match(/\d+\.\d{2}(?=\s?percent)/g) || [];
  if (allDecimals.length !== withPercent.length) return 'rate missing percent';
  return null;
}

function deriveShort(long: string, fallback: string): string {
  const body = (long || fallback).replace(/\s+/g, ' ').trim();
  const sentences = body.split(/(?<=\.)\s+/);
  let out = '';
  for (const s of sentences) {
    if (out && (out + ' ' + s).length > 300) break;
    out = out ? out + ' ' + s : s;
  }
  out = out || body;
  if (out.length > 320) {
    const cut = out.slice(0, 320);
    let idx = -1;
    for (let i = 0; i < cut.length; i++) {
      if (cut[i] === '.' && !/\d/.test(cut[i - 1] ?? '')) idx = i;
    }
    out = idx > 40 ? cut.slice(0, idx + 1) : cut.slice(0, cut.lastIndexOf(' ')) + '...';
  }
  return out.trim();
}

async function writeAtomic(path: string, value: unknown) {
  const tmp = path + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await rename(tmp, path);
}

interface Progress { done: string[]; kept: string[] }
let progress: Progress = { done: [], kept: [] };
try { progress = JSON.parse(await readFile(progressPath, 'utf8')); } catch {}
if (targetDates) {
  const set = new Set(targetDates);
  progress.done = progress.done.filter(d => !set.has(d));
  progress.kept = progress.kept.filter(d => !set.has(d));
  await writeAtomic(progressPath, progress);
}

const bannedOpenings = (() => {
  const counts = new Map<string, number>();
  for (const s of summaries) {
    const first = (s.blogSummary || '').split(/(?<=\.)\s+/)[0].slice(0, 70).trim().toLowerCase();
    counts.set(first, (counts.get(first) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= 3).map(([o]) => o);
})();
const BANNED_OPENINGS = targetDates ? bannedOpenings : [];

const targets = summaries
  .filter(s => s.blogSummary && s.blogSummary.length > 0)
  .filter(s => !progress.done.includes(s.date) && !progress.kept.includes(s.date))
  .filter(s => !only || s.date === only)
  .filter(s => !targetDates || targetDates.includes(s.date))
  .sort((a, b) => a.date.localeCompare(b.date))
  .slice(0, limit === Infinity ? summaries.length : limit);

if (deriveOnly) {
  for (const s of summaries) {
    if (s.blogSummary) s.summary = deriveShort(s.blogSummary, s.summary);
  }
  await writeAtomic(summariesPath, summaries);
  console.log('Derived short summaries only. DONE.');
  process.exit(0);
}

console.log(`Rewriting ${targets.length} entries (${progress.done.length} already done, ${progress.kept.length} kept original)`);

const modelId = await discoverModelId();
console.log('Using model:', modelId);

let okCount = 0, keptCount = 0, seq = 0;

async function processEntry(entry: SummaryEntry) {
  const today = entry.date;
  const yesterday = getPreviousBusinessDay(today);
  const lastWeek = getPreviousBusinessDayFromDate(today, 5);
  const thirtyDays = getDateMinusDays(today, 30);
  const yearAgoDate = getOneYearAgoBusinessDay(today);
  const refSets = [
    entry.rates,
    findRates(yesterday) || [],
    findRates(lastWeek) || [],
    findRates(thirtyDays) || [],
    findRates(yearAgoDate) || [],
  ];

  let finalText: string | null = null;
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= 4 && !finalText; attempt++) {
    try {
      const res = await fetchLLMWithRetry({
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt(today) },
          { role: 'user', content: userPrompt(entry, lastErr) },
        ],
        max_tokens: 1400,
        temperature: 0.7,
      }, `rewrite ${today} #${attempt}`);
      const raw = (await parseLLMResponse(res, `rewrite ${today}`)).trim().replace(/^"|"$/g, '');
      const text = fixupPercent(raw);
      const err = validate(text, entry, refSets);
      if (err) {
        console.log(`  [${today}] attempt ${attempt} rejected: ${err}`);
        lastErr = err;
        continue;
      }
      finalText = text;
    } catch (e) {
      console.log(`  [${today}] attempt ${attempt} error: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (finalText) {
    entry.blogSummary = finalText;
    entry.summary = deriveShort(finalText, entry.summary);
    okCount++;
    progress.done.push(today);
  } else {
    keptCount++;
    progress.kept.push(today);
    console.log(`  [${today}] kept original after retries`);
  }
  await writeAtomic(progressPath, progress);
  // Persist data every 5 entries so a crash loses little.
  if ((++seq) % 5 === 0) await writeAtomic(summariesPath, summaries);
}

const CONCURRENCY = 5;
const queue = [...targets];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const next = queue.shift();
    if (!next) return;
    await processEntry(next);
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${next.date} ok=${okCount} kept=${keptCount} left=${queue.length}`);
  }
}));

await writeAtomic(summariesPath, summaries);
console.log(`DONE. rewritten=${okCount} keptOriginal=${keptCount}`);
