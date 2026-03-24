import { readFileSync } from 'fs';

const envContent = readFileSync('/Users/buzzkillb/Desktop/Projects/treasury/.env', 'utf-8');
const apiKeyMatch = envContent.match(/MINIMAX_API_KEY=(.+)/);
const apiKey = apiKeyMatch?.[1];

if (!apiKey) {
  console.error('MINIMAX_API_KEY not found in .env');
  process.exit(1);
}

const todayRates = [
  { maturity: '4WK', rate: 3.73 },
  { maturity: '6WK', rate: 3.71 },
  { maturity: '2MO', rate: 3.72 },
  { maturity: '3MO', rate: 3.74 },
  { maturity: '4MO', rate: 3.72 },
  { maturity: '6MO', rate: 3.77 },
  { maturity: '1YR', rate: 3.76 },
  { maturity: '2YR', rate: 3.83 },
  { maturity: '3YR', rate: 3.85 },
  { maturity: '5YR', rate: 3.95 },
  { maturity: '7YR', rate: 4.15 },
  { maturity: '10YR', rate: 4.34 },
  { maturity: '20YR', rate: 4.93 },
  { maturity: '30YR', rate: 4.91 },
];

const yesterdayRates = [
  { maturity: '4WK', rate: 3.72 },
  { maturity: '6WK', rate: 3.70 },
  { maturity: '2MO', rate: 3.71 },
  { maturity: '3MO', rate: 3.73 },
  { maturity: '4MO', rate: 3.71 },
  { maturity: '6MO', rate: 3.76 },
  { maturity: '1YR', rate: 3.75 },
  { maturity: '2YR', rate: 3.81 },
  { maturity: '3YR', rate: 3.84 },
  { maturity: '5YR', rate: 3.93 },
  { maturity: '7YR', rate: 4.13 },
  { maturity: '10YR', rate: 4.32 },
  { maturity: '20YR', rate: 4.91 },
  { maturity: '30YR', rate: 4.89 },
];

const lastWeekRates = [
  { maturity: '4WK', rate: 3.68 },
  { maturity: '6WK', rate: 3.65 },
  { maturity: '2MO', rate: 3.66 },
  { maturity: '3MO', rate: 3.68 },
  { maturity: '4MO', rate: 3.65 },
  { maturity: '6MO', rate: 3.70 },
  { maturity: '1YR', rate: 3.70 },
  { maturity: '2YR', rate: 3.75 },
  { maturity: '3YR', rate: 3.78 },
  { maturity: '5YR', rate: 3.88 },
  { maturity: '7YR', rate: 4.08 },
  { maturity: '10YR', rate: 4.28 },
  { maturity: '20YR', rate: 4.85 },
  { maturity: '30YR', rate: 4.82 },
];

const dates = {
  today: { date: '2026-03-23', day: 'Monday' },
  yesterday: { date: '2026-03-20', day: 'Friday' },  // Treasury doesn't publish on weekends
  lastWeek: { date: '2026-03-16', day: 'Monday' },
};

const systemPrompt = `You are a plain-spoken writer describing U.S. Treasury yield curve data. Treasury publishes rates on business days only - weekends and holidays are skipped.

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

Date info:
- Today (${dates.today.day}, ${dates.today.date}): ${JSON.stringify(todayRates)}
- Last business day (${dates.yesterday.day}, ${dates.yesterday.date}): ${JSON.stringify(yesterdayRates)}
- Last week (${dates.lastWeek.day}, ${dates.lastWeek.date}): ${JSON.stringify(lastWeekRates)}`;

const userMessage = `Write a brief paragraph about today's Treasury yield curve rates. Treasury is closed on weekends and holidays, so compare today to the last business day and to one week ago.`;

async function testMiniMax() {
  console.log('Testing MiniMax API...\n');

  const response = await fetch('https://api.minimax.io/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [
        { role: 'user', content: [{ type: 'text', text: userMessage }] }
      ],
      temperature: 1
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('MiniMax API Error:', response.status, error);
    process.exit(1);
  }

  const data = await response.json();
  
  let generatedText = '';
  
  if (data.content && Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'text') {
        generatedText = block.text;
        break;
      }
    }
  }

  if (generatedText) {
    console.log('Generated text:\n');
    console.log(generatedText);
    console.log('\n---\nTest successful!');
  } else {
    console.error('No text generated. Response:', JSON.stringify(data, null, 2));
  }
}

testMiniMax();