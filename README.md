# YieldWatch

Daily U.S. Treasury yield-curve rates, plain-English summaries, and a free public JSON API.

**Production:** https://yieldwatch.io — a fully pre-rendered Astro site deployed as static
assets on Cloudflare Workers. There is no VPS, no Postgres, and no request-time server.

## How it works

1. A scheduled GitHub Actions job fetches the U.S. Treasury's daily par yield-curve XML.
2. `site/scripts/daily-update.ts` validates and appends official rates to
   `site/src/data/rates.json` **before** calling the LLM gateway for the daily summary.
3. The summary is appended to `site/src/data/summaries.json`; missing summaries inside
   the published window are backfilled on the next run.
4. The commit triggers a Cloudflare Workers Build, which runs `site/scripts/gen-derived.mjs`
   (static API snapshots, OG images, redirects, headers) and `astro build`.
5. A post-build audit (`site/scripts/audit-site.mjs`) fails CI on SEO, accessibility,
   schema, link, sitemap, or data regressions.

Official Treasury rates are authoritative. Any intraday/derived data must be labeled
`is_official: false`.

## Repository layout

```
site/                    Astro static site (the deployed product)
  src/data/              rates.json + summaries.json (the "database")
  src/pages/             routes, JSON/XML endpoints, sitemap, feed
  src/templates/         page shells processed at build time
  scripts/               gen-derived, daily-update, validate-data, audit-site
  public/                generated API snapshots, OG images, robots, llms.txt, _headers
.github/workflows/       CI and the daily update job
api/                     legacy Bun API service, retained for Treasury XML parsing,
                         summary prompt/retry code, and unit tests (not deployed)
```

## Local development

```sh
cd site
npm install
npm run build          # gen-derived + astro build → dist/
npm run preview        # serve dist/
npm run audit          # SEO/a11y/schema/link/sitemap audit (non-zero on failure)
npm run validate:data  # validate src/data/*.json integrity
```

Daily update (requires Bun and the API dependencies):

```sh
cd api && bun install
cd ../site
LLM_API_KEY=... LLM_BASE_URL=https://api.bwengr.com npm run daily-update
```

## Public endpoints (static snapshots)

| Path | Description |
| --- | --- |
| `/api/rates.json` | Full historical yield curve (all dates and tenors) |
| `/api/rates/latest.json` | Latest published curve |
| `/api/rates/{3m,6m,1y,2y,5y,all}.json` | Pre-sliced history windows |
| `/api/rates/maturities.json` | Available tenors |
| `/api/rates/stats.json` | All-time and latest-year high/low statistics |
| `/api/blog/index.json` | Daily summary index |
| `/api/blog/{YYYY-MM-DD}.json` | One daily summary |
| `/api/blog/years.json` | Years with published summaries |
| `/api/daily-summary` | Latest summary as plain text |
| `/health.json` | Data freshness and status |
| `/.well-known/api-catalog` | RFC 8288 linkset for agents |
| `/.well-known/mcp/server-card.json` | Tool descriptions for MCP-aware clients |

Static snapshots do not apply query-string filtering; filter the returned JSON client-side
(or use the MCP tools, which do so locally). CORS is enabled for simple `GET`/`HEAD`
requests. Because assets are served statically, `OPTIONS` preflights are not handled.

## Scheduled pipeline

`.github/workflows/daily-update.yml` runs three staggered attempts on business days.
The UTC cron times (19:45/20:45/21:45) straddle daylight saving so one attempt lands
shortly after the Treasury's ~3:30pm ET release in both EDT and EST. The job exits
early when no new data exists, commits rates even if summary generation fails, and
retries the push after rebasing.

Required repository secrets:

- `LLM_API_KEY` — gateway key
- `LLM_BASE_URL` — OpenAI-compatible gateway, e.g. `https://api.bwengr.com`

## Cloudflare Workers configuration

- Root directory: `site`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Output: `dist/` served as static assets from `site/wrangler.jsonc`
- Environment: `NODE_VERSION=20`

`site/public/_headers` carries CSP and other security headers; `_redirects` preserves
documented `/api/*` paths and legacy `/blog?page=N` URLs.

## Data integrity

`site/scripts/validate-data.mjs` enforces:

- chronological order and no duplicate dates
- required tenors (3MO, 2YR, 10YR, 30YR) and plausible 0–25% yields
- summary/rate alignment and minimum summary length

Run it before committing data changes. CI runs the validator, the site build, and the
post-build audit on every push and pull request.
