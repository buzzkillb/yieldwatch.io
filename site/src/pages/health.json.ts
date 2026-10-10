import { RATES, SUMMARIES } from '../lib/site';

export const GET = () => {
  return new Response(JSON.stringify({
    status: 'ok',
    latestRateDate: RATES.length ? RATES[RATES.length - 1].date : null,
    latestSummaryDate: SUMMARIES.length ? SUMMARIES[0].date : null,
  }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
