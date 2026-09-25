// Shared summary-generation service used by the scheduler and the backfill scripts.
// Single source of truth for prompts, LLM gateway calls, and summary persistence.
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';

const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'https://api.bwengr.com').replace(/\/+$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY || '';

export async function getRatesForDate(date: string): Promise<{ maturity: string; rate: number }[]> {
  const results = await db
    .select()
    .from(schema.yieldCurveRates)
    .where(eq(schema.yieldCurveRates.date, date));

  return results.map(r => ({
    maturity: r.maturity,
    rate: parseFloat(r.rate)
  }));
}

export function getPreviousBusinessDay(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  let daysBack = 1;

  while (daysBack <= 7) {
    date.setUTCDate(date.getUTCDate() - 1);
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      break;
    }
    daysBack++;
  }

  return date.toISOString().split('T')[0];
}

export function getDateMinusDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().split('T')[0];
}

export function getPreviousBusinessDayFromDate(dateStr: string, daysBack: number): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  let daysChecked = 0;

  while (daysChecked < daysBack + 7) {
    date.setUTCDate(date.getUTCDate() - 1);
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      daysChecked++;
      if (daysChecked === daysBack) break;
    }
  }

  return date.toISOString().split('T')[0];
}

// Most recent business day on or before (dateStr - 1 year), for year-over-year context.
export function getOneYearAgoBusinessDay(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  const inputMonth = date.getUTCMonth();
  const inputDay = date.getUTCDate();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  // JS rolls Feb 29 -> Mar 1 on non-leap years; clamp back to Feb 28
  if (inputMonth === 1 && inputDay === 29 && date.getUTCMonth() === 2 && date.getUTCDate() === 1) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  let steps = 0;
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (++steps > 7) break;
  }
  return date.toISOString().split('T')[0];
}

export function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getUTCDay()];
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isValidSummary(text: string): boolean {
  if (!text || text.length < 50) return false;
  if (text.length > 8000) return false;
  if (text.includes('We need to produce') || text.includes('Must adhere to') ||
      text.includes('style rules') || (text.includes('paragraph') && text.includes('sentence'))) {
    return false;
  }
  if (text.includes('{"') || text.startsWith('{') || text.startsWith('[')) return false;
  if (!text.includes('.') && !text.includes('!') && !text.includes('?')) return false;
  return true;
}

function buildDataPrompt(
  todayRates: { maturity: string; rate: number }[],
  yesterdayRates: { maturity: string; rate: number }[],
  lastWeekRates: { maturity: string; rate: number }[],
  thirtyDaysRates: { maturity: string; rate: number }[],
  dates: { today: string; yesterday: string; lastWeek: string; thirtyDays: string },
  yearAgoRates?: { maturity: string; rate: number }[],
  yearAgoDate?: string
): string {
  const fmt = (d: string) => ({ date: d, day: getDayOfWeek(d) });
  const t = fmt(dates.today), y = fmt(dates.yesterday), w = fmt(dates.lastWeek), m = fmt(dates.thirtyDays);
  let out = `- Today (${t.day}, ${t.date}): ${JSON.stringify(todayRates)}
- Yesterday (${y.day}, ${y.date}): ${JSON.stringify(yesterdayRates)}
- One week ago (${w.day}, ${w.date}): ${JSON.stringify(lastWeekRates)}
- One month ago (${m.day}, ${m.date}): ${JSON.stringify(thirtyDaysRates)}`;
  if (yearAgoRates && yearAgoRates.length > 0 && yearAgoDate) {
    const ya = fmt(yearAgoDate);
    out += `\n- One year ago (${ya.day}, ${ya.date}): ${JSON.stringify(yearAgoRates)}`;
  }
  return out;
}


// --- Editorial variation -------------------------------------------------
// Daily pages historically read near-identically, which hurts indexing and
// reader value. We rotate the editorial framing deterministically by date so
// each day's brief leads from a different, data-supported angle while staying
// strictly factual. Deterministic (not random) so --force reruns reproduce.

const EDITORIAL_ANGLES = [
  {
    id: 'long-end',
    lead: 'Lead paragraph 1 with the 30-year Treasury yield and the long end of the curve (20YR/30YR).',
    focus: 'Build paragraphs 2-4 around how the long end moved versus last week, last month and one year ago.',
  },
  {
    id: 'short-end',
    lead: 'Lead paragraph 1 with the short end of the curve (4WK/6WK/2MO bills) and what bills did versus last week.',
    focus: 'Build paragraphs 2-4 around the short end, then move out along the curve to the 10-year and 30-year.',
  },
  {
    id: 'curve-shape',
    lead: 'Lead paragraph 1 with the shape of the Treasury yield curve today - where it is steepest and where it is flattest or inverted.',
    focus: 'Build paragraphs 2-4 around how the curve shape changed versus last week and last month.',
  },
  {
    id: 'largest-move',
    lead: 'Lead paragraph 1 with whichever maturity moved the most versus last week, naming that maturity and its rate.',
    focus: 'Build paragraphs 2-4 around the spread of moves across the curve - the largest movers and the smallest.',
  },
  {
    id: 'year-contrast',
    lead: 'Lead paragraph 1 with the comparison to one year ago for the 10-year and 30-year Treasury yields.',
    focus: 'Build paragraphs 2-4 around the year-over-year change first, then the week and month changes.',
  },
  {
    id: 'month-drift',
    lead: 'Lead paragraph 1 with how rates have drifted over the past month at the 2-year, 10-year and 30-year maturities.',
    focus: 'Build paragraphs 2-4 around the one-month change across the curve, then add the weekly comparison.',
  },
  {
    id: 'mid-curve',
    lead: 'Lead paragraph 1 with the middle of the curve (2YR through 7YR) and the 10-year Treasury rate.',
    focus: 'Build paragraphs 2-4 around the belly of the curve, then contrast with the short and long ends.',
  },
];

// Deterministic index: same date always selects the same angle.
export function getEditorialAngle(date: string): typeof EDITORIAL_ANGLES[number] {
  let hash = 0;
  for (let i = 0; i < date.length; i++) {
    hash = (hash * 31 + date.charCodeAt(i)) % 100000;
  }
  return EDITORIAL_ANGLES[hash % EDITORIAL_ANGLES.length];
}

const ANTI_REPETITION_RULES = `- Vary your sentence structure: do not reuse the same opening clause pattern across paragraphs
- Avoid repeating the identical transition phrase more than once (e.g. do not start three sentences with "Meanwhile")
- Do not begin every paragraph with a date or day-of-week; vary how each paragraph opens
- Never reuse the same sentence template you would write for another day - the facts should drive the wording`;

export function buildStyleDirective(date: string): string {
  const angle = getEditorialAngle(date);
  return `Editorial angle for this brief (id: ${angle.id}):
- ${angle.lead}
- ${angle.focus}
${ANTI_REPETITION_RULES}`;
}

export function buildShortSystemPrompt(ratesData: {
  todayRates: { maturity: string; rate: number }[];
  yesterdayRates: { maturity: string; rate: number }[];
  lastWeekRates: { maturity: string; rate: number }[];
  thirtyDaysRates: { maturity: string; rate: number }[];
  dates: { today: string; yesterday: string; lastWeek: string; thirtyDays: string };
  yearAgoRates?: { maturity: string; rate: number }[];
  yearAgoDate?: string;
}): string {
  const dataPrompt = buildDataPrompt(ratesData.todayRates, ratesData.yesterdayRates, ratesData.lastWeekRates, ratesData.thirtyDaysRates, ratesData.dates, ratesData.yearAgoRates, ratesData.yearAgoDate);
  return `You are a plain-spoken writer describing U.S. Treasury yield curve data. Treasury publishes rates on business days only - weekends and holidays are skipped.

Rules:
- Write 2-4 sentences as one paragraph
- State today's full date (e.g. September 10, 2026) in the first sentence
- Refer to rates by full searchable name at least once: "30-year Treasury yield", "10-year Treasury rate", "Treasury yield curve"
- Always mention the 30-year rate prominently
- You MUST include comparison to last week in every output
- If one-year-ago data is provided, include one comparison to a year ago (e.g. the 30-year or 10-year rate versus one year ago)
- When describing changes, use simple language like "up from last week" or "higher than yesterday"
- Do NOT use phrases like "percentage points" or "basis points" - just say "higher" or "lower"
- If the yield curve is inverted, state that fact only - do not explain what it means
- Stick to observable data comparisons - do not explain what rate movements mean for investors or markets
- Begin with a plain statement of fact, never a generic opener like "In today's market" or "As of late"
- Keep it factual and straightforward
- Never use bullet points, dashes, or list format
- Never use foreign characters or non-ASCII symbols
- Write in plain English only

${buildStyleDirective(ratesData.dates.today)}

${dataPrompt}`;
}

export function buildLongSystemPrompt(ratesData: {
  todayRates: { maturity: string; rate: number }[];
  yesterdayRates: { maturity: string; rate: number }[];
  lastWeekRates: { maturity: string; rate: number }[];
  thirtyDaysRates: { maturity: string; rate: number }[];
  dates: { today: string; yesterday: string; lastWeek: string; thirtyDays: string };
  yearAgoRates?: { maturity: string; rate: number }[];
  yearAgoDate?: string;
}): string {
  const dataPrompt = buildDataPrompt(ratesData.todayRates, ratesData.yesterdayRates, ratesData.lastWeekRates, ratesData.thirtyDaysRates, ratesData.dates, ratesData.yearAgoRates, ratesData.yearAgoDate);
  return `You are a financial journalist writing a daily market brief about U.S. Treasury yields. Treasury publishes rates on business days only - weekends and holidays are skipped.

Rules:
- Write exactly 4 paragraphs of 3-5 sentences each
- State today's full date (e.g. September 10, 2026) in the first sentence of paragraph 1
- Refer to rates by full searchable name at least once each: "30-year Treasury yield", "10-year Treasury rate", "2-year Treasury rate", "Treasury yield curve"
- Paragraph 1: Open with the 30-year Treasury yield and key weekly movements (vs last week)
- Paragraph 2: Cover the broader curve - rate changes across maturities compared to last week, but vary how you present the moves (not every maturity needs a number)
- Paragraph 3: Discuss how rates have changed over the past month (vs 30 days ago) - highlight notable moves at different parts of the curve. If one-year-ago data is provided, also state how today's 10-year and 30-year rates compare to one year ago
- Paragraph 4: Describe the Treasury yield curve shape and any inversions compared to both last week and 30 days ago - report them only as observed facts, make no interpretation of what they mean for investors, markets, or the economy
- Use plain language - no jargon or educational explanations
- Do NOT use "percentage points" or "basis points" - just say "higher" or "lower"
- Do NOT explain what rate movements mean for investors or markets
- Do NOT include predictions, forecasts, outlook, or speculation of any kind - describe only what the data shows
- Begin with a plain statement of fact, never a generic opener like "In today's market" or "Investors are watching"
- Keep it factual and informative
- Never use bullet points, dashes, or list format
- Never use foreign characters or non-ASCII symbols
- Write in plain English only
- Separate paragraphs with a blank line

${buildStyleDirective(ratesData.dates.today)}

${dataPrompt}`;
}

export function shortUserMessage(date?: string): string {
  const angle = date ? getEditorialAngle(date) : null;
  const focus = angle ? ` ${angle.lead}` : ' Focus on the 30-year rate and how it compares to last week.';
  return `Write a brief paragraph about today's Treasury yield curve rates. Keep it to 2-4 sentences.${focus}`;
}

export function longUserMessage(date?: string): string {
  const angle = date ? getEditorialAngle(date) : null;
  const focus = angle ? ` Use this editorial angle: ${angle.lead}` : '';
  return `Write a detailed daily market brief about today's Treasury yield curve following the paragraph structure described.${focus}`;
}

// --- Gateway access (model discovery + retry), shared by everything ---

let cachedModelId: string | null = null;

export async function discoverModelId(): Promise<string> {
  if (cachedModelId) return cachedModelId;
  const response = await fetch(`${LLM_BASE_URL}/v1/models`, {
    headers: { 'Authorization': `Bearer ${LLM_API_KEY}` }
  });
  if (!response.ok) {
    throw new Error(`/v1/models failed: ${response.status}`);
  }
  const data = await response.json() as { data?: { id: string }[] };
  const modelId = data.data?.[0]?.id;
  if (!modelId) {
    throw new Error('/v1/models returned no models');
  }
  console.log(`[LLM] Model discovered: ${modelId}`);
  cachedModelId = modelId;
  return modelId;
}

function isModelNotFound(status: number, bodyText: string): boolean {
  return status === 404 || /model\s*not\s*found|does\s*not\s*exist/i.test(bodyText);
}

export async function fetchLLMWithRetry(body: Record<string, unknown>, label: string, attempt = 1): Promise<Response> {
  const MAX_ATTEMPTS = 4;
  const RETRY_DELAY_MS = 60_000;

  try {
    const modelId = await discoverModelId();
    const response = await fetch(`${LLM_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`
      },
      body: JSON.stringify({ ...body, model: modelId })
    });

    // Model was swapped mid-flight: forget the cached name, refetch, retry once
    if (response.status === 404 || (response.ok === false && response.status === 400 && attempt === 1 && isModelNotFound(400, await response.clone().text()))) {
      if (attempt === 1) {
        console.log(`[LLM] ${label}: model no longer available (${response.status}), rediscovering...`);
        cachedModelId = null;
        return fetchLLMWithRetry(body, label, 2);
      }
    }

    if (response.ok || (response.status < 500 && response.status !== 429)) {
      return response;
    }

    console.log(`[LLM] ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${response.status}. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
  } catch (error) {
    console.log(`[LLM] ${label} attempt ${attempt}/${MAX_ATTEMPTS} network error: ${error}. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
  }

  if (attempt < MAX_ATTEMPTS) {
    await sleep(RETRY_DELAY_MS * attempt);
    return fetchLLMWithRetry(body, label, attempt + 1);
  }

  // Return a synthetic failed response so parseResponse logs and returns ''
  return new Response(JSON.stringify({ error: { message: `${label} failed after ${MAX_ATTEMPTS} attempts` } }), { status: 503 });
}

export function parseLLMResponse(response: Response, label: string): Promise<string> {
  return response.text().then(async (bodyText) => {
    if (!response.ok) {
      console.log(`[LLM] ${label} API error: ${response.status} - ${bodyText.slice(0, 200)}`);
      return '';
    }
    let data: { choices?: { message?: { content?: string } }[] };
    try {
      data = JSON.parse(bodyText);
    } catch {
      console.log(`[LLM] ${label}: invalid JSON response`);
      return '';
    }
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text && isValidSummary(text)) {
      return text;
    }
    return '';
  });
}

/**
 * Generate short + long summaries for a date and persist them.
 * Returns { short, long } — empty strings mean generation failed for that variant.
 */
export async function generateAndSaveSummaries(date: string): Promise<{ short: string; long: string }> {
  if (!LLM_API_KEY) {
    console.log('[Summary] LLM_API_KEY not set, skipping summary generation');
    return { short: '', long: '' };
  }

  const yesterdayDate = getPreviousBusinessDay(date);
  const lastWeekDate = getDateMinusDays(date, 7);
  const thirtyDaysAgoDate = getPreviousBusinessDayFromDate(date, 30);
  const yearAgoDate = getOneYearAgoBusinessDay(date);

  const [todayRates, yesterdayRates, lastWeekRates, thirtyDaysRates, yearAgoRates] = await Promise.all([
    getRatesForDate(date),
    getRatesForDate(yesterdayDate),
    getRatesForDate(lastWeekDate),
    getRatesForDate(thirtyDaysAgoDate),
    getRatesForDate(yearAgoDate)
  ]);

  if (todayRates.length === 0) {
    console.log(`[Summary] No rates data for ${date}`);
    return { short: '', long: '' };
  }

  const ratesData = {
    todayRates, yesterdayRates, lastWeekRates, thirtyDaysRates,
    dates: { today: date, yesterday: yesterdayDate, lastWeek: lastWeekDate, thirtyDays: thirtyDaysAgoDate },
    yearAgoRates,
    yearAgoDate: yearAgoRates.length > 0 ? yearAgoDate : undefined
  };

  const [shortResponse, longResponse] = await Promise.all([
    fetchLLMWithRetry({
      messages: [
        { role: 'system', content: buildShortSystemPrompt(ratesData) },
        { role: 'user', content: shortUserMessage(date) }
      ],
      max_tokens: 1000,
      temperature: 0.4
    }, 'short-summary'),
    fetchLLMWithRetry({
      messages: [
        { role: 'system', content: buildLongSystemPrompt(ratesData) },
        { role: 'user', content: longUserMessage(date) }
      ],
      max_tokens: 3000,
      temperature: 0.4
    }, 'long-summary')
  ]);

  const [shortSummary, blogSummary] = await Promise.all([
    parseLLMResponse(shortResponse, 'short-summary'),
    parseLLMResponse(longResponse, 'long-summary')
  ]);

  if (!shortSummary) {
    console.log(`[Summary] No valid short summary generated for ${date}`);
    return { short: '', long: blogSummary };
  }

  await db
    .insert(schema.dailySummaries)
    .values({
      date: date,
      summary: shortSummary,
      blogSummary: blogSummary || null,
    })
    .onConflictDoUpdate({
      target: schema.dailySummaries.date,
      set: {
        summary: shortSummary,
        blogSummary: blogSummary || null,
        createdAt: new Date(),
      },
    });

  console.log(`[Summary] Saved for ${date}: ${shortSummary.substring(0, 80)}...`);
  return { short: shortSummary, long: blogSummary };
}
