// Post-build static audit for the YieldWatch site.
// Checks the built dist/ output for SEO/AEO/GEO regressions, broken links,
// sitemap/indexing consistency, and structured-data mistakes.
// Usage: node scripts/audit-site.mjs [distDir]
// Exits non-zero when any check fails so CI catches regressions.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.argv[2] || join(process.cwd(), 'dist');
const SITE = 'https://yieldwatch.io';
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (e.endsWith('.html')) files.push(p);
  }
})(ROOT);

const report = {
  totalPages: files.length,
  missingTitle: [], longTitle: [], dupTitle: {},
  missingDesc: [], longDesc: [], dupDesc: {},
  missingCanonical: [], badCanonical: [],
  h1Issues: [],
  noJsonLd: [], badJsonLd: [], dupSchemaId: [], badBreadcrumb: [],
  missingOgImage: [], ogImageBroken: [],
  missingTwitterImage: [], missingOgAlt: [],
  missingSocialMeta: [],
  missingSkipLink: [], missingMain: [],
  imgNoAlt: [],
  brokenInternal: {}, brokenAnchor: {},
  thin: [],
  noLang: [], noViewport: [],
  noindex: [],
  missingFromSitemap: [], sitemapMissingFiles: [], noindexInSitemap: [],
};

function get(html, re) { const m = html.match(re); return m ? m[1] : null; }
function strip(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectBreadcrumbs(node, out) {
  if (Array.isArray(node)) { for (const n of node) collectBreadcrumbs(n, out); return; }
  if (!node || typeof node !== 'object') return;
  if (node['@type'] === 'BreadcrumbList') out.push(node);
  for (const v of Object.values(node)) collectBreadcrumbs(v, out);
}

function collectSchemaIds(node, out, defined) {
  if (Array.isArray(node)) { for (const n of node) collectSchemaIds(n, out, defined); return; }
  if (!node || typeof node !== 'object') return;
  if (node['@id'] && node['@type']) {
    if (defined.has(node['@id'])) out.push(node['@id']);
    defined.add(node['@id']);
  }
  for (const v of Object.values(node)) collectSchemaIds(v, out, defined);
}

const canonMap = new Map();
for (const f of files) {
  const rel = '/' + relative(ROOT, f).replace(/index\.html$/, '').replace(/\\/g, '/');
  const html = readFileSync(f, 'utf8');
  const title = get(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const desc = get(html, /<meta\s+name="description"\s+content="([^"]*)"/i) || get(html, /<meta\s+content="([^"]*)"\s+name="description"/i);
  const canonical = get(html, /<link\s+rel="canonical"[^>]*?href="([^"]*)"/i);
  const robots = get(html, /<meta\s+name="robots"\s+content="([^"]*)"/i);
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const isNoindex = Boolean(robots && /noindex/i.test(robots));

  if (!title) report.missingTitle.push(rel);
  else {
    const t = title.replace(/\s+/g, ' ').trim();
    if (t.length > 65) report.longTitle.push([rel, t.length, t]);
    (report.dupTitle[t] ||= []).push(rel);
  }
  if (!desc) report.missingDesc.push(rel);
  else {
    if (desc.length > 165) report.longDesc.push([rel, desc.length]);
    (report.dupDesc[desc] ||= []).push(rel);
  }
  if (!canonical) report.missingCanonical.push(rel);
  else {
    (canonMap.get(canonical) || canonMap.set(canonical, []).get(canonical)).push(rel);
    const expected = SITE + (rel === '/404.html' ? '/404' : rel);
    if (canonical !== expected) report.badCanonical.push([rel, canonical]);
  }
  if (h1s.length !== 1) report.h1Issues.push([rel, h1s.length]);
  if (isNoindex) report.noindex.push(rel);

  const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  if (ld.length === 0) report.noJsonLd.push(rel);
  const definedIds = new Set();
  for (const m of ld) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const dups = [];
      collectSchemaIds(parsed, dups, definedIds);
      for (const id of dups) report.dupSchemaId.push([rel, id]);
      const crumbs = [];
      collectBreadcrumbs(parsed, crumbs);
      for (const bc of crumbs) {
        const items = bc.itemListElement;
        if (!Array.isArray(items) || items.length === 0) {
          report.badBreadcrumb.push([rel, 'empty itemListElement']);
          continue;
        }
        if (!items.every((it, i) => Number(it.position) === i + 1)) report.badBreadcrumb.push([rel, 'non-sequential positions']);
        const urls = items.map(it => it.item);
        if (new Set(urls).size !== urls.length) report.badBreadcrumb.push([rel, 'duplicate item URLs']);
        const leaf = items[items.length - 1];
        if (canonical && leaf.item !== canonical) report.badBreadcrumb.push([rel, `leaf ${leaf.item} != ${canonical}`]);
      }
    } catch (e) { report.badJsonLd.push([rel, String(e).slice(0, 80)]); }
  }

  const ogImg = get(html, /<meta\s+property="og:image"[^>]*?content="([^"]*)"/i);
  if (!ogImg) report.missingOgImage.push(rel);
  else if (ogImg.startsWith(SITE + '/')) {
    const p = join(ROOT, ogImg.replace(SITE + '/', ''));
    if (!existsSync(p)) report.ogImageBroken.push([rel, ogImg]);
  }

  const twitterImg = get(html, /<meta\s+name="twitter:image"[^>]*?content="([^"]*)"/i);
  const ogAlt = get(html, /<meta\s+property="og:image:alt"[^>]*?content="([^"]*)"/i);
  if (!twitterImg) report.missingTwitterImage.push(rel);
  if (!ogAlt) report.missingOgAlt.push(rel);

  for (const [name, re] of [
    ['og:url', /<meta\s+property="og:url"[^>]*?content="([^"]*)"/i],
    ['og:type', /<meta\s+property="og:type"[^>]*?content="([^"]*)"/i],
    ['og:site_name', /<meta\s+property="og:site_name"[^>]*?content="([^"]*)"/i],
    ['twitter:card', /<meta\s+name="twitter:card"[^>]*?content="([^"]*)"/i],
  ]) {
    if (!get(html, re)) report.missingSocialMeta.push([rel, name]);
  }

  if (!/class="yw-skip-link"/.test(html)) report.missingSkipLink.push(rel);
  if (!/<main\b[^>]*id="main-content"/i.test(html)) report.missingMain.push(rel);

  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    if (!/\balt\s*=/i.test(m[1])) report.imgNoAlt.push([rel, m[0].slice(0, 90)]);
  }

  // Thin content only matters for pages we ask search engines to index.
  const words = strip(html).split(/\s+/).filter(Boolean).length;
  if (words < 250 && !isNoindex) report.thin.push([rel, words]);

  if (!/<html[^>]*lang=/i.test(html)) report.noLang.push(rel);
  if (!/<meta\s+name="viewport"/i.test(html)) report.noViewport.push(rel);

  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  for (const m of noScript.matchAll(/href="(\/[^"?]*)/g)) {
    const href = m[1];
    const [path, fragment] = href.split('#');
    const cands = [join(ROOT, path), join(ROOT, path, 'index.html'), join(ROOT, path.replace(/\/$/, '') + '.html')];
    if (!cands.some(existsSync)) (report.brokenInternal[href] ||= []).push(rel);
    else if (fragment) {
      const target = cands.find(existsSync);
      if (target.endsWith('.html')) {
        const targetHtml = readFileSync(target, 'utf8');
        if (!new RegExp(`\\bid="${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(targetHtml)) {
          (report.brokenAnchor[href] ||= []).push(rel);
        }
      }
    }
  }
  for (const m of noScript.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.has(m[1])) (report.brokenAnchor['#' + m[1]] ||= []).push(rel);
  }
}

// Sitemap ↔ page consistency.
const sitemapPath = join(ROOT, 'sitemap.xml');
const sitemapUrls = new Set();
if (existsSync(sitemapPath)) {
  const xml = readFileSync(sitemapPath, 'utf8');
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) sitemapUrls.add(m[1]);
} else {
  report.sitemapMissingFiles.push('sitemap.xml');
}
for (const url of sitemapUrls) {
  if (!url.startsWith(SITE + '/')) continue;
  const path = url.slice(SITE.length);
  const cands = [join(ROOT, path), join(ROOT, path, 'index.html'), join(ROOT, path.replace(/\/$/, '') + '.html')];
  if (!cands.some(existsSync)) report.sitemapMissingFiles.push(url);
}
for (const rel of report.noindex) {
  const url = SITE + rel;
  if (sitemapUrls.has(url)) report.noindexInSitemap.push(url);
}
for (const f of files) {
  const rel = '/' + relative(ROOT, f).replace(/index\.html$/, '').replace(/\\/g, '/');
  if (report.noindex.includes(rel)) continue;
  if (!sitemapUrls.has(SITE + rel)) report.missingFromSitemap.push(rel);
}

report.dupTitle = Object.fromEntries(Object.entries(report.dupTitle).filter(([, v]) => v.length > 1));
report.dupDesc = Object.fromEntries(Object.entries(report.dupDesc).filter(([, v]) => v.length > 1));
report.canonConflicts = Object.fromEntries([...canonMap.entries()].filter(([, v]) => v.length > 1));
report.brokenInternalCount = Object.keys(report.brokenInternal).length;
report.brokenAnchorCount = Object.keys(report.brokenAnchor).length;
report.ogImageBrokenCount = report.ogImageBroken.length;
report.dupTitleCount = Object.keys(report.dupTitle).length;
report.dupDescCount = Object.keys(report.dupDesc).length;
report.dupSchemaIdCount = report.dupSchemaId.length;
report.missingSocialMetaCount = report.missingSocialMeta.length;
report.thinCount = report.thin.length;
report.sitemapUrlCount = sitemapUrls.size;
report.missingFromSitemapCount = report.missingFromSitemap.length;
report.sitemapMissingFilesCount = report.sitemapMissingFiles.length;
report.noindexInSitemapCount = report.noindexInSitemap.length;
report.issueCount = [
  'missingTitle', 'longTitle', 'dupTitleCount', 'missingDesc', 'longDesc', 'dupDescCount',
  'missingCanonical', 'badCanonical', 'canonConflicts', 'h1Issues', 'noJsonLd', 'badJsonLd',
  'badBreadcrumb', 'dupSchemaIdCount', 'missingOgImage', 'ogImageBrokenCount', 'missingTwitterImage', 'missingOgAlt',
  'missingSocialMetaCount', 'missingSkipLink', 'missingMain', 'imgNoAlt', 'brokenInternalCount',
  'brokenAnchorCount', 'thinCount', 'noLang', 'noViewport', 'missingFromSitemapCount',
  'sitemapMissingFilesCount', 'noindexInSitemapCount',
].reduce((sum, key) => {
  const value = report[key];
  if (Array.isArray(value)) return sum + value.length;
  if (value && typeof value === 'object') return sum + Object.keys(value).length;
  return sum + (Number(value) || 0);
}, 0);

console.log(JSON.stringify(report, null, 1));
if (report.issueCount > 0) process.exit(1);
