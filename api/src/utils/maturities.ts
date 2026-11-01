// Single source of truth for Treasury tenors used by the API, the OG chart
// renderer, the blog routes, and the ingestion jobs. The canonical data lives
// in the static site's config so both projects cannot drift.
import config from '../../../site/src/data/maturities.json';

export const MATURITY_ORDER: readonly string[] = config.order;
export const CHART_COLORS: readonly string[] = config.colors;

// Tenors a daily row must contain before it is accepted as complete.
export const REQUIRED_TENORS: readonly string[] = config.requiredTenors;

// Maturity keys accepted from Treasury CSV/XLS sources.
export const KNOWN_MATURITY_KEYS: readonly string[] = config.order;
