// Prebuild step: derives everything the old dynamic server generated on demand
// from src/data/*.json into site/public/. Runs before `astro build` (npm prebuild)
// locally, on Cloudflare Pages, and after each daily data update.
//   public/api/**        — static API snapshots (same shapes as the live API)
//   public/og-image/<date>.svg|.png — per-post OG images (PNG for social crawlers)
//   public/og/og.png     — brand image (copied from scripts/assets)
//   public/_redirects, public/_headers — CF Pages routing + headers
import { writeFile, mkdir, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'src', 'data');
const pub = join(root, 'public');

const readJson = async (name) => JSON.parse(await readFile(join(dataDir, name), 'utf8'));
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
let stats = [];
try { stats = await readJson('stats.json'); } catch { /* optional */ }
let maturities = [];
try { maturities = await readJson('maturities.json'); } catch { /* optional */ }

const SITE_URL = 'https://yieldwatch.io';
const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });

// --- API snapshots ---------------------------------------------------------
const byDate = new Map(rates.map(r => [r.date, r]));
const latest = rates[rates.length - 1];

await writeJson('api/rates.json', {
  success: true,
  data: rates,
  meta: { from: 'earliest', to: 'latest', maturity: 'all', count: rates.length, limit: rates.length, offset: 0, hasMore: false },
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
for (const s of summaries) {
  await writeJson(`api/blog/${s.date}.json`, {
    success: true,
    data: { date: s.date, dateFormatted: s.dateFormatted || fmtDate(s.date), summary: s.summary, blogSummary: s.blogSummary, rates: s.rates },
  });
}

// --- OG images ---------------------------------------------------------------
const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];

function generateOgSvg(data) {
  const ratesMap = new Map(data.map(d => [d.maturity, d.rate]));
  const pts = MATURITY_ORDER.map(m => ({ maturity: m, rate: ratesMap.get(m) || 0 })).filter(r => r.rate > 0);
  const maxRate = Math.max(...pts.map(r => r.rate));
  const minRate = Math.min(...pts.map(r => r.rate));
  const range = maxRate - minRate || 1;
  const chartX = 50, chartY = 50, chartW = 1100, chartH = 530;
  const spacing = chartW / (pts.length - 1);
  const yOf = (r) => chartY + chartH - ((r.rate - minRate + 0.5) / (range + 1)) * chartH;
  let pathD = '';
  pts.forEach((r, i) => { pathD += i === 0 ? `M ${chartX + i * spacing} ${yOf(r)}` : ` L ${chartX + i * spacing} ${yOf(r)}`; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#0a0a0f"/><stop offset="100%" style="stop-color:#12121a"/></linearGradient>
      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:#6366f1"/><stop offset="50%" style="stop-color:#818cf8"/><stop offset="100%" style="stop-color:#a855f7"/></linearGradient>
      <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#6366f1;stop-opacity:0.25"/><stop offset="100%" style="stop-color:#6366f1;stop-opacity:0"/></linearGradient>
    </defs>
    <rect fill="url(#bg)" width="1200" height="630"/>
    <path d="${pathD} ${chartX + chartW} ${chartY + chartH} L ${chartX} ${chartY + chartH} Z" fill="url(#areaGrad)"/>
    <path d="${pathD}" fill="none" stroke="url(#lineGrad)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.map((r, i) => `<circle cx="${chartX + i * spacing}" cy="${yOf(r)}" r="8" fill="#6366f1" stroke="white" stroke-width="3"/>`).join('\n    ')}
  </svg>`;
}

const ogDir = join(pub, 'og-image');
await mkdir(ogDir, { recursive: true });
for (const s of summaries) {
  const day = byDate.get(s.date);
  const points = (day?.rates || s.rates || []).map(r => ({ maturity: r.maturity, rate: r.rate }));
  const svg = generateOgSvg(points);
  await writeFile(join(ogDir, `${s.date}.svg`), svg);
  // PNG twin: social crawlers (Facebook/X/LinkedIn) ignore SVG og:image.
  await writeFile(join(ogDir, `${s.date}.png`), await sharp(Buffer.from(svg)).png().toBuffer());
}
console.log(`wrote ${summaries.length} og-image SVGs + PNGs`);

const ogAsset = join(root, 'scripts', 'assets', 'og.png');
if (existsSync(ogAsset)) {
  await mkdir(join(pub, 'og'), { recursive: true });
  await copyFile(ogAsset, join(pub, 'og', 'og.png'));
  console.log('wrote public/og/og.png');
}
const noDataSvg = generateOgSvg([]);
await writeFile(join(pub, 'og-image', 'no-data.svg'), noDataSvg);
await writeFile(join(pub, 'og-image', 'no-data.png'), await sharp(Buffer.from(noDataSvg)).png().toBuffer());

// --- .well-known discovery endpoints (constants) -----------------------------
await writeText('.well-known/api-catalog', JSON.stringify({
  linkset: [
    {
      anchor: `${SITE_URL}/api/rates`,
      link: [
        { rel: 'service-desc', href: `${SITE_URL}/api-docs` },
        { rel: 'service-doc', href: `${SITE_URL}/faq` },
        { rel: 'status', href: `${SITE_URL}/health` },
        { rel: 'describedby', href: `${SITE_URL}/og` },
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
      { name: 'get_latest_rates', description: 'Get the latest Treasury yield curve rates' },
      { name: 'get_rates_range', description: 'Get historical yield rates for a date range' },
      { name: 'get_maturities', description: 'Get available maturity tenors' },
      { name: 'get_stats', description: 'Get historical high/low statistics' },
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
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
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
  Cache-Control: public, max-age=86400
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
