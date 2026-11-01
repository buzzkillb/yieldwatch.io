// Single source of truth for Treasury tenors used by the API, the OG chart
// renderer, the blog routes, and the ingestion jobs.
//
// The canonical file lives at site/src/data/maturities.json. The API keeps a
// byte-identical copy at src/data/maturities.json because the production Docker
// image is built with the `api/` directory as its build context (it cannot see
// sibling folders), and the dev compose file mounts only `api/` into /app.
// CI fails if the two copies diverge; run `npm run sync:maturities` locally
// after changing the canonical config.
import config from '../data/maturities.json';

export const MATURITY_ORDER: readonly string[] = config.order;
export const CHART_COLORS: readonly string[] = config.colors;

// Tenors a daily row must contain before it is accepted as complete.
export const REQUIRED_TENORS: readonly string[] = config.requiredTenors;

// Maturity keys accepted from Treasury CSV/XLS sources.
export const KNOWN_MATURITY_KEYS: readonly string[] = config.order;
