export const API_CONFIG = {
  MAX_QUERY_LIMIT: 200000,
  FETCH_TIMEOUT_MS: 30000,
  SCHEDULER_CHECK_INTERVAL_MS: 900000,
  DEFAULT_CRON_HOUR: 16,
  DEFAULT_CRON_MINUTE: 30,
} as const;

export const CHART_COLORS = [
  '#6366f1', '#ec4899', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#8b5cf6', '#a855f7', '#d946ef'
] as const;

export const MATURITY_ORDER = [
  '4WK', '6WK', '2MO', '3MO', '4MO', '6MO',
  '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'
] as const;