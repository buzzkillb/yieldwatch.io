import { parseYieldXml, parseYearHighLow, type ParsedYieldCurve } from '../utils/parse';

const TREASURY_XML_URL = 'https://home.treasury.gov/sites/default/files/interest-rates/yield.xml';
const FETCH_TIMEOUT_MS = 30000;

export interface FetchResult {
  success: boolean;
  data?: ParsedYieldCurve[];
  yearHighLow?: Awaited<ReturnType<typeof parseYearHighLow>>;
  error?: string;
  retryable: boolean;
}

export async function fetchTreasuryYieldCurve(retries = 3, delayMs = 5000): Promise<FetchResult> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Fetcher] Attempt ${attempt}/${retries}: Fetching Treasury yield curve data...`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      
      const response = await fetch(TREASURY_XML_URL, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/xml',
          'User-Agent': 'TreasuryDashboard/1.0',
        },
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const xml = await response.text();
      
      if (!xml || xml.length < 100) {
        throw new Error('Empty or invalid XML response');
      }
      
      const data = parseYieldXml(xml);
      const yearHighLow = parseYearHighLow(xml);
      
      if (data.length === 0) {
        throw new Error('No yield curve data parsed from XML');
      }
      
      console.log(`[Fetcher] Successfully fetched ${data.length} days of yield curve data`);
      
      return { success: true, data, yearHighLow };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRetryable = attempt < retries;
      
      console.log(`[Fetcher] Attempt ${attempt} failed: ${errorMessage}. ${isRetryable ? `Retrying in ${delayMs}ms...` : 'No more retries.'}`);
      
      if (isRetryable) {
        await sleep(delayMs);
      }
      
      if (!isRetryable) {
        return { 
          success: false, 
          error: errorMessage, 
          retryable: false 
        };
      }
    }
  }
  
  return { success: false, error: 'Max retries exceeded', retryable: true };
}

export async function fetchLatestDate(): Promise<string | null> {
  try {
    const response = await fetch(TREASURY_XML_URL, {
      headers: {
        'Accept': 'application/xml',
        'User-Agent': 'TreasuryDashboard/1.0',
      },
    });
    
    if (!response.ok) return null;
    
    const xml = await response.text();
    const data = parseYieldXml(xml);
    
    if (data.length === 0) return null;
    
    return data[data.length - 1].date;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
