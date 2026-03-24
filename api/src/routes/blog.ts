import { Elysia, t } from 'elysia';
import { db, schema } from '../db';
import { desc, asc, eq } from 'drizzle-orm';

const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];

export const blogRoutes = new Elysia({ prefix: '/api/blog' })
  .get('/list', async () => {
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
      excerpt: s.summary || '',
      hasFullPost: !!s.blogSummary,
    }));

    return { success: true, data: result };
  })
  .get('/:date', async ({ params }) => {
    const { date } = params;

    const summaries = await db
      .select()
      .from(schema.dailySummaries)
      .orderBy(desc(schema.dailySummaries.date));

    const summary = summaries.find(s => s.date === date);
    if (!summary) {
      return { success: false, error: 'Summary not found for this date' };
    }

    const dailyData = await db
      .select()
      .from(schema.yieldCurveRates)
      .orderBy(desc(schema.yieldCurveRates.date));

    const ratesForDate = dailyData
      .filter(r => r.date === date)
      .map(r => ({
        maturity: r.maturity,
        rate: parseFloat(r.rate),
      }))
      .sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity));

    const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return {
      success: true,
      data: {
        date: summary.date,
        dateFormatted,
        summary: summary.summary || '',
        blogSummary: summary.blogSummary || summary.summary || '',
        rates: ratesForDate,
      }
    };
  });
