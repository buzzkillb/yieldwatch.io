import { describe, it, expect } from 'bun:test';
import {
  getPreviousBusinessDay,
  getDateMinusDays,
  getPreviousBusinessDayFromDate,
  getOneYearAgoBusinessDay,
  getDayOfWeek,
  isValidSummary,
  buildShortSystemPrompt,
  buildLongSystemPrompt,
} from '../services/summaryService';
import { generateOgChart, MATURITY_ORDER, CHART_COLORS } from '../utils/ogChart';

describe('getOneYearAgoBusinessDay', () => {
  it('subtracts one year and lands on a business day', () => {
    const result = getOneYearAgoBusinessDay('2026-09-10');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date(result + 'T00:00:00Z');
    expect(d.getUTCDay()).not.toBe(0); // not Sunday
    expect(d.getUTCDay()).not.toBe(6); // not Saturday
    // exactly one year earlier (or slightly before if weekend walk-back)
    expect(result <= '2025-09-10').toBe(true);
    expect(result >= '2025-09-03').toBe(true);
  });

  it('handles leap-day input (Feb 29 -> Feb 28)', () => {
    const result = getOneYearAgoBusinessDay('2028-02-29');
    expect(result).toBe('2027-02-26'); // Feb 28 2027 is a Sunday -> walk back to Friday Feb 26
  });

  it('walks back off weekends', () => {
    // 2025-09-13 is a Saturday -> 2025-09-12 Friday
    expect(getOneYearAgoBusinessDay('2026-09-13')).toBe('2025-09-12');
  });
});

describe('prompt year-over-year context', () => {
  it('includes one-year-ago data in the prompt when provided', () => {
    const rates = { todayRates: [], yesterdayRates: [], lastWeekRates: [], thirtyDaysRates: [] };
    const withYear = buildShortSystemPrompt({
      ...rates,
      dates: { today: '2026-09-10', yesterday: '2026-09-09', lastWeek: '2026-09-03', thirtyDays: '2026-08-11' },
      yearAgoRates: [{ maturity: '10YR', rate: 4.2 }],
      yearAgoDate: '2025-09-10',
    });
    expect(withYear).toContain('One year ago');
    expect(withYear).toContain('2025-09-10');
    const withoutYear = buildShortSystemPrompt({
      ...rates,
      dates: { today: '2026-09-10', yesterday: '2026-09-09', lastWeek: '2026-09-03', thirtyDays: '2026-08-11' },
    });
    expect(withoutYear).not.toContain('One year ago');
  });

  it('long prompt mentions year-ago comparison instruction', () => {
    const p = buildLongSystemPrompt({
      todayRates: [], yesterdayRates: [], lastWeekRates: [], thirtyDaysRates: [],
      dates: { today: '2026-09-10', yesterday: '2026-09-09', lastWeek: '2026-09-03', thirtyDays: '2026-08-11' },
    });
    expect(p).toContain('one year ago');
  });
});

describe('business day helpers', () => {
  it('skips weekends going back one business day', () => {
    // Monday 2026-09-07 -> previous business day is Friday 2026-09-04
    expect(getPreviousBusinessDay('2026-09-07')).toBe('2026-09-04');
    // Tuesday 2026-09-08 -> Monday
    expect(getPreviousBusinessDay('2026-09-08')).toBe('2026-09-07');
    // Saturday -> Friday
    expect(getPreviousBusinessDay('2026-09-12')).toBe('2026-09-11');
    // Sunday -> Friday
    expect(getPreviousBusinessDay('2026-09-13')).toBe('2026-09-11');
  });

  it('subtracts calendar days', () => {
    expect(getDateMinusDays('2026-09-10', 7)).toBe('2026-09-03');
    expect(getDateMinusDays('2026-03-01', 1)).toBe('2026-02-28'); // non-leap 2026
    expect(getDateMinusDays('2026-01-01', 1)).toBe('2025-12-31'); // year boundary
  });

  it('goes back N business days', () => {
    // 30 business days back from 2026-09-10
    const result = getPreviousBusinessDayFromDate('2026-09-10', 30);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // must be strictly before the start date
    expect(result < '2026-09-10').toBe(true);
    // and at least 30 calendar days before (30 business days >= 30 calendar days + weekend days)
    const diffDays = (new Date('2026-09-10T00:00:00Z').getTime() - new Date(result + 'T00:00:00Z').getTime()) / 86400000;
    expect(diffDays).toBeGreaterThanOrEqual(30);
  });

  it('returns correct day-of-week names', () => {
    expect(getDayOfWeek('2026-09-10')).toBe('Thursday');
    expect(getDayOfWeek('2026-09-12')).toBe('Saturday');
    expect(getDayOfWeek('2026-09-13')).toBe('Sunday');
  });
});

describe('isValidSummary', () => {
  it('accepts a valid plain summary', () => {
    const good = 'On September 10, 2026, the 30-year Treasury yield was 4.95 percent, higher than last week.';
    expect(isValidSummary(good)).toBe(true);
  });

  it('rejects empty, too-short, and too-long text', () => {
    expect(isValidSummary('')).toBe(false);
    expect(isValidSummary('Too short.')).toBe(false);
    expect(isValidSummary('x'.repeat(8001))).toBe(false);
  });

  it('rejects leaked prompt/meta text and JSON', () => {
    expect(isValidSummary('We need to produce a summary of the data. It covers rates today.')).toBe(false);
    expect(isValidSummary('{"summary": "something long enough to pass other checks okay"}')).toBe(false);
    expect(isValidSummary('[1, 2, 3] some array content that is long enough here')).toBe(false);
  });

  it('rejects text with no sentence punctuation', () => {
    expect(isValidSummary('no punctuation at all in this text long enough')).toBe(false);
  });
});

describe('prompt builders', () => {
  const ratesData = {
    todayRates: [{ maturity: '30YR', rate: 4.95 }],
    yesterdayRates: [{ maturity: '30YR', rate: 4.9 }],
    lastWeekRates: [{ maturity: '30YR', rate: 4.8 }],
    thirtyDaysRates: [{ maturity: '30YR', rate: 4.7 }],
    dates: { today: '2026-09-10', yesterday: '2026-09-09', lastWeek: '2026-09-03', thirtyDays: '2026-07-29' },
  };

  it('short prompt includes all four comparison rows and entity names', () => {
    const p = buildShortSystemPrompt(ratesData);
    expect(p).toContain('30-year Treasury yield');
    expect(p).toContain('2026-09-10');
    expect(p).toContain('- Today (');
    expect(p).toContain('- One week ago (');
    expect(p).toContain('- One month ago (');
    expect(p).toContain('4.95');
  });

  it('long prompt includes paragraph structure and entity names', () => {
    const p = buildLongSystemPrompt(ratesData);
    expect(p).toContain('exactly 4 paragraphs');
    expect(p).toContain('10-year Treasury rate');
    expect(p).toContain('2-year Treasury rate');
    expect(p).toContain('Treasury yield curve');
  });
});

describe('ogChart', () => {
  it('exposes maturity order and matching colors', () => {
    expect(MATURITY_ORDER.length).toBe(14);
    expect(CHART_COLORS.length).toBe(MATURITY_ORDER.length);
  });

  it('generates a PNG buffer from valid rates', async () => {
    // sharp's native binary may be unavailable in some dev environments
    // (macOS code-signing); production Docker image and CI (linux) include it.
    const rates = [4.0, 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 4.85, 4.9, 4.92, 4.95, 5.1, 5.37]
      .map((rate, i) => ({ maturity: MATURITY_ORDER[i], rate }));
    let buffer: Buffer | null = null;
    try {
      buffer = await generateOgChart(rates);
    } catch (err) {
      const msg = String(err);
      if (/sharp|dlopen|signature/i.test(msg)) {
        console.log('skipping PNG test: sharp unavailable locally');
        expect(true).toBe(true);
        return;
      }
      throw err;
    }
    // PNG magic bytes
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50); // 'P'
    expect(buffer[2]).toBe(0x4e); // 'N'
    expect(buffer[3]).toBe(0x47); // 'G'
  });

  it('rejects fewer than 2 rates', async () => {
    let threw = false;
    try {
      await generateOgChart([{ maturity: '10YR', rate: 4.5 }]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
