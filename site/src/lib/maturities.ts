// Canonical maturity list and chart palette. Single source of truth shared by
// the site build, the dashboard client, and the prebuild/validation scripts so
// a maturity cannot be accepted by one layer and silently dropped by another.
import config from '../data/maturities.json';

export const MATURITY_ORDER: readonly string[] = config.order;
export const CHART_COLORS: readonly string[] = config.colors;
export const MATURITY_SET: ReadonlySet<string> = new Set(MATURITY_ORDER);

// Human-readable label used in server-rendered prose and tables.
export function maturityLabel(maturity: string): string {
  const weeks = /^(\d+)WK$/.exec(maturity);
  if (weeks) return `${weeks[1]}-week bill`;
  const months = /^(\d+)MO$/.exec(maturity);
  if (months) return `${months[1]}-month bill`;
  const years = /^(\d+)YR$/.exec(maturity);
  if (years) return `${years[1]}-year`;
  return maturity;
}

// Sort rank; unknown maturities sort last instead of at -1 like indexOf.
export function maturityRank(maturity: string): number {
  const i = MATURITY_ORDER.indexOf(maturity);
  return i === -1 ? MATURITY_ORDER.length : i;
}
