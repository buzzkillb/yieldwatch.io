import { db, schema } from '../db';
import { eq, desc, asc } from 'drizzle-orm';
import { generateOgChart } from '../utils/ogChart';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

if (!MINIMAX_API_KEY) {
  console.error('MINIMAX_API_KEY not set');
  process.exit(1);
}

const targetDate = process.argv[2];
if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  console.error('Usage: bun run src/scripts/backfill.ts YYYY-MM-DD');
  console.error('Example: bun run src/scripts/backfill.ts 2026-03-15');
  process.exit(1);
}

console.log(`[Backfill] Starting backfill for ${targetDate}`);

async function getRatesForDate(date: string): Promise<{ maturity: string; rate: number }[]> {
  const results = await db
    .select()
    .from(schema.yieldCurveRates)
    .where(eq(schema.yieldCurveRates.date, date));
  
  return results.map(r => ({
    maturity: r.maturity,
    rate: parseFloat(r.rate)
  }));
}

function getPreviousBusinessDay(dateStr: string): string {
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

function getDateMinusDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().split('T')[0];
}

function getPreviousBusinessDayFromDate(dateStr: string, daysBack: number): string {
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

function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getUTCDay()];
}

async function backfillDate(date: string): Promise<void> {
  console.log(`[Backfill] Processing ${date}...`);
  
  const yesterdayDate = getPreviousBusinessDay(date);
  const lastWeekDate = getDateMinusDays(date, 7);
  const thirtyDaysAgoDate = getPreviousBusinessDayFromDate(date, 30);
  
  const [todayRates, yesterdayRates, lastWeekRates, thirtyDaysRates] = await Promise.all([
    getRatesForDate(date),
    getRatesForDate(yesterdayDate),
    getRatesForDate(lastWeekDate),
    getRatesForDate(thirtyDaysAgoDate)
  ]);
  
  if (todayRates.length === 0) {
    console.log(`[Backfill] No rates data for ${date}, skipping`);
    return;
  }
  
  const dates = {
    today: { date, day: getDayOfWeek(date) },
    yesterday: { date: yesterdayDate, day: getDayOfWeek(yesterdayDate) },
    lastWeek: { date: lastWeekDate, day: getDayOfWeek(lastWeekDate) },
    thirtyDays: { date: thirtyDaysAgoDate, day: getDayOfWeek(thirtyDaysAgoDate) },
  };
  
  const dataPrompt = `- Today (${dates.today.day}, ${dates.today.date}): ${JSON.stringify(todayRates)}
- Yesterday (${dates.yesterday.day}, ${dates.yesterday.date}): ${JSON.stringify(yesterdayRates)}
- One week ago (${dates.lastWeek.day}, ${dates.lastWeek.date}): ${JSON.stringify(lastWeekRates)}
- One month ago (${dates.thirtyDays.day}, ${dates.thirtyDays.date}): ${JSON.stringify(thirtyDaysRates)}`;
  
  const shortSystemPrompt = `You are a plain-spoken writer describing U.S. Treasury yield curve data. Treasury publishes rates on business days only - weekends and holidays are skipped.

Rules:
- Write 2-4 sentences as one paragraph
- Always mention the 30-year rate prominently
- You MUST include comparison to last week in every output
- When describing changes, use simple language like "up from last week" or "higher than yesterday"
- Do NOT use phrases like "percentage points" or "basis points" - just say "higher" or "lower"
- If the yield curve is inverted, state that fact only - do not explain what it means
- Stick to observable data comparisons - do not explain what rate movements mean for investors or markets
- Keep it factual and straightforward
- Never use bullet points, dashes, or list format
- Never use foreign characters or non-ASCII symbols
- Write in plain English only

${dataPrompt}`;
  
  const longSystemPrompt = `You are a financial journalist writing a daily market brief about U.S. Treasury yields. Treasury publishes rates on business days only - weekends and holidays are skipped.

Rules:
- Write exactly 4 paragraphs of 3-5 sentences each
- Paragraph 1: Open with the 30-year rate and key weekly movements (vs last week)
- Paragraph 2: Cover the broader curve - rate changes across maturities compared to last week
- Paragraph 3: Discuss how rates have changed over the past month (vs 30 days ago) - highlight notable moves at different parts of the curve
- Paragraph 4: Summarize curve shape changes, inversions, and any notable patterns compared to both last week and 30 days ago
- Use plain language - no jargon or educational explanations
- Do NOT use "percentage points" or "basis points" - just say "higher" or "lower"
- Do NOT explain what rate movements mean for investors or markets
- Keep it factual and informative
- Never use bullet points, dashes, or list format
- Never use foreign characters or non-ASCII symbols
- Write in plain English only
- Separate paragraphs with a blank line

${dataPrompt}`;
  
  const shortUserMessage = `Write a brief paragraph about today's Treasury yield curve rates. Keep it to 2-4 sentences. Focus on the 30-year rate and how it compares to last week.`;
  const longUserMessage = `Write a detailed daily market brief about today's Treasury yield curve rates in exactly 4 paragraphs. This will be published on a blog. Cover the overall curve shape, notable rate movements, how today compares to last week, and how the curve has shifted over the past month. Separate paragraphs with a blank line.`;
  
  console.log(`[Backfill] Calling MiniMax API for ${date}...`);
  
  const [shortResponse, longResponse] = await Promise.all([
    fetch('https://api.minimax.io/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': MINIMAX_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        max_tokens: 1000,
        system: shortSystemPrompt,
        messages: [{ role: 'user', content: [{ type: 'text', text: shortUserMessage }] }],
        temperature: 1
      })
    }),
    fetch('https://api.minimax.io/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': MINIMAX_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        max_tokens: 3000,
        system: longSystemPrompt,
        messages: [{ role: 'user', content: [{ type: 'text', text: longUserMessage }] }],
        temperature: 1
      })
    })
  ]);
  
  const parseResponse = async (response: Response): Promise<string> => {
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[Backfill] MiniMax API error: ${response.status} - ${errorText}`);
      return '';
    }
    const data = await response.json() as { content?: { type: string; text?: string }[] };
    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text' && block.text) {
          return block.text.trim();
        }
      }
    }
    return '';
  };
  
  const [shortSummary, blogSummary] = await Promise.all([
    parseResponse(shortResponse),
    parseResponse(longResponse)
  ]);
  
  if (!shortSummary) {
    console.log(`[Backfill] No short summary generated for ${date}, skipping`);
    return;
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
  
  console.log(`[Backfill] Summary saved for ${date}: ${shortSummary.substring(0, 80)}...`);
  
  const rates = todayRates.map(r => ({ maturity: r.maturity, rate: parseFloat(r.rate) }));
  const pngBuffer = await generateOgChart(rates);
  
  const publicDir = join(process.cwd(), 'public');
  const ogDir = join(publicDir, 'og');
  if (!existsSync(ogDir)) {
    mkdirSync(ogDir, { recursive: true });
  }
  
  const pngPath = join(ogDir, `${date}.png`);
  writeFileSync(pngPath, pngBuffer);
  console.log(`[Backfill] OG image generated for ${date}: ${pngPath}`);
}

async function main(): Promise<void> {
  try {
    await backfillDate(targetDate);
    console.log(`[Backfill] Complete for ${targetDate}`);
    process.exit(0);
  } catch (error) {
    console.error('[Backfill] Error:', error);
    process.exit(1);
  }
}

main();
