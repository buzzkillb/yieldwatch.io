export interface ParsedYieldCurve {
  date: string;
  dayOfWeek: string;
  rates: {
    maturity: string;
    rate: number;
  }[];
}

export interface TreasuryApiResponse {
  date: string;
  dayOfWeek: string;
  rates: {
    maturity: string;
    label: string;
    rate: number;
  }[];
  yearHigh: number;
  yearHighDate: string;
  yearLow: number;
  yearLowDate: string;
}

export const MATURITY_MAP: Record<string, { label: string; years: number }> = {
  BC_1MONTH: { label: '4WK', years: 1 / 12 },
  BC_1_5MONTH: { label: '6WK', years: 1.5 / 12 },
  BC_2MONTH: { label: '2MO', years: 2 / 12 },
  BC_3MONTH: { label: '3MO', years: 3 / 12 },
  BC_4MONTH: { label: '4MO', years: 4 / 12 },
  BC_6MONTH: { label: '6MO', years: 6 / 12 },
  BC_1YEAR: { label: '1YR', years: 1 },
  BC_2YEAR: { label: '2YR', years: 2 },
  BC_3YEAR: { label: '3YR', years: 3 },
  BC_5YEAR: { label: '5YR', years: 5 },
  BC_7YEAR: { label: '7YR', years: 7 },
  BC_10YEAR: { label: '10YR', years: 10 },
  BC_20YEAR: { label: '20YR', years: 20 },
  BC_30YEAR: { label: '30YR', years: 30 },
};

function parseXmlDate(dateStr: string): string {
  const parts = dateStr.match(/(\d{2})-(\w{3})-(\d{2})/);
  if (!parts) return dateStr;
  
  const [, day, monthStr, year] = parts;
  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
  };
  const month = months[monthStr] || '01';
  return `${20}${year}-${month}-${day}`;
}

export function parseYieldXml(xml: string): ParsedYieldCurve[] {
  const results: ParsedYieldCurve[] = [];
  
  const dateRegex = /<BID_CURVE_DATE>(\d{2}-\w{3}-\d{2})<\/BID_CURVE_DATE>[\s\S]*?<DAY_OF_WEEK>(\w+)\s*<\/DAY_OF_WEEK>[\s\S]*?<LIST_G_BC_CAT>[\s\S]*?<\/LIST_G_BC_CAT>/g;
  
  let match;
  while ((match = dateRegex.exec(xml)) !== null) {
    const [fullMatch, bidCurveDate, dayOfWeek] = match;
    
    const rates: { maturity: string; rate: number }[] = [];
    
    for (const [key, value] of Object.entries(MATURITY_MAP)) {
      const rateRegex = new RegExp(`<${key}>([\\d.-]+)</${key}>`);
      const rateMatch = rateRegex.exec(fullMatch);
      if (rateMatch && rateMatch[1]) {
        const rate = parseFloat(rateMatch[1]);
        if (!isNaN(rate)) {
          rates.push({ maturity: value.label, rate });
        }
      }
    }
    
    if (rates.length > 0) {
      results.push({
        date: parseXmlDate(bidCurveDate),
        dayOfWeek: dayOfWeek.trim(),
        rates,
      });
    }
  }
  
  return results.sort((a, b) => a.date.localeCompare(b.date));
}

export function parseWeeklyAverages(xml: string): {
  weekOfMonth: number;
  averages: Record<string, number>;
}[] {
  const results: {
    weekOfMonth: number;
    averages: Record<string, number>;
  }[] = [];
  
  const weekRegex = /<G_WEEK_OF_MONTH>[\s\S]*?<WEEK_OF_MONTH>(\d+)<\/WEEK_OF_MONTH>[\s\S]*?<AVERAGE_1MONTH>([\d.-]+)<\/AVERAGE_1MONTH>[\s\S]*?<\/G_WEEK_OF_MONTH>/g;
  
  let match;
  while ((match = weekRegex.exec(xml)) !== null) {
    const [fullMatch, weekOfMonth] = match;
    
    const averages: Record<string, number> = {};
    
    for (const [key, value] of Object.entries(MATURITY_MAP)) {
      const avgRegex = new RegExp(`<AVERAGE_${key.replace('BC_', '')}>([\\d.-]+)</AVERAGE_${key.replace('BC_', '')}>`);
      const avgMatch = avgRegex.exec(fullMatch);
      if (avgMatch && avgMatch[1]) {
        averages[value.label] = parseFloat(avgMatch[1]);
      }
    }
    
    results.push({
      weekOfMonth: parseInt(weekOfMonth),
      averages,
    });
  }
  
  return results;
}

export function parseYearHighLow(xml: string): {
  maturity: string;
  yearHigh: number;
  yearHighDate: string;
  yearLow: number;
  yearLowDate: string;
}[] {
  const results: {
    maturity: string;
    yearHigh: number;
    yearHighDate: string;
    yearLow: number;
    yearLowDate: string;
  }[] = [];
  
  for (const [key, value] of Object.entries(MATURITY_MAP)) {
    const highRegex = new RegExp(`<CF_YEARHIGH_${key.replace('BC_', '')}_RATE>\\s*([\\d.-]+)</CF_YEARHIGH_${key.replace('BC_', '')}_RATE>[\\s\\S]*?<CP_YEARHIGH_${key.replace('BC_', '')}_DATE>(\\d{2}/\\d{2}/\\d{2})</CP_YEARHIGH_${key.replace('BC_', '')}_DATE>`);
    const lowRegex = new RegExp(`<CF_YEARLOW_${key.replace('BC_', '')}_RATE>\\s*([\\d.-]+)</CF_YEARLOW_${key.replace('BC_', '')}_RATE>[\\s\\S]*?<CP_YEARLOW_${key.replace('BC_', '')}_DATE>(\\d{2}/\\d{2}/\\d{2})</CP_YEARLOW_${key.replace('BC_', '')}_DATE>`);
    
    const highMatch = highRegex.exec(xml);
    const lowMatch = lowRegex.exec(xml);
    
    if (highMatch && lowMatch) {
      const parseShortDate = (dateStr: string) => {
        const [mm, dd, yy] = dateStr.split('/');
        return `20${yy}-${mm}-${dd}`;
      };
      
      results.push({
        maturity: value.label,
        yearHigh: parseFloat(highMatch[1]),
        yearHighDate: parseShortDate(highMatch[2]),
        yearLow: parseFloat(lowMatch[1]),
        yearLowDate: parseShortDate(lowMatch[2]),
      });
    }
  }
  
  return results;
}

export const MATURITIES = Object.values(MATURITY_MAP).map(v => ({
  maturity: v.label,
  years: v.years,
})).sort((a, b) => a.years - b.years);
