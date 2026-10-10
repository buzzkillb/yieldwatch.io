// Shared site data + helpers for the static build.
// Single source of truth: src/data/*.json (updated daily by scripts/daily-update.mjs).
import { readFileSync } from 'node:fs';
import ratesJson from '../data/rates.json';
import summariesJson from '../data/summaries.json';
import statsJson from '../data/stats.json';
import maturitiesJson from '../data/maturities.json';

export interface RatePoint { maturity: string; rate: number }
export interface RateDay { date: string; rates: RatePoint[] }
export interface SummaryEntry {
  date: string;
  dateFormatted: string;
  summary: string;
  blogSummary: string;
  rates: RatePoint[];
}

export const RATES = ratesJson as RateDay[];
export const SUMMARIES = summariesJson as SummaryEntry[];
export const STATS = statsJson as unknown as {
  maturity: string; yearHigh: number | null; yearHighDate: string | null;
  yearLow: number | null; yearLowDate: string | null;
  allTimeHigh: number | null; allTimeHighDate: string | null;
  allTimeLow: number | null; allTimeLowDate: string | null;
}[];
export const MATURITIES = maturitiesJson as { maturity: string; years: number }[];

export const SITE_URL = 'https://yieldwatch.io';
export const POSTS_PER_PAGE = 5;

const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];
export const CHART_COLORS = ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];

export function sortRates(rates: RatePoint[]): RatePoint[] {
  return [...rates].sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity));
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function dateFormatted(date: string): string {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function linkLabel(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function formatBlogSummary(text: string): string {
  return text
    .split(/\n\n+/)
    .filter((p: string) => p.trim())
    .map((p: string) => `<p>${escapeHtml(p.trim())}</p>`)
    .join('');
}

export function latestDay(): RateDay {
  return RATES[RATES.length - 1];
}

export function recentDays(n: number): RateDay[] {
  return RATES.slice(-n);
}

// Replicates the SSR "seo-static-rates" block from api/src/index.ts.
// NOTE: rates are stored in the API's own (lexicographic) order — do not re-sort.
export function buildSeoBlock(day: RateDay): string {
  const keyRates = day.rates
    .filter(r => ['4WK', '2YR', '10YR', '30YR'].includes(r.maturity))
    .map(r => `${r.maturity === '4WK' ? '4-week' : r.maturity.replace('YR', '-year')} Treasury ${(r.maturity === '4WK' ? 'bill rate' : 'yield')} at ${r.rate.toFixed(2)} percent`);
  const formatted = dateFormatted(day.date);
  return `<section id="seo-static-rates" aria-label="Current Treasury rates summary">
  <h2 style="position:absolute;left:-9999px;">Current U.S. Treasury Yield Curve Rates</h2>
  <p style="position:absolute;left:-9999px;">U.S. Treasury yield curve rates for ${formatted}: ${keyRates.join(', ')}. The full Treasury yield curve with 35+ years of historical data is available on this dashboard and in our daily summaries.</p>
</section>`;
}

// Ported from api/src/index.ts generateOgSvg — string SVG, no sharp required.
export function generateOgSvg(data: { maturity: string; rate: number }[] | string, date?: string, errorMsg?: string): string {
  if (typeof data === 'string' || errorMsg) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
      <rect fill="#0a0a0f" width="1200" height="630"/>
      <text x="600" y="315" font-family="system-ui, sans-serif" font-size="32" fill="#6366f1" text-anchor="middle">No Data</text>
    </svg>`;
  }
  const maturities = MATURITY_ORDER;
  const ratesMap = new Map(data.map(d => [d.maturity, d.rate]));
  const rates = maturities.map(m => ({ maturity: m, rate: ratesMap.get(m) || 0 }));
  const maxRate = Math.max(...rates.map(r => r.rate));
  const minRate = Math.min(...rates.map(r => r.rate));
  const rateRange = maxRate - minRate || 1;

  const chartX = 50, chartY = 50, chartW = 1100, chartH = 530;
  const pointSpacing = chartW / (rates.length - 1);

  let pathD = '';
  rates.forEach((r, i) => {
    const x = chartX + i * pointSpacing;
    const y = chartY + chartH - ((r.rate - minRate + 0.5) / (rateRange + 1)) * chartH;
    pathD += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#0a0a0f"/>
        <stop offset="100%" style="stop-color:#12121a"/>
      </linearGradient>
      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#6366f1"/>
        <stop offset="50%" style="stop-color:#818cf8"/>
        <stop offset="100%" style="stop-color:#a855f7"/>
      </linearGradient>
      <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:#6366f1;stop-opacity:0.25"/>
        <stop offset="100%" style="stop-color:#6366f1;stop-opacity:0"/>
      </linearGradient>
    </defs>

    <rect fill="url(#bg)" width="1200" height="630"/>
    <path d="${pathD} ${chartX + chartW} ${chartY + chartH} L ${chartX} ${chartY + chartH} Z" fill="url(#areaGrad)"/>
    <path d="${pathD}" fill="none" stroke="url(#lineGrad)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>

    ${rates.map((r, i) => {
      const x = chartX + i * pointSpacing;
      const y = chartY + chartH - ((r.rate - minRate + 0.5) / (rateRange + 1)) * chartH;
      return `<circle cx="${x}" cy="${y}" r="8" fill="#6366f1" stroke="white" stroke-width="3"/>`;
    }).join('\n    ')}
  </svg>`;
}

// Ported from api/src/routes/sitemap.ts (pure function).
export function buildRssFeed(posts: { date: string; excerpt: string }[]): string {
  const items = posts.map(post => {
    const url = `${SITE_URL}/blog/${post.date}`;
    const pubDate = new Date(`${post.date}T20:00:00Z`).toUTCString();
    return `    <item>
      <title>Treasury Yield Curve Summary for ${escapeXml(post.date)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(post.excerpt)}</description>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>YieldWatch Daily Summaries</title>
    <link>${SITE_URL}/blog</link>
    <description>Plain-English daily analysis of U.S. Treasury yield curve rates, published every business day.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSitemap(): string {
  const today = new Date().toISOString().split('T')[0];
  const urls: { loc: string; lastmod: string; changefreq: string; priority: string }[] = [
    { loc: `${SITE_URL}/`, lastmod: today, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE_URL}/blog`, lastmod: today, changefreq: 'daily', priority: '0.9' },
    { loc: `${SITE_URL}/api-docs`, lastmod: today, changefreq: 'weekly', priority: '0.7' },
    { loc: `${SITE_URL}/faq`, lastmod: today, changefreq: 'weekly', priority: '0.7' },
  ];
  for (const s of SUMMARIES) {
    urls.push({ loc: `${SITE_URL}/blog/${s.date}`, lastmod: s.date, changefreq: 'weekly', priority: '0.8' });
  }
  const entries = urls.map(u => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${escapeXml(u.lastmod)}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries}
</urlset>`;
}

// Read a verbatim template copied from api/public.
// Anchored to the project root (cwd) because import.meta.url moves when Astro
// compiles this module into dist/.
import { join } from 'node:path';
export function readTemplate(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'templates', name), 'utf8');
}
