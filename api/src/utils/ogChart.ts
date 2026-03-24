import sharp from 'sharp';

const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];

const CHART_COLORS = [
  '#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#10b981',
  '#f59e0b', '#ef4444'
];

interface Rate {
  maturity: string;
  rate: number;
}

export async function generateOgChart(rates: Rate[]): Promise<Buffer> {
  if (rates.length < 2) {
    throw new Error('At least 2 rates required for chart generation');
  }

  const chartX = 50;
  const chartY = 50;
  const chartW = 1100;
  const chartH = 530;
  const pointSpacing = chartW / (rates.length - 1);

  const ratesMap = new Map(rates.map(r => [r.maturity, r.rate]));
  const orderedRates = MATURITY_ORDER.map(m => ({
    maturity: m,
    rate: ratesMap.get(m) || 0
  }));

  const maxRate = Math.max(...orderedRates.map(r => r.rate));
  const minRate = Math.min(...orderedRates.map(r => r.rate));
  const rateRange = maxRate - minRate || 1;

  let pathD = '';
  orderedRates.forEach((r, i) => {
    const x = chartX + i * pointSpacing;
    const y = chartY + chartH - ((r.rate - minRate + 0.5) / (rateRange + 1)) * chartH;
    pathD += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  });

  const circles = orderedRates.map((r, i) => {
    const x = chartX + i * pointSpacing;
    const y = chartY + chartH - ((r.rate - minRate + 0.5) / (rateRange + 1)) * chartH;
    const colorIndex = i % CHART_COLORS.length;
    return `<circle cx="${x}" cy="${y}" r="10" fill="${CHART_COLORS[colorIndex]}" stroke="white" stroke-width="3"/>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#0a0a0f"/>
        <stop offset="100%" style="stop-color:#12121a"/>
      </linearGradient>
      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#2a2a3a"/>
        <stop offset="100%" style="stop-color:#f0f0f5"/>
      </linearGradient>
    </defs>
    <rect fill="url(#bg)" width="1200" height="630"/>
    <path d="${pathD}" fill="none" stroke="url(#lineGrad)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    ${circles}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

export { MATURITY_ORDER, CHART_COLORS };
