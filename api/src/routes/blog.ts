import { Elysia, t } from 'elysia';
import { db, schema } from '../db';
import { desc, eq, sql } from 'drizzle-orm';

const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];
const POSTS_PER_PAGE = 5;

export const blogRoutes = new Elysia({ prefix: '/api/blog' })
  .get('/list', async ({ query }) => {
    const page = Math.max(1, parseInt(query.page as string) || 1);
    const offset = (page - 1) * POSTS_PER_PAGE;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.dailySummaries);
    const totalCount = Number(countResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / POSTS_PER_PAGE);

    const summaries = await db
      .select({
        date: schema.dailySummaries.date,
        summary: schema.dailySummaries.summary,
        blogSummary: schema.dailySummaries.blogSummary,
        createdAt: schema.dailySummaries.createdAt,
      })
      .from(schema.dailySummaries)
      .orderBy(desc(schema.dailySummaries.date))
      .limit(POSTS_PER_PAGE)
      .offset(offset);

    const result = summaries.map(s => ({
      date: s.date,
      excerpt: s.summary || '',
      hasFullPost: !!s.blogSummary,
    }));

    return {
      success: true,
      data: result,
      pagination: {
        page,
        perPage: POSTS_PER_PAGE,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      }
    };
  })
  .get('/:date', async ({ params }) => {
    const { date } = params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
      return { success: false, error: 'Invalid date format. Use YYYY-MM-DD.' };
    }

    const [summary] = await db
      .select()
      .from(schema.dailySummaries)
      .where(eq(schema.dailySummaries.date, date))
      .limit(1);

    if (!summary) {
      return { success: false, error: 'Summary not found for this date' };
    }

    const ratesData = await db
      .select()
      .from(schema.yieldCurveRates)
      .where(eq(schema.yieldCurveRates.date, date));

    const ratesForDate = ratesData
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
