import fs from 'fs';
import path from 'path';

const root = process.argv[2] || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
const htmls = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) htmls.push(p);
  }
})(root);
const urlOf = (f) => '/' + path.relative(root, f).replace(/index\.html$/, '').replace(/\.html$/, '');

const issues = [];
const add = (kind, url, detail) => issues.push({ kind, url, detail });

let totalIds = 0;
for (const f of htmls) {
  const u = urlOf(f);
  const html = fs.readFileSync(f, 'utf8');
  if (!/<html[^>]*\blang=/.test(html)) add('missing-lang', u, 'html has no lang attribute');
  if (!/<meta[^>]*name="viewport"/i.test(html)) add('missing-viewport', u, 'no viewport meta');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  totalIds += ids.length;
  const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupIds.length) add('duplicate-id', u, [...new Set(dupIds)].join(', '));
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1]);
  if (h1.length !== 1) add('h1-count', u, String(h1.length));
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((m) => +m[1]);
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] - headings[i - 1] > 1) {
      add('heading-skip', u, `h${headings[i - 1]} -> h${headings[i]}`);
      break;
    }
  }
  for (const m of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (/target="_blank"/i.test(attrs) && !/rel="[^"]*noopener/i.test(attrs)) add('target-blank-noopener', u, attrs.slice(0, 120));
    const href = (attrs.match(/href="([^"]*)"/i) || [, ''])[1];
    if (href.startsWith('#') && href.length > 1) {
      const id = href.slice(1);
      if (!ids.includes(id)) add('broken-anchor', u, href);
    }
  }
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { add('jsonld-parse', u, String(e.message).slice(0, 80)); continue; }
    if (!data['@context']) add('jsonld-context', u, 'missing @context');
    const graph = data['@graph'] || [data];
    for (const node of graph) {
      const t = node['@type'];
      if (t === 'Article' || t === 'TechArticle') {
        for (const k of ['headline', 'datePublished', 'author', 'publisher']) if (!node[k]) add('jsonld-article', u, `missing ${k}`);
      }
      if (t === 'FAQPage' && !Array.isArray(node.mainEntity)) add('jsonld-faq', u, 'missing mainEntity');
      if (t === 'Dataset' && (!node.name || !node.description)) add('jsonld-dataset', u, 'missing name/description');
    }
  }
}

const sm = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const lastmods = [...sm.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
const now = Date.now();
for (const lm of lastmods) {
  const t = Date.parse(lm);
  if (Number.isNaN(t)) add('sitemap-lastmod-invalid', 'sitemap', lm);
  else if (t > now + 86400000) add('sitemap-lastmod-future', 'sitemap', lm);
}
const badLoc = locs.filter((l) => !l.startsWith('https://yieldwatch.io/'));
if (badLoc.length) add('sitemap-host', 'sitemap', badLoc.slice(0, 3).join(', '));

const feed = fs.readFileSync(path.join(root, 'feed.xml'), 'utf8');
if (!/<rss[\s>]/.test(feed)) add('feed-invalid', 'feed.xml', 'no rss element');
if (!/<channel>/.test(feed)) add('feed-invalid', 'feed.xml', 'no channel');

const apiDir = path.join(root, 'api');
const jsons = [];
(function walkJ(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkJ(p);
    else if (e.name.endsWith('.json')) jsons.push(p);
  }
})(apiDir);
for (const j of jsons) {
  try { JSON.parse(fs.readFileSync(j, 'utf8')); } catch (e) { add('json-parse', j.replace(root, ''), String(e.message).slice(0, 80)); }
}

for (const wk of ['.well-known/api-catalog', '.well-known/mcp/server-card.json']) {
  const p = path.join(root, wk);
  if (!fs.existsSync(p)) { add('missing-wellknown', '/' + wk, 'missing'); continue; }
  try { JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { add('wellknown-parse', '/' + wk, String(e.message).slice(0, 80)); }
}
const llms = fs.readFileSync(path.join(root, 'llms.txt'), 'utf8');
for (const m of llms.matchAll(/https:\/\/yieldwatch\.io(\/[^\s)]*)/g)) {
  const p = m[1].replace(/[.,]$/, '');
  const rel = p.slice(1);
  const candidates = [path.join(root, rel), path.join(root, rel, 'index.html')];
  if (!candidates.some((c) => fs.existsSync(c))) add('llms-link', p, 'missing');
}

const ogRefs = new Set();
for (const f of htmls) {
  const html = fs.readFileSync(f, 'utf8');
  for (const m of html.matchAll(/property="og:image"\s+content="([^"]+)"/g)) ogRefs.add(m[1]);
}
for (const u of ogRefs) {
  const p = u.replace('https://yieldwatch.io', '');
  if (!fs.existsSync(path.join(root, p.slice(1)))) add('og-image-missing', p, 'referenced but not built');
}

console.log(JSON.stringify({ pages: htmls.length, ids: totalIds, sitemapUrls: locs.length, sitemapLastmods: lastmods.length, apiJsons: jsons.length, ogImages: ogRefs.size, issueCount: issues.length }, null, 2));
const grouped = {};
for (const i of issues) (grouped[i.kind] ||= []).push(i);
for (const [k, v] of Object.entries(grouped)) console.log(k, v.length, JSON.stringify(v.slice(0, 6)));
process.exitCode = issues.length ? 1 : 0;
