import { Elysia, t } from 'elysia';
import { db, schema } from '../db';
import { desc, asc } from 'drizzle-orm';

const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];

export const blogRoutes = new Elysia({ prefix: '/blog' })
  .get('/', async () => {
    const summaries = await db
      .select({
        date: schema.dailySummaries.date,
        summary: schema.dailySummaries.summary,
        blogSummary: schema.dailySummaries.blogSummary,
        createdAt: schema.dailySummaries.createdAt,
      })
      .from(schema.dailySummaries)
      .orderBy(desc(schema.dailySummaries.date))
      .limit(50);

    const result = summaries.map(s => ({
      date: s.date,
      excerpt: s.summary ? s.summary.split('.')[0] + '.' : '',
      hasFullPost: !!s.blogSummary,
    }));

    return { success: true, data: result };
  })
  .get('/:date', async ({ params }) => {
    const { date } = params;

    const summary = await db
      .select()
      .from(schema.dailySummaries)
      .where(desc(schema.dailySummaries.date))
      .limit(1);

    if (summary.length === 0 || summary[0].date !== date) {
      const byDate = await db
        .select()
        .from(schema.dailySummaries)
        .where(desc(schema.dailySummaries.date));

      const found = byDate.find(s => s.date === date);
      if (!found) {
        return { success: false, error: 'Summary not found for this date' };
      }
    }

    const dailyData = await db
      .select()
      .from(schema.yieldCurveRates)
      .where(desc(schema.yieldCurveRates.date))
      .limit(100);

    const ratesForDate = dailyData
      .filter(r => r.date === date)
      .map(r => ({
        maturity: r.maturity,
        rate: parseFloat(r.rate),
      }))
      .sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity));

    const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const summaryData = summary[0].date === date ? summary[0] : summary.find(s => s.date === date);

    return {
      success: true,
      data: {
        date: summaryData?.date,
        dateFormatted,
        summary: summaryData?.summary || '',
        blogSummary: summaryData?.blogSummary || summaryData?.summary || '',
        rates: ratesForDate,
      }
    };
  });
