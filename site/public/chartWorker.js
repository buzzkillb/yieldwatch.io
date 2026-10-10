// Web Worker for processing chart data
// Handles JSON parsing, data transformation, and TypedArray creation off main thread

const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];

self.onmessage = function(e) {
  const rawData = e.data;
  
  try {
    const result = processChartData(rawData);
    self.postMessage({ success: true, data: result });
  } catch (error) {
    self.postMessage({ success: false, error: error.message });
  }
};

function processChartData(rawData) {
  // Phase 1: Build lookup map O(n) instead of O(n*m)
  const dateMap = new Map();
  for (const dayData of rawData) {
    const ratesMap = new Map();
    for (const rate of dayData.rates) {
      ratesMap.set(rate.maturity, rate.rate);
    }
    dateMap.set(dayData.date, ratesMap);
  }
  
  // Phase 2: Get sorted dates
  const sortedDates = Array.from(dateMap.keys()).sort();
  const dateCount = sortedDates.length;
  
  // Phase 3: Pre-allocate TypedArrays for each maturity
  // Using Float32Array - less memory than Float64, sufficient for rates (2 decimal precision)
  const datasets = MATURITY_ORDER.map((maturity, maturityIndex) => {
    const data = new Float32Array(dateCount);
    
    for (let i = 0; i < dateCount; i++) {
      const ratesMap = dateMap.get(sortedDates[i]);
      const rate = ratesMap ? ratesMap.get(maturity) : NaN;
      data[i] = rate;
    }
    
    return {
      label: maturity,
      data: data,
      borderColor: getColor(maturityIndex),
      backgroundColor: getColor(maturityIndex) + '20',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.1,
      fill: false,
    };
  });
  
  // Phase 4: Convert dates to timestamps (more efficient for Chart.js)
  const labels = new Float64Array(dateCount);
  for (let i = 0; i < dateCount; i++) {
    const [year, month, day] = sortedDates[i].split('-');
    labels[i] = Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day));
  }
  
  return {
    labels: labels,
    datasets: datasets,
    dateCount: dateCount
  };
}

const CHART_COLORS = [
  '#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#10b981',
  '#f59e0b', '#ef4444'
];

function getColor(index) {
  return CHART_COLORS[index % CHART_COLORS.length];
}

// Keep-alive ping to detect if worker is still running
setInterval(() => {}, 10000);