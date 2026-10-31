// Prebuild step: derives everything the old dynamic server generated on demand
// from src/data/*.json into site/public/. Runs before `astro build` (npm prebuild)
// locally, on Cloudflare Pages, and after each daily data update.
//   public/api/**        — static API snapshots (same shapes as the live API)
//   public/og-image/<date>.svg|.png — per-post OG images (PNG for social crawlers)
//   public/og/og.png     — branded fallback (latest generated PNG)
//   public/_redirects, public/_headers — CF Pages routing + headers
import { writeFile, mkdir, copyFile, readFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src', 'data');
const pub = join(root, 'public');

const readJson = async (name) => JSON.parse(await readFile(join(dataDir, name), 'utf8'));

// Trim prose on a word boundary so generated excerpts never end mid-word.
function truncateWords(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:]$/, '')}…`;
}
const writeJson = async (rel, value) => {
  const p = join(pub, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(value));
  console.log(`wrote public/${rel} (${(JSON.stringify(value).length / 1024).toFixed(0)}KB)`);
};
const writeText = async (rel, text) => {
  const p = join(pub, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, text);
  console.log(`wrote public/${rel}`);
};

const rates = await readJson('rates.json');
const summaries = await readJson('summaries.json');

// --- Data integrity + derived stats ------------------------------------------
// stats.json/maturities.json used to be exported once by the old API and went
// stale as new rate days landed. Derive both from rates.json on every build so
// the public API snapshots always match the data they describe.
const MATURITY_YEARS = {
  '4WK': 4 / 52, '6WK': 6 / 52, '2MO': 2 / 12, '3MO': 3 / 12, '4MO': 4 / 12,
  '6MO': 6 / 12, '1YR': 1, '2YR': 2, '3YR': 3, '5YR': 5, '7YR': 7,
  '10YR': 10, '20YR': 20, '30YR': 30,
};

function assertRatesIntegrity(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('rates.json is empty');
  let prev = '';
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`Invalid rate date: ${row.date}`);
    if (row.date <= prev) throw new Error(`rates.json is not strictly ascending at ${row.date}`);
    prev = row.date;
    if (!Array.isArray(row.rates) || row.rates.length < 9) {
      throw new Error(`Rate row ${row.date} has only ${row.rates?.length ?? 0} maturities`);
    }
    for (const r of row.rates) {
      if (!(r.maturity in MATURITY_YEARS)) throw new Error(`Unknown maturity ${r.maturity} on ${row.date}`);
      if (!Number.isFinite(r.rate) || r.rate < 0) throw new Error(`Invalid rate ${r.rate} (${r.maturity}) on ${row.date}`);
    }
  }
}
assertRatesIntegrity(rates);

const latestYear = rates[rates.length - 1].date.slice(0, 4);
const statByMaturity = new Map();
for (const row of rates) {
  for (const r of row.rates) {
    let s = statByMaturity.get(r.maturity);
    if (!s) {
      s = { maturity: r.maturity, yearHigh: null, yearHighDate: null, yearLow: null, yearLowDate: null,
            allTimeHigh: null, allTimeHighDate: null, allTimeLow: null, allTimeLowDate: null };
      statByMaturity.set(r.maturity, s);
    }
    if (row.date.startsWith(latestYear)) {
      if (s.yearHigh === null || r.rate > s.yearHigh) { s.yearHigh = r.rate; s.yearHighDate = row.date; }
      if (s.yearLow === null || r.rate < s.yearLow) { s.yearLow = r.rate; s.yearLowDate = row.date; }
    }
    if (s.allTimeHigh === null || r.rate > s.allTimeHigh) { s.allTimeHigh = r.rate; s.allTimeHighDate = row.date; }
    if (s.allTimeLow === null || r.rate < s.allTimeLow) { s.allTimeLow = r.rate; s.allTimeLowDate = row.date; }
  }
}
const stats = [...statByMaturity.values()].sort((a, b) => MATURITY_YEARS[a.maturity] - MATURITY_YEARS[b.maturity]);
const maturities = Object.entries(MATURITY_YEARS)
  .map(([maturity, years]) => ({ maturity, years }))
  .sort((a, b) => a.years - b.years);

const SITE_URL = 'https://yieldwatch.io';
const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });

// --- API snapshots ---------------------------------------------------------
const byDate = new Map(rates.map(r => [r.date, r]));
const latest = rates[rates.length - 1];

await writeJson('api/rates.json', {
  success: true,
  data: rates,
  meta: { from: rates[0].date, to: latest.date, maturity: 'all', count: rates.length, limit: rates.length, offset: 0, hasMore: false },
});

await writeJson('api/rates/latest.json', {
  success: true,
  data: { date: latest.date, dateFormatted: fmtDate(latest.date), rates: latest.rates },
});

await writeJson('api/rates/maturities.json', { success: true, data: maturities });
await writeJson('api/rates/stats.json', { success: true, data: stats });

// Range snapshots for the homepage chart (3m is also used for sparklines).
const rangeDefs = { '3m': 92, '6m': 183, '1y': 365, '2y': 730, '5y': 1826 };
const cutoff = (days) => {
  const d = new Date(latest.date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};
for (const [range, days] of Object.entries(rangeDefs)) {
  const data = rates.filter(r => r.date >= cutoff(days));
  await writeJson(`api/rates/${range}.json`, { success: true, data, meta: { from: data[0]?.date, to: latest.date, count: data.length, hasMore: false } });
}
await writeJson('api/rates/all.json', { success: true, data: rates, meta: { from: rates[0].date, to: latest.date, count: rates.length, hasMore: false } });

// Homepage daily-summary block (plain text).
const summariesDesc = [...summaries].sort((a, b) => b.date.localeCompare(a.date));
const latestSummary = summariesDesc.find(s => s.date <= latest.date) || summariesDesc[0];
await writeText('api/daily-summary', latestSummary ? latestSummary.summary : 'No summary available yet.');

// Blog API compat.
const years = [...new Set(summariesDesc.map(s => s.date.slice(0, 4)))].sort().reverse();
await writeJson('api/blog/years.json', { success: true, data: years });
await writeJson('api/blog/index.json', {
  success: true,
  data: summariesDesc.map(s => ({
    date: s.date,
    dateFormatted: s.dateFormatted || fmtDate(s.date),
    hasFullPost: Boolean(s.blogSummary && s.blogSummary.length > 0),
    excerpt: truncateWords((s.summary || s.blogSummary || '').trim().replace(/\s+/g, ' '), 200),
  })),
  meta: { count: summariesDesc.length },
});
for (const s of summaries) {
  await writeJson(`api/blog/${s.date}.json`, {
    success: true,
    data: { date: s.date, dateFormatted: s.dateFormatted || fmtDate(s.date), summary: s.summary, blogSummary: s.blogSummary, rates: s.rates },
  });
}

// Prune generated files for dates that no longer have a summary.
const summaryDates = new Set(summaries.map(s => s.date));
for (const file of await readdir(join(pub, 'api', 'blog'))) {
  const m = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
  if (m && !summaryDates.has(m[1])) await unlink(join(pub, 'api', 'blog', file));
}

// --- OG images ---------------------------------------------------------------
const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];

const escapeXmlText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function generateOgSvg(data, dateLabel = '') {
  const ratesMap = new Map(data.map(d => [d.maturity, d.rate]));
  const pts = MATURITY_ORDER.map(m => ({ maturity: m, rate: ratesMap.get(m) || 0 })).filter(r => r.rate > 0);
  const brand = `
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#08080d"/><stop offset="100%" style="stop-color:#151524"/></linearGradient>
      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:#6366f1"/><stop offset="50%" style="stop-color:#818cf8"/><stop offset="100%" style="stop-color:#a855f7"/></linearGradient>
      <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#6366f1;stop-opacity:0.28"/><stop offset="100%" style="stop-color:#6366f1;stop-opacity:0"/></linearGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/></pattern>
    </defs>
    <rect fill="url(#bg)" width="1200" height="630"/>
    <rect fill="url(#grid)" width="1200" height="630"/>
    <text x="64" y="62" fill="#a5b4fc" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="2">YIELDWATCH.IO</text>
    <text x="1136" y="62" text-anchor="end" fill="#8b8b9e" font-family="Helvetica, Arial, sans-serif" font-size="17" letter-spacing="1">OFFICIAL TREASURY RATES</text>
    <text x="64" y="128" fill="#f5f5fa" font-family="Helvetica, Arial, sans-serif" font-size="50" font-weight="700">U.S. Treasury Yield Curve</text>
    <text x="64" y="168" fill="#b8b8cc" font-family="Helvetica, Arial, sans-serif" font-size="24">${escapeXmlText(dateLabel)}${dateLabel ? '  ·  ' : ''}Par yields, all maturities</text>
    <text x="64" y="604" fill="#8b8b9e" font-family="Helvetica, Arial, sans-serif" font-size="20">Daily yield analysis and 35+ years of rate history</text>
    <text x="1136" y="604" text-anchor="end" fill="#a5b4fc" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700">yieldwatch.io</text>`;
  if (pts.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">${brand}
    <rect x="64" y="210" width="1072" height="330" rx="18" fill="#11111c" stroke="#2a2a40"/>
    <text x="600" y="388" text-anchor="middle" fill="#b8b8cc" font-family="Helvetica, Arial, sans-serif" font-size="32">No rate data available</text>
  </svg>`;
  }
  const maxRate = Math.max(...pts.map(r => r.rate));
  const minRate = Math.min(...pts.map(r => r.rate));
  const range = maxRate - minRate || 1;
  const chartX = 108, chartW = 984, chartTop = 262, chartBottom = 508;
  const spacing = pts.length > 1 ? chartW / (pts.length - 1) : 0;
  const yOf = (r) => chartBottom - ((r.rate - minRate) / range) * (chartBottom - chartTop);
  let pathD = '';
  pts.forEach((r, i) => { pathD += i === 0 ? `M ${chartX + i * spacing} ${yOf(r)}` : ` L ${chartX + i * spacing} ${yOf(r)}`; });
  const grid = [0, 0.5, 1].map(t => {
    const y = chartBottom - t * (chartBottom - chartTop);
    const v = minRate + t * range;
    return `<line x1="${chartX - 8}" y1="${y}" x2="${chartX + chartW}" y2="${y}" stroke="#ffffff" stroke-opacity="0.09" stroke-width="1"/>
      <text x="${chartX - 18}" y="${y + 5}" text-anchor="end" fill="#7d7d94" font-family="Helvetica, Arial, sans-serif" font-size="15">${v.toFixed(2)}%</text>`;
  }).join('\n    ');
  const labels = pts.map((r, i) => `<text x="${chartX + i * spacing}" y="540" text-anchor="middle" fill="#7d7d94" font-family="Helvetica, Arial, sans-serif" font-size="14">${escapeXmlText(r.maturity)}</text>`).join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">${brand}
    <rect x="64" y="210" width="1072" height="345" rx="18" fill="#11111c" stroke="#2a2a40"/>
    ${grid}
    <path d="${pathD} ${chartX + chartW} ${chartBottom} L ${chartX} ${chartBottom} Z" fill="url(#areaGrad)"/>
    <path d="${pathD}" fill="none" stroke="url(#lineGrad)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.map((r, i) => `<circle cx="${chartX + i * spacing}" cy="${yOf(r)}" r="7" fill="#6366f1" stroke="#0b0b14" stroke-width="3"/>`).join('\n    ')}
    ${labels}
  </svg>`;
}

const ogDir = join(pub, 'og-image');
await mkdir(ogDir, { recursive: true });
for (const s of summaries) {
  const day = byDate.get(s.date);
  const points = (day?.rates || s.rates || []).map(r => ({ maturity: r.maturity, rate: r.rate }));
  const svg = generateOgSvg(points, fmtDate(s.date));
  await writeFile(join(ogDir, `${s.date}.svg`), svg);
  // PNG twin: social crawlers (Facebook/X/LinkedIn) ignore SVG og:image.
  await writeFile(join(ogDir, `${s.date}.png`), await sharp(Buffer.from(svg)).png().toBuffer());
}
console.log(`wrote ${summaries.length} og-image SVGs + PNGs`);
for (const file of await readdir(ogDir)) {
  const m = file.match(/^(\d{4}-\d{2}-\d{2})\.(svg|png)$/);
  if (m && !summaryDates.has(m[1])) await unlink(join(ogDir, file));
}

// Keep the stable /og.png fallback current: prefer the branded PNG for the
// newest summary, and only fall back to the checked-in brand asset.
const ogAsset = join(root, 'scripts', 'assets', 'og.png');
const latestOg = summariesDesc[0]
  ? join(ogDir, `${summariesDesc[0].date}.png`)
  : null;
if (latestOg && existsSync(latestOg)) {
  await mkdir(join(pub, 'og'), { recursive: true });
  await copyFile(latestOg, join(pub, 'og', 'og.png'));
  console.log('wrote public/og/og.png from latest summary');
} else if (existsSync(ogAsset)) {
  await mkdir(join(pub, 'og'), { recursive: true });
  await copyFile(ogAsset, join(pub, 'og', 'og.png'));
  console.log('wrote public/og/og.png from brand asset');
}
const noDataSvg = generateOgSvg([], '');
await writeFile(join(pub, 'og-image', 'no-data.svg'), noDataSvg);
await writeFile(join(pub, 'og-image', 'no-data.png'), await sharp(Buffer.from(noDataSvg)).png().toBuffer());

// --- .well-known discovery endpoints (constants) -----------------------------
await writeText('.well-known/api-catalog', JSON.stringify({
  linkset: [
    {
      anchor: `${SITE_URL}/api/rates`,
      link: [
        { rel: 'service-desc', href: `${SITE_URL}/api-docs/` },
        { rel: 'service-doc', href: `${SITE_URL}/faq/` },
        { rel: 'status', href: `${SITE_URL}/health` },
        { rel: 'describedby', href: `${SITE_URL}/llms.txt` },
      ],
    },
  ],
}, null, 2));

await writeText('.well-known/mcp/server-card.json', JSON.stringify({
  serverInfo: {
    name: 'yieldwatch.io/treasury-api',
    version: '1.0.0',
    description: 'U.S. Treasury Yield Curve API - Real-time and historical yield curve data',
  },
  endpoint: `${SITE_URL}/api/rates`,
  capabilities: {
    tools: [
      { name: 'get_latest_yield_rates', description: 'Get the latest Treasury yield curve rates' },
      { name: 'get_historical_yield_rates', description: 'Get historical yield rates for a date range' },
      { name: 'get_available_maturities', description: 'Get available maturity tenors' },
      { name: 'get_yield_statistics', description: 'Get historical high/low statistics' },
      { name: 'get_blog_posts', description: 'Get paginated daily summary posts' },
    ],
    resources: [
      { name: 'daily-summaries', description: 'Daily Treasury yield curve analysis summaries' },
    ],
  },
}, null, 2));

// --- CF Pages routing + headers ----------------------------------------------
let redirects = `# Generated by scripts/gen-derived.mjs — do not edit by hand.
/api/rates /api/rates.json 200
/api/rates/latest /api/rates/latest.json 200
/api/rates/maturities /api/rates/maturities.json 200
/api/rates/stats /api/rates/stats.json 200
/api/blog/years /api/blog/years.json 200
/api/blog/index /api/blog/index.json 200
/api/blog /api/blog/index.json 200
/api/blog/ /api/blog/index.json 200
/health /health.json 200
/og /og-image/${latestSummary?.date ?? 'no-data'}.png 200
/og.png /og/og.png 200
# Legacy daily-summary URLs from the pre-2026 archive no longer have a page.
# Redirect the whole year to the complete archive instead of returning 404.
# 2026+ posts are untouched, so no live post is ever redirected.
/blog/2019-* /blog/archive/ 301
/blog/2020-* /blog/archive/ 301
/blog/2021-* /blog/archive/ 301
/blog/2022-* /blog/archive/ 301
/blog/2023-* /blog/archive/ 301
/blog/2024-* /blog/archive/ 301
/blog/2025-* /blog/archive/ 301
`;
// Old /blog?page=N pagination URLs are 301'd by Cloudflare Single Redirect
// rules in the dashboard — _redirects cannot match query strings in the source
// path (they'd collide on /blog).
await writeText('_redirects', redirects);

await writeText('_headers', `# Generated by scripts/gen-derived.mjs — do not edit by hand.
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; font-src 'self' data:; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  Link: <https://yieldwatch.io/llms.txt>; rel="llms-txt", <https://yieldwatch.io/sitemap.xml>; rel="sitemap", <https://yieldwatch.io/.well-known/api-catalog>; rel="api-catalog"
/og-image/*.png
  Content-Type: image/png
  Cache-Control: public, max-age=604800
/og-image/*.svg
  Content-Type: image/svg+xml
  Cache-Control: public, max-age=86400
/og
  Content-Type: image/png
  Cache-Control: public, max-age=604800
/api/daily-summary
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=3600
/api/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, HEAD
/health.json
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, HEAD
/*.json
  Cache-Control: public, max-age=3600
/*.xml
  Cache-Control: public, max-age=3600
/.well-known/api-catalog
  Content-Type: application/linkset+json; charset=utf-8
/.well-known/mcp/server-card.json
  Content-Type: application/json; charset=utf-8
`);

console.log('gen-derived complete. Latest data:', latest.date, '| latest summary:', latestSummary?.date ?? 'none');
