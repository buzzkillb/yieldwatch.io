import { Elysia, t } from 'elysia';
import { db, schema } from '../db';
import { desc, eq, sql, like, and, gte, lte } from 'drizzle-orm';

const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];
const POSTS_PER_PAGE = 5;

export const blogRoutes = new Elysia({ prefix: '/api/blog' })
  .get('/list', async ({ query }) => {
    const page = Math.max(1, parseInt(query.page as string) || 1);
    const year = query.year as string;
    const month = query.month as string;
    const limit = POSTS_PER_PAGE;
    const offset = (page - 1) * limit;

    let whereClause = undefined;
    if (year && month) {
      const monthPadded = month.padStart(2, '0');
      whereClause = like(schema.dailySummaries.date, `${year}-${monthPadded}%`);
    } else if (year) {
      whereClause = like(schema.dailySummaries.date, `${year}%`);
    }

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.dailySummaries)
      .where(whereClause);
    const totalCount = Number(countResult[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / limit);

    const summaries = await db
      .select({
        date: schema.dailySummaries.date,
        summary: schema.dailySummaries.summary,
        blogSummary: schema.dailySummaries.blogSummary,
        createdAt: schema.dailySummaries.createdAt,
      })
      .from(schema.dailySummaries)
      .where(whereClause)
      .orderBy(desc(schema.dailySummaries.date))
      .limit(limit)
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
  })
  .get('/years', async () => {
    const years = await db
      .select({ year: sql<string>`substring(${schema.dailySummaries.date}::text, 1, 4) as year` })
      .from(schema.dailySummaries)
      .groupBy(sql`year`)
      .orderBy(desc(sql`year`));

    return {
      success: true,
      data: years.map(y => y.year),
    };
  })
  .get('/with-rates', async ({ query }) => {
    const page = Math.max(1, parseInt(query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 10));
    const offset = (page - 1) * limit;

    const summaries = await db
      .select({
        date: schema.dailySummaries.date,
        summary: schema.dailySummaries.summary,
        blogSummary: schema.dailySummaries.blogSummary,
      })
      .from(schema.dailySummaries)
      .orderBy(desc(schema.dailySummaries.date))
      .limit(limit)
      .offset(offset);

    const summariesWithRates = await Promise.all(
      summaries.map(async (s) => {
        const ratesData = await db
          .select()
          .from(schema.yieldCurveRates)
          .where(eq(schema.yieldCurveRates.date, s.date));

        const rates = ratesData
          .map(r => ({
            maturity: r.maturity,
            rate: parseFloat(r.rate),
          }))
          .sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity));

        return {
          date: s.date,
          excerpt: s.summary || '',
          hasFullPost: !!s.blogSummary,
          rates,
        };
      })
    );

    return {
      success: true,
      data: summariesWithRates,
    };
  });
