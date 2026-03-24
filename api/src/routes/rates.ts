import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { eq, and, gte, lte, desc, asc, SQL } from 'drizzle-orm';
import { MATURITIES } from '../utils/parse';
import { queryCache } from '../utils/cache';

const VALID_MATURITIES = new Set(MATURITIES.map(m => m.label));
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  return date.getUTCFullYear() === year &&
         date.getUTCMonth() + 1 === month &&
         date.getUTCDate() === day;
}

export const ratesRoutes = new Elysia({ prefix: '/api/rates' })
  .get('/maturities', async () => {
    return {
      success: true,
      data: MATURITIES,
    };
  })
  .get('/latest', async () => {
    const latestData = await db
      .select()
      .from(schema.yieldCurveRates)
      .orderBy(desc(schema.yieldCurveRates.date), asc(schema.yieldCurveRates.maturity))
      .limit(MATURITIES.length);

    if (latestData.length === 0) {
      return {
        success: false,
        error: 'No data available',
        data: null,
      };
    }

    const latestDate = latestData[0].date;
    const todayData = latestData.filter(r => r.date === latestDate);

    const rates = todayData.map(r => ({
      maturity: r.maturity,
      rate: parseFloat(r.rate),
    }));

    return {
      success: true,
      data: {
        date: latestDate,
        dateFormatted: new Date(latestDate + 'T00:00:00Z').toLocaleDateString('en-US', {
          timeZone: 'UTC',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        rates,
      },
    };
  })
  .get('/stats', async () => {
    const allStats = await db
      .select()
      .from(schema.rateStats)
      .orderBy(asc(schema.rateStats.maturity));

    if (allStats.length === 0) {
      return {
        success: false,
        error: 'No stats available',
        data: null,
      };
    }

    return {
      success: true,
      data: allStats.map(s => ({
        maturity: s.maturity,
        yearHigh: s.yearHigh ? parseFloat(s.yearHigh) : null,
        yearHighDate: s.yearHighDate || null,
        yearLow: s.yearLow ? parseFloat(s.yearLow) : null,
        yearLowDate: s.yearLowDate || null,
        allTimeHigh: s.allTimeHigh ? parseFloat(s.allTimeHigh) : null,
        allTimeHighDate: s.allTimeHighDate || null,
        allTimeLow: s.allTimeLow ? parseFloat(s.allTimeLow) : null,
        allTimeLowDate: s.allTimeLowDate || null,
      })),
    };
  })
  .get('/', async ({ query }) => {
    const { from, to, maturity, limit, offset } = query as { 
      from?: string; 
      to?: string; 
      maturity?: string;
      limit?: string;
      offset?: string;
    };

    const MAX_LIMIT = 200000;
    const parsedLimit = Math.min(Math.max(parseInt(limit || '1000') || 1000, 1), MAX_LIMIT);
    const parsedOffset = Math.max(parseInt(offset || '0') || 0, 0);

    if (from && !isValidDate(from)) {
      return {
        success: false,
        error: 'Invalid "from" parameter. Use YYYY-MM-DD format.',
        data: null,
      };
    }
    
    if (to && !isValidDate(to)) {
      return {
        success: false,
        error: 'Invalid "to" parameter. Use YYYY-MM-DD format.',
        data: null,
      };
    }
    
    if (from && to && new Date(from) > new Date(to)) {
      return {
        success: false,
        error: '"from" date must be before "to" date.',
        data: null,
      };
    }

    if (maturity && !VALID_MATURITIES.has(maturity.toUpperCase())) {
      return {
        success: false,
        error: 'Invalid maturity parameter. See /api-docs for valid options.',
        data: null,
      };
    }

    let whereConditions: SQL[] = [];

    if (from) {
      whereConditions.push(gte(schema.yieldCurveRates.date, from));
    }
    if (to) {
      whereConditions.push(lte(schema.yieldCurveRates.date, to));
    }
    if (maturity) {
      whereConditions.push(eq(schema.yieldCurveRates.maturity, maturity.toUpperCase()));
    }

    const whereClause = whereConditions.length > 0
      ? and(...whereConditions)
      : undefined;

    const data = await db
      .select({
        date: schema.yieldCurveRates.date,
        maturity: schema.yieldCurveRates.maturity,
        rate: schema.yieldCurveRates.rate,
      })
      .from(schema.yieldCurveRates)
      .where(whereClause)
      .orderBy(asc(schema.yieldCurveRates.date), asc(schema.yieldCurveRates.maturity))
      .limit(parsedLimit)
      .offset(parsedOffset);

    if (data.length === 0) {
      return {
        success: false,
        error: 'No data found for the specified criteria',
        data: null,
      };
    }

    const grouped: Record<string, { maturity: string; rate: number }[]> = {};
    for (const row of data) {
      if (!grouped[row.date]) {
        grouped[row.date] = [];
      }
      grouped[row.date].push({
        maturity: row.maturity,
        rate: parseFloat(row.rate),
      });
    }

    const timeSeriesData = Object.entries(grouped)
      .map(([date, rates]) => ({
        date,
        rates: rates.sort((a, b) => {
          const matA = MATURITIES.find(m => m.label === a.maturity)?.years || 0;
          const matB = MATURITIES.find(m => m.label === b.maturity)?.years || 0;
          return matA - matB;
        }),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const result = {
      success: true,
      data: timeSeriesData,
      meta: {
        from: from || 'earliest',
        to: to || 'latest',
        maturity: maturity || 'all',
        count: timeSeriesData.length,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: timeSeriesData.length === parsedLimit,
      },
    };

    if (maturity === undefined && offset === undefined && from && to) {
      const cacheKey = `rates:${from}:${to}:all`;
      queryCache.set(cacheKey, result);
    }

    return result;
  })
  .get('/cache/warm', async ({ query }) => {
    const { from, to } = query as { from?: string; to?: string };

    if (!from || !to) {
      return { success: false, error: 'from and to are required' };
    }

    const cacheKey = `rates:${from}:${to}:all`;
    const cached = queryCache.get(cacheKey);
    if (cached) {
      return { success: true, cached: true, cacheKey };
    }

    const data = await db
      .select({
        date: schema.yieldCurveRates.date,
        maturity: schema.yieldCurveRates.maturity,
        rate: schema.yieldCurveRates.rate,
      })
      .from(schema.yieldCurveRates)
      .where(and(gte(schema.yieldCurveRates.date, from), lte(schema.yieldCurveRates.date, to)))
      .orderBy(asc(schema.yieldCurveRates.date), asc(schema.yieldCurveRates.maturity))
      .limit(200000);

    if (data.length === 0) {
      return { success: false, error: 'No data found' };
    }

    const grouped: Record<string, { maturity: string; rate: number }[]> = {};
    for (const row of data) {
      if (!grouped[row.date]) {
        grouped[row.date] = [];
      }
      grouped[row.date].push({
        maturity: row.maturity,
        rate: parseFloat(row.rate),
      });
    }

    const timeSeriesData = Object.entries(grouped)
      .map(([date, rates]) => ({
        date,
        rates: rates.sort((a, b) => {
          const matA = MATURITIES.find(m => m.label === a.maturity)?.years || 0;
          const matB = MATURITIES.find(m => m.label === b.maturity)?.years || 0;
          return matA - matB;
        }),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const result = {
      success: true,
      data: timeSeriesData,
      meta: {
        from,
        to,
        maturity: 'all',
        count: timeSeriesData.length,
        limit: 200000,
        offset: 0,
        hasMore: timeSeriesData.length === 200000,
      },
    };

    queryCache.set(cacheKey, result);
    return { success: true, cached: false, cacheKey, warmed: true };
  });
