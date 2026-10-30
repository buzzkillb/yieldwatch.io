// Post-build static audit for the YieldWatch site.
// Checks the built dist/ output for SEO/AEO/GEO regressions and broken links.
// Usage: node scripts/audit-site.mjs [distDir]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.argv[2] || join(process.cwd(), 'dist');
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
  noJsonLd: [], badJsonLd: [],
  missingOgImage: [], ogImageBroken: [],
  missingTwitterImage: [], missingOgAlt: [],
  missingSkipLink: [], missingMain: [],
  imgNoAlt: [],
  brokenInternal: {},
  thin: [],
  noLang: [], noViewport: [],
  noindex: [],
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

const canonMap = new Map();
for (const f of files) {
  const rel = '/' + relative(ROOT, f).replace(/index\.html$/, '').replace(/\\/g, '/');
  const html = readFileSync(f, 'utf8');
  const title = get(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const desc = get(html, /<meta\s+name="description"\s+content="([^"]*)"/i) || get(html, /<meta\s+content="([^"]*)"\s+name="description"/i);
  const canonical = get(html, /<link\s+rel="canonical"[^>]*?href="([^"]*)"/i);
  const robots = get(html, /<meta\s+name="robots"\s+content="([^"]*)"/i);
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];

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
    const expected = 'https://yieldwatch.io' + rel;
    if (canonical !== expected) report.badCanonical.push([rel, canonical]);
  }
  if (h1s.length !== 1) report.h1Issues.push([rel, h1s.length]);
  if (robots && /noindex/i.test(robots)) report.noindex.push(rel);

  const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  if (ld.length === 0) report.noJsonLd.push(rel);
  for (const m of ld) {
    try { JSON.parse(m[1].trim()); } catch (e) { report.badJsonLd.push([rel, String(e).slice(0, 80)]); }
  }

  const ogImg = get(html, /<meta\s+property="og:image"[^>]*?content="([^"]*)"/i);
  if (!ogImg) report.missingOgImage.push(rel);
  else if (ogImg.startsWith('https://yieldwatch.io/')) {
    const p = join(ROOT, ogImg.replace('https://yieldwatch.io/', ''));
    if (!existsSync(p)) report.ogImageBroken.push([rel, ogImg]);
  }

  const twitterImg = get(html, /<meta\s+name="twitter:image"[^>]*?content="([^"]*)"/i);
  const ogAlt = get(html, /<meta\s+property="og:image:alt"[^>]*?content="([^"]*)"/i);
  if (!twitterImg) report.missingTwitterImage.push(rel);
  if (!ogAlt) report.missingOgAlt.push(rel);
  if (!/class="yw-skip-link"/.test(html)) report.missingSkipLink.push(rel);
  if (!/<main\b[^>]*id="main-content"/i.test(html)) report.missingMain.push(rel);

  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    if (!/\balt\s*=/i.test(m[1])) report.imgNoAlt.push([rel, m[0].slice(0, 90)]);
  }

  const words = strip(html).split(/\s+/).filter(Boolean).length;
  if (words < 250) report.thin.push([rel, words]);

  if (!/<html[^>]*lang=/i.test(html)) report.noLang.push(rel);
  if (!/<meta\s+name="viewport"/i.test(html)) report.noViewport.push(rel);

  for (const m of html.replace(/<script[\s\S]*?<\/script>/gi, '').matchAll(/href="(\/[^"#?]*)/g)) {
    const href = m[1];
    const cands = [join(ROOT, href), join(ROOT, href, 'index.html'), join(ROOT, href.replace(/\/$/, '') + '.html')];
    if (!cands.some(existsSync)) (report.brokenInternal[href] ||= []).push(rel);
  }
}

report.dupTitle = Object.fromEntries(Object.entries(report.dupTitle).filter(([, v]) => v.length > 1));
report.dupDesc = Object.fromEntries(Object.entries(report.dupDesc).filter(([, v]) => v.length > 1));
report.canonConflicts = Object.fromEntries([...canonMap.entries()].filter(([, v]) => v.length > 1));
report.brokenInternalCount = Object.keys(report.brokenInternal).length;
report.ogImageBrokenCount = report.ogImageBroken.length;
report.dupTitleCount = Object.keys(report.dupTitle).length;
report.dupDescCount = Object.keys(report.dupDesc).length;
report.thinCount = report.thin.length;

console.log(JSON.stringify(report, null, 1));
