// Shared site data + helpers for the static build.
// Single source of truth: src/data/*.json (updated daily by scripts/daily-update.mjs).
import { readFileSync } from 'node:fs';
import { applyChrome, type ChromeActive } from './chrome';
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

// Server-rendered, VISIBLE summary for the homepage. Google classified the old
// off-screen (-9999px) block as a Soft 404 because Googlebot saw only ~100 words
// and no visible H1. Keep this content genuinely visible: it is the crawlable
// description of the dashboard and the canonical answer block for AEO/GEO.
export function buildSeoBlock(day: RateDay): string {
  const SEO_MATURITY_ORDER = ['4WK', '6WK', '1MO', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];
  const label = (m: string) => {
    const weeks = /^(\d+)WK$/.exec(m);
    if (weeks) return `${weeks[1]}-week bill`;
    const months = /^(\d+)MO$/.exec(m);
    if (months) return `${months[1]}-month bill`;
    const years = /^(\d+)YR$/.exec(m);
    if (years) return `${years[1]}-year`;
    return m;
  };
  const sorted = [...day.rates].sort(
    (a, b) => SEO_MATURITY_ORDER.indexOf(a.maturity) - SEO_MATURITY_ORDER.indexOf(b.maturity)
  );
  const keyRates = ['4WK', '2YR', '10YR', '30YR']
    .map(m => sorted.find(r => r.maturity === m))
    .filter((r): r is { maturity: string; rate: number } => Boolean(r))
    .map(r => `${label(r.maturity)} at ${r.rate.toFixed(2)} percent`);
  const formatted = dateFormatted(day.date);
  const rows = sorted.map(r => `      <tr><td style="padding:0.4rem 0.75rem;border-bottom:1px solid var(--border-color,#2a2a3a);">${label(r.maturity)}</td><td style="padding:0.4rem 0.75rem;border-bottom:1px solid var(--border-color,#2a2a3a);text-align:right;font-variant-numeric:tabular-nums;">${r.rate.toFixed(2)}%</td></tr>`).join('\n');
  return `<section id="seo-static-rates" aria-label="Current Treasury rates summary" style="margin-bottom:1.75rem;">
  <h1 style="font-size:2rem;line-height:1.25;font-weight:600;margin-bottom:0.75rem;background:linear-gradient(135deg,var(--text-primary,#f0f0f5),var(--accent,#6366f1));-webkit-background-clip:text;background-clip:text;color:transparent;">U.S. Treasury Yield Curve Rates</h1>
  <p style="color:var(--text-secondary,#a0a0b0);margin-bottom:0.9rem;max-width:760px;">Latest published U.S. Treasury par yield curve rates for ${formatted}: ${keyRates.join(', ')}. The table below lists the full curve published by the U.S. Department of the Treasury.</p>
  <table style="border-collapse:collapse;width:100%;max-width:640px;margin:0 0 1rem;font-size:0.95rem;">
    <caption style="text-align:left;color:var(--text-muted,#606070);font-size:0.85rem;padding-bottom:0.35rem;">Treasury par yield curve rates, ${formatted}</caption>
    <thead><tr><th scope="col" style="text-align:left;padding:0.4rem 0.75rem;border-bottom:1px solid var(--border-color,#2a2a3a);">Maturity</th><th scope="col" style="text-align:right;padding:0.4rem 0.75rem;border-bottom:1px solid var(--border-color,#2a2a3a);">Yield</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p style="color:var(--text-secondary,#a0a0b0);max-width:760px;">The yield curve shows the yield on Treasury securities across maturities. An inverted curve, where short-term yields exceed long-term yields, has historically preceded economic recessions. YieldWatch tracks 35+ years of historical data and publishes a <a href="/blog/" style="color:var(--accent,#6366f1);">plain-English daily summary</a>; see the <a href="/faq/" style="color:var(--accent,#6366f1);">FAQ</a> for definitions and context.</p>
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
export function buildRssFeed(posts: { date: string; excerpt: string; title?: string }[]): string {
  const items = posts.map(post => {
    const url = `${SITE_URL}/blog/${post.date}/`;
    const pubDate = new Date(`${post.date}T20:00:00Z`).toUTCString();
    const title = post.title || `Treasury Yield Curve Summary for ${post.date}`;
    return `    <item>
      <title>${escapeXml(title)}</title>
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
    <link>${SITE_URL}/blog/</link>
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
  // Pages whose content is edited by hand. Bump this when their copy changes so
  // lastmod stays honest instead of resetting on every daily data rebuild.
  const STATIC_CONTENT_UPDATED = '2026-10-30';
  const urls: { loc: string; lastmod: string; changefreq: string; priority: string }[] = [
    { loc: `${SITE_URL}/`, lastmod: today, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE_URL}/blog/`, lastmod: today, changefreq: 'daily', priority: '0.9' },
    { loc: `${SITE_URL}/blog/archive/`, lastmod: today, changefreq: 'daily', priority: '0.8' },
    { loc: `${SITE_URL}/methodology/`, lastmod: STATIC_CONTENT_UPDATED, changefreq: 'monthly', priority: '0.7' },
    { loc: `${SITE_URL}/about/`, lastmod: STATIC_CONTENT_UPDATED, changefreq: 'monthly', priority: '0.6' },
    { loc: `${SITE_URL}/api-docs/`, lastmod: STATIC_CONTENT_UPDATED, changefreq: 'weekly', priority: '0.7' },
    { loc: `${SITE_URL}/faq/`, lastmod: STATIC_CONTENT_UPDATED, changefreq: 'weekly', priority: '0.7' },
  ];
  // Paginated listing pages canonicalize to /blog/ and Google reports them as
  // "Alternate page with proper canonical tag". Keep them out of the sitemap so
  // it only lists final, self-canonical URLs; every post is still listed below.
  for (const s of SUMMARIES) {
    urls.push({ loc: `${SITE_URL}/blog/${s.date}/`, lastmod: s.date, changefreq: 'weekly', priority: '0.8' });
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
export function readTemplate(name: string, active: ChromeActive = null): string {
  const raw = readFileSync(join(process.cwd(), 'src', 'templates', name), 'utf8');
  return applyChrome(raw, active);
}

// ---------------------------------------------------------------------------
// Anti-duplication + internal-linking helpers.
// ---------------------------------------------------------------------------

const summariesByDate = new Map(SUMMARIES.map(s => [s.date, s]));

export function blogTotalPages(): number {
  return Math.max(1, Math.ceil(SUMMARIES.length / POSTS_PER_PAGE));
}

function maturitySubject(m: string): string {
  if (m.endsWith('WK')) return `${m.slice(0, -2)}-Week Bill Rate`;
  if (m.endsWith('MO')) return `${m.slice(0, -2)}-Month Bill Rate`;
  return `${m.slice(0, -2)}-Year Yield`;
}

// Data-driven, unique-per-day headline derived from the largest day-over-day
// move. Replaces the templated "October 9, 2026 | Treasury Yield Daily" title
// pattern that made every post look identical to crawlers. Deterministic.
export function postHeadline(date: string): string {
  const dayLabel = linkLabel(date);
  const entry = summariesByDate.get(date);
  const idx = RATES.findIndex(d => d.date === date);
  const prev = idx > 0 ? RATES[idx - 1] : null;
  if (!entry || !prev) return `Treasury Yield Curve Summary (${dayLabel})`;
  const changes = entry.rates
    .map(r => {
      const p = prev.rates.find(x => x.maturity === r.maturity);
      return p ? { maturity: r.maturity, rate: r.rate, delta: r.rate - p.rate } : null;
    })
    .filter((c): c is { maturity: string; rate: number; delta: number } => c !== null);
  if (changes.length === 0) return `Treasury Yield Curve Summary (${dayLabel})`;
  const max = changes.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));
  const subject = maturitySubject(max.maturity);
  const rateStr = max.rate.toFixed(2);
  const bps = Math.round(Math.abs(max.delta) * 100);
  if (bps === 0) return `Treasury Yields Unchanged, ${subject} Holds at ${rateStr}% (${dayLabel})`;
  if (bps < 5) return `Treasury Yields Little Changed, ${subject} at ${rateStr}% (${dayLabel})`;
  return `${subject} ${max.delta > 0 ? 'Rises' : 'Falls'} ${bps} bps to ${rateStr}% (${dayLabel})`;
}

export interface PostLink { date: string; headline: string }

// Deterministic related-post selection: adjacent days, calendar week/year
// lookbacks, same-month posts, then hash-rotated picks from other months.
// Gives every post ~8 varied internal links regardless of its age.
export function relatedPosts(date: string, cap = 8): PostLink[] {
  const all = SUMMARIES.map(s => s.date).sort();
  const seen = new Set<string>([date]);
  const out: PostLink[] = [];
  const push = (d?: string) => {
    if (!d || out.length >= cap || seen.has(d) || !summariesByDate.has(d)) return;
    seen.add(d);
    out.push({ date: d, headline: postHeadline(d) });
  };
  const i = all.indexOf(date);
  push(all[i - 1]);
  push(all[i + 1]);
  const shift = (days: number) => {
    const dt = new Date(date + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - days);
    return dt.toISOString().slice(0, 10);
  };
  push(shift(7));
  push(shift(365));
  for (const d of [...all].reverse()) {
    if (out.length >= cap) break;
    if (d.startsWith(date.slice(0, 7))) push(d);
  }
  let h = 7;
  for (let k = 0; k < date.length; k++) h = (h * 31 + date.charCodeAt(k)) >>> 0;
  const pool = all.filter(d => !d.startsWith(date.slice(0, 7)));
  for (const k of [0, 1, 2]) {
    if (out.length >= cap) break;
    push(pool[(h + k * 97) % pool.length]);
  }
  return out;
}
