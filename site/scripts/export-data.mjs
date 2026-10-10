// One-time data export from the live API into build-time JSON files.
// Usage: node scripts/export-data.mjs [baseUrl]
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || 'https://yieldwatch.io').replace(/\/+$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
await mkdir(outDir, { recursive: true });

const j = async (p) => {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(BASE + p);
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && attempt <= 6) {
      const waitMs = Math.min(60000, 5000 * attempt);
      console.log(`${p} -> ${r.status}, retrying in ${waitMs / 1000}s (attempt ${attempt})`);
      await new Promise((res) => setTimeout(res, waitMs));
      continue;
    }
    throw new Error(`${p} -> ${r.status}`);
  }
};

const writeJson = async (name, value) => {
  await writeFile(join(outDir, name), JSON.stringify(value));
  console.log(`wrote ${name}`);
};

// 1. Full yield-curve history (single request; API MAX_LIMIT is 200000).
if (existsSync(join(outDir, 'rates.json'))) {
  console.log('rates.json already exists — skipping initial export');
} else {
  const rates = await j('/api/rates?limit=200000');
  if (!rates.success) throw new Error('rates export failed');
  await writeJson('rates.json', rates.data);

  // 2. Stats + maturities.
  const stats = await j('/api/rates/stats');
  await writeJson('stats.json', stats.data || []);
  const maturities = await j('/api/rates/maturities');
  await writeJson('maturities.json', maturities.data || []);
}

// 3. Paginate the blog list to collect every summary date (desc order).
const dates = [];
let page = 1;
for (;;) {
  const list = await j(`/api/blog/list?page=${page}`);
  if (!list.success) throw new Error('blog list failed');
  for (const item of list.data) dates.push(item.date);
  if (!list.pagination?.hasNextPage) break;
  page++;
}

// 4. Full summary text + rates per date (resumable: skips dates already saved).
const summariesPath = join(outDir, 'summaries.json');
let summaries = [];
try {
  summaries = JSON.parse(await readFile(summariesPath, 'utf8'));
  console.log(`resuming with ${summaries.length} existing summaries`);
} catch { /* first run */ }
const have = new Set(summaries.map(s => s.date));
for (const date of dates) {
  if (have.has(date)) continue;
  const s = await j(`/api/blog/${date}`);
  if (!s.success) throw new Error(`summary failed for ${date}`);
  summaries.push(s.data);
  await writeFile(summariesPath, JSON.stringify(summaries));
  await new Promise((r) => setTimeout(r, 250));
}
await writeFile(summariesPath, JSON.stringify(summaries));

console.log(`Done: ${summaries.length} summaries.`);
