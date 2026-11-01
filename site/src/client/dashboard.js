    const MATURITY_ORDER = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];
    const CHART_COLORS = [
      '#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#eab308',
      '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#10b981',
      '#f59e0b', '#ef4444'
    ];

    let chart = null;
    let latestRates = {};
    let chartData = { labels: [], datasets: [] };
    let activeMaturities = new Set(MATURITY_ORDER);
    let currentRange = '3m';
    let availableRanges = { '3m': true, '6m': true, '1y': true, '2y': true, '5y': true, 'all': true };
    let latestDataDate = null;
    let earliestDataDate = null;
    let historyRequestId = 0;

    function announceToScreenReader(message) {
      const announcement = document.createElement('div');
      announcement.setAttribute('aria-live', 'polite');
      announcement.setAttribute('aria-atomic', 'true');
      announcement.className = 'sr-only';
      announcement.textContent = message;
      document.body.appendChild(announcement);
      setTimeout(() => announcement.remove(), 1000);
    }

    function setLoading(isLoading) {
      const chartLoading = document.getElementById('chartLoading');
      if (isLoading) {
        chartLoading.classList.remove('hidden');
      } else {
        chartLoading.classList.add('hidden');
      }
    }

    const RANGE_BUTTONS = {
      '3m': 'btn3m', '6m': 'btn6m', '1y': 'btn1y',
      '2y': 'btn2y', '5y': 'btn5y', 'all': 'btnAll',
    };
    const RANGE_LABELS = {
      '3m': '3 month', '6m': '6 month', '1y': '1 year',
      '2y': '2 year', '5y': '5 year', 'all': 'all',
    };

    function coverageDescription() {
      if (!earliestDataDate || !latestDataDate) return 'data available';
      const months = (latestDataDate.getFullYear() - earliestDataDate.getFullYear()) * 12
        + (latestDataDate.getMonth() - earliestDataDate.getMonth());
      if (months < 1) return 'less than one month of data available';
      if (months < 12) return `${months} month${months === 1 ? '' : 's'} of data available`;
      const years = Math.floor(months / 12);
      const rem = months % 12;
      return `${years} year${years === 1 ? '' : 's'}${rem ? ` ${rem} month${rem === 1 ? '' : 's'}` : ''} of data available`;
    }

    function updateAvailableRanges() {
      if (!latestDataDate) return;

      // Each cutoff is computed from an untouched base date. Previously the
      // same Date object was mutated in place, so every longer range was
      // measured from an already-shifted date (3, 9, 21, 45, 105 months).
      const base = new Date();
      const cutoff = (months, years) => {
        const d = new Date(base.getTime());
        d.setFullYear(d.getFullYear() - years, d.getMonth() - months, d.getDate());
        return d;
      };
      const cutoffs = {
        '3m': cutoff(3, 0), '6m': cutoff(6, 0), '1y': cutoff(0, 1),
        '2y': cutoff(0, 2), '5y': cutoff(0, 5),
      };

      // A range is only available when the archive actually reaches back to
      // its start date. Comparing the newest row against the cutoff would
      // wrongly enable 5Y on a site that launched last week.
      const coverageStart = earliestDataDate || null;
      Object.entries(cutoffs).forEach(([range, start]) => {
        // Without coverage metadata (e.g. a cached pre-upgrade payload),
        // fail open rather than disabling every range but "all".
        availableRanges[range] = coverageStart ? coverageStart <= start : true;
      });
      availableRanges.all = true;

      Object.entries(RANGE_BUTTONS).forEach(([range, id]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const available = Boolean(availableRanges[range]);
        btn.disabled = !available;
        btn.title = available
          ? `Show ${RANGE_LABELS[range]} history`
          : `${RANGE_LABELS[range]} data not available (${coverageDescription()})`;
      });

      if (!availableRanges[currentRange]) {
        const fallback = ['3m', '6m', '1y', '2y', '5y', 'all'].find(r => availableRanges[r]);
        if (fallback) {
          currentRange = fallback;
          setActiveButton(RANGE_BUTTONS[currentRange]);
        }
      }
    }

    async function fetchLatestRates() {
      try {
        const response = await fetch('/api/rates/latest.json');
        const data = await response.json();
        
        if (data.success && data.data) {
          displayLatestRates(data.data);
          latestDataDate = new Date(data.data.date + 'T00:00:00Z');
          const earliest = data.meta && data.meta.earliest;
          earliestDataDate = earliest ? new Date(earliest + 'T00:00:00Z') : null;
          updateAvailableRanges();
          fetchHistoricalData();
          fetchDailySummary();
        } else {
          showError('Unable to load latest rates');
        }
      } catch (error) {
        showError('Connection failed. Check your internet connection or try again later.');
        setTimeout(fetchLatestRates, 10000);
      }
    }

    async function fetchDailySummary() {
      try {
        const response = await fetch('/api/daily-summary');
        if (response.ok) {
          const text = await response.text();
          const summaryEl = document.getElementById('dailySummary');
          if (text && summaryEl) {
            summaryEl.textContent = text;
          }
        }
      } catch (error) {
        console.log('Daily summary not available');
      }
    }

    function displayLatestRates(data) {
      latestRates = {};
      data.rates.forEach(r => {
        latestRates[r.maturity] = r.rate;
      });

      const lastUpdated = document.getElementById('lastUpdated');
      if (lastUpdated) {
        lastUpdated.textContent = data.dateFormatted;
      }

      const ratesContainer = document.getElementById('ratesContainer');
      ratesContainer.innerHTML = `
        <div class="rates-section">
          <div class="rates-grid" id="ratesGrid" role="group" aria-label="Treasury yield rates by maturity"></div>
        </div>
      `;
      const grid = document.getElementById('ratesGrid');

      MATURITY_ORDER.forEach((maturity) => {
        const rate = latestRates[maturity];
        if (rate !== undefined) {
          const card = document.createElement('div');
          card.className = 'rate-card';
          card.dataset.maturity = maturity;
          card.tabIndex = 0;
          card.setAttribute('role', 'button');
          card.setAttribute('aria-pressed', activeMaturities.has(maturity) ? 'true' : 'false');
          card.setAttribute('aria-label', `Toggle ${maturity} rate ${rate.toFixed(2)}%`);
          card.innerHTML = `
            <div class="maturity" aria-hidden="true">${maturity}</div>
            <div class="rate">${rate.toFixed(2)}%</div>
          `;
          card.onclick = () => toggleMaturity(maturity);
          card.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleMaturity(maturity);
            }
          };
          grid.appendChild(card);
        }
      });
      
      announceToScreenReader('Yield rates loaded successfully');
    }

    let sparklineData = {};   // maturity -> [[date, rate], ...] over 3 months
    let sparklineHover = {};  // maturity -> hovered rate (persist across redraws)

    function buildSparklines(data) {
      // API returns rows grouped by date: [{date, rates: [{maturity, rate}]}]
      const byMaturity = {};
      for (const day of data) {
        const rates = day.rates || [];
        for (const r of rates) {
          (byMaturity[r.maturity] = byMaturity[r.maturity] || []).push([day.date, parseFloat(r.rate)]);
        }
      }
      for (const k of Object.keys(byMaturity)) {
        byMaturity[k].sort((a, b) => a[0] < b[0] ? -1 : 1);
      }
      sparklineData = byMaturity;
      renderSparklines();
    }

    function sparklinePath(points, w, h) {
      if (!points || points.length < 2) return '';
      const rates = points.map(p => p[1]);
      const min = Math.min(...rates), max = Math.max(...rates);
      const range = (max - min) || 1;
      const step = w / (points.length - 1);
      return points.map((p, i) => {
        const x = (i * step).toFixed(1);
        const y = (h - ((p[1] - min) / range) * (h - 4) - 2).toFixed(1);
        return (i === 0 ? 'M' : 'L') + x + ' ' + y;
      }).join(' ');
    }

    function renderSparklines() {
      for (const maturity of Object.keys(latestRates)) {
        const card = document.querySelector('.rate-card[data-maturity="' + maturity + '"]');
        if (!card) continue;
        const old = card.querySelector('.rate-sparkline');
        if (old) old.remove();
        const pts = sparklineData[maturity];
        if (!pts || pts.length < 2) continue;
        // end dot color: green if rate fell over the window, red if it rose
        const first = pts[0][1], last = pts[pts.length - 1][1];
        const color = last < first ? '#22c55e' : '#ef4444';
        const w = 120, h = 22;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'rate-sparkline');
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', sparklinePath(pts, w, h));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);
        const endY = h - 2 - ((last - Math.min(...pts.map(p => p[1]))) / ((Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]))) || 1)) * (h - 4);
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(w - 1));
        dot.setAttribute('cy', endY.toFixed(1));
        dot.setAttribute('r', '2');
        dot.setAttribute('fill', color);
        svg.appendChild(dot);
        // title tooltip: change over window
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        const diff = last - first;
        title.textContent = '3-month change: ' + (diff >= 0 ? '+' : '') + diff.toFixed(2) + '%';
        svg.appendChild(title);
        card.appendChild(svg);
      }
    }

    async function fetchHistoricalData() {
      const requestId = ++historyRequestId;
      const requestedRange = currentRange;
      setLoading(true);

      try {
        const RANGE_FILES = { '3m': '/api/rates/3m.json', '6m': '/api/rates/6m.json', '1y': '/api/rates/1y.json', '2y': '/api/rates/2y.json', '5y': '/api/rates/5y.json', 'all': '/api/rates/all.json' };
        const response = await fetch(RANGE_FILES[requestedRange] || '/api/rates/all.json');
        const data = await response.json();

        // A newer range request superseded this one while it was in flight.
        if (requestId !== historyRequestId) return;

        if (data.success && data.data) {
          // Feed 3-month sparklines under each rate card (independent of chart range)
          if (requestedRange === '3m') {
            buildSparklines(data.data);
          }
          // Use Web Worker for heavy processing, with a main-thread fallback
          // so a blocked or unavailable worker cannot leave the chart blank.
          let result;
          try {
            result = await processInWorker(data.data);
          } catch (workerError) {
            console.warn('Chart worker unavailable; processing on the main thread.', workerError);
            if (chartWorker) {
              chartWorker.terminate();
              chartWorker = null;
            }
            processChartData(data.data);
            result = { labels: chartData.labels, datasets: chartData.datasets };
          }
          if (requestId !== historyRequestId) return;

          chartData.labels = result.labels;
          // The worker rebuilds datasets from scratch, so re-apply the user's
          // maturity toggles instead of silently re-showing every series.
          chartData.datasets = result.datasets.map(dataset => ({
            ...dataset,
            hidden: !activeMaturities.has(dataset.label),
          }));
          renderChart();
          renderLegend();
        } else {
          console.error('Failed to fetch historical data');
        }
      } catch (error) {
        console.error('Failed to fetch historical data:', error);
      } finally {
        if (requestId === historyRequestId) setLoading(false);
      }
    }

    // Web Worker for heavy data processing
    let chartWorker = null;
    let workerRequestId = 0;
    const workerPending = new Map();

    function getChartWorker() {
      if (chartWorker) return chartWorker;
      chartWorker = new Worker('/chartWorker.js');
      chartWorker.onmessage = function(e) {
        const pending = workerPending.get(e.data.id);
        if (!pending) return; // stale response from a superseded request
        workerPending.delete(e.data.id);
        clearTimeout(pending.timeoutId);
        if (e.data.success) {
          pending.resolve(e.data.data);
        } else {
          pending.reject(new Error(e.data.error));
        }
      };
      chartWorker.onerror = function(e) {
        workerPending.forEach(p => {
          clearTimeout(p.timeoutId);
          p.reject(e);
        });
        workerPending.clear();
        chartWorker.terminate();
        chartWorker = null;
      };
      return chartWorker;
    }

    function processInWorker(rawData) {
      return new Promise((resolve, reject) => {
        const worker = getChartWorker();
        const id = ++workerRequestId;
        const timeoutId = setTimeout(() => {
          workerPending.delete(id);
          reject(new Error('Worker timeout - falling back to main thread'));
        }, 30000);
        workerPending.set(id, { resolve, reject, timeoutId });
        worker.postMessage({ id, data: rawData });
      });
    }

    function processChartData(rawData) {
      const sortedDates = [...new Set(rawData.map(d => d.date))].sort();
      // Build one index instead of scanning rawData for every date/maturity.
      const byDate = new Map();
      rawData.forEach(day => {
        const rates = new Map((day.rates || []).map(r => [r.maturity, r.rate]));
        byDate.set(day.date, rates);
      });

      chartData.labels = sortedDates.map(date => {
        const [year, month, day] = date.split('-');
        return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
      });

      chartData.datasets = MATURITY_ORDER.map((maturity, index) => {
        const colorIndex = index % CHART_COLORS.length;
        return {
          label: maturity,
          data: sortedDates.map(date => {
            const rate = byDate.get(date)?.get(maturity);
            return rate === undefined ? null : rate;
          }),
          borderColor: CHART_COLORS[colorIndex],
          backgroundColor: CHART_COLORS[colorIndex] + '20',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.1,
          fill: false,
          hidden: !activeMaturities.has(maturity),
        };
      });
    }

    function renderChart() {
      const ctx = document.getElementById('yieldChart').getContext('2d');
      
      if (chart) {
        chart.destroy();
      }

      chart = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false,
          },
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              backgroundColor: '#1a1a25',
              titleColor: '#f0f0f5',
              bodyColor: '#9090a0',
              borderColor: '#2a2a3a',
              borderWidth: 1,
              padding: 12,
              titleFont: {
                family: "'SF Mono', monospace",
                size: 12,
                weight: '600'
              },
              bodyFont: {
                family: "'SF Mono', monospace",
                size: 11
              },
              filter: function(tooltipItem) {
                return Number.isFinite(tooltipItem.raw);
              },
              callbacks: {
                label: function(context) {
                  return `${context.dataset.label}: ${context.raw.toFixed(2)}%`;
                }
              }
            }
          },
          scales: {
            x: {
              type: 'time',
              time: {
                unit: (currentRange === '3m' || currentRange === '6m') ? 'week' : 'month',
                displayFormats: {
                  week: 'MMM d',
                  month: 'MMM yyyy'
                }
              },
              grid: {
                color: '#252535',
                drawBorder: false,
              },
              ticks: {
                color: '#787890',
                font: {
                  family: "'SF Mono', monospace",
                  size: 10
                }
              },
              title: {
                display: true,
                text: 'Date',
                color: '#787890',
                font: {
                  family: "'SF Mono', monospace",
                  size: 11
                }
              }
            },
            y: {
              grid: {
                color: '#252535',
                drawBorder: false,
              },
              ticks: {
                color: '#787890',
                font: {
                  family: "'SF Mono', monospace",
                  size: 10
                },
                callback: function(value) {
                  return value.toFixed(1) + '%';
                }
              }
            }
          }
        }
      });
    }

    function renderLegend() {
      const container = document.getElementById('legendContainer');
      container.innerHTML = '';

      MATURITY_ORDER.forEach((maturity, index) => {
        if (latestRates[maturity] === undefined) return;
        
        const colorIndex = index % CHART_COLORS.length;
        const item = document.createElement('div');
        item.className = 'legend-item' + (activeMaturities.has(maturity) ? ' active' : ' inactive');
        item.dataset.maturity = maturity;
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.setAttribute('aria-pressed', activeMaturities.has(maturity) ? 'true' : 'false');
        item.setAttribute('aria-label', `Toggle ${maturity} visibility`);
        item.innerHTML = `
          <span class="legend-color" style="background: ${CHART_COLORS[colorIndex]}" aria-hidden="true"></span>
          <span>${maturity}</span>
        `;
        item.onclick = () => toggleMaturity(maturity);
        item.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleMaturity(maturity);
          }
        };
        container.appendChild(item);
      });
    }

    function toggleMaturity(maturity) {
      const wasActive = activeMaturities.has(maturity);
      
      if (wasActive) {
        activeMaturities.delete(maturity);
      } else {
        activeMaturities.add(maturity);
      }

      const dataset = chartData.datasets.find(d => d.label === maturity);
      if (dataset) {
        dataset.hidden = wasActive;
      }

      document.querySelectorAll(`.rate-card[data-maturity="${maturity}"]`).forEach(card => {
        card.classList.toggle('inactive', wasActive);
        card.setAttribute('aria-pressed', wasActive ? 'false' : 'true');
      });

      document.querySelectorAll(`.legend-item[data-maturity="${maturity}"]`).forEach(item => {
        item.classList.toggle('inactive', wasActive);
        item.setAttribute('aria-pressed', wasActive ? 'false' : 'true');
      });

      if (chart) {
        chart.update();
      }
      
      announceToScreenReader(`${maturity} ${wasActive ? 'hidden' : 'shown'}`);
    }

    function showError(message) {
      document.getElementById('ratesContainer').innerHTML = `
        <div class="error-message" role="alert">
          <p>${message}</p>
          <button onclick="location.reload()" aria-label="Retry loading data">Retry</button>
        </div>
      `;
    }

    function setActiveButton(btnId) {
      document.querySelectorAll('.chart-controls button').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    }

    function unavailableMessage(range) {
      return `${RANGE_LABELS[range]} data not available. ${coverageDescription()}.`;
    }

    document.getElementById('btn3m').onclick = () => {
      if (currentRange !== '3m') {
        if (!availableRanges['3m']) {
          announceToScreenReader(unavailableMessage('3m'));
          return;
        }
        currentRange = '3m';
        setActiveButton('btn3m', true);
        fetchHistoricalData();
        announceToScreenReader('Showing 3 month history');
      }
    };

    document.getElementById('btn6m').onclick = () => {
      if (currentRange !== '6m') {
        if (!availableRanges['6m']) {
          announceToScreenReader(unavailableMessage('6m'));
          return;
        }
        currentRange = '6m';
        setActiveButton('btn6m', true);
        fetchHistoricalData();
        announceToScreenReader('Showing 6 month history');
      }
    };

    document.getElementById('btn1y').onclick = () => {
      if (currentRange !== '1y') {
        if (!availableRanges['1y']) {
          announceToScreenReader(unavailableMessage('1y'));
          return;
        }
        currentRange = '1y';
        setActiveButton('btn1y', true);
        fetchHistoricalData();
        announceToScreenReader('Showing 1 year history');
      }
    };

    document.getElementById('btn2y').onclick = () => {
      if (currentRange !== '2y') {
        if (!availableRanges['2y']) {
          announceToScreenReader(unavailableMessage('2y'));
          return;
        }
        currentRange = '2y';
        setActiveButton('btn2y', true);
        fetchHistoricalData();
        announceToScreenReader('Showing 2 year history');
      }
    };

    document.getElementById('btn5y').onclick = () => {
      if (currentRange !== '5y') {
        if (!availableRanges['5y']) {
          announceToScreenReader(unavailableMessage('5y'));
          return;
        }
        currentRange = '5y';
        setActiveButton('btn5y', true);
        fetchHistoricalData();
        announceToScreenReader('Showing 5 year history');
      }
    };

    document.getElementById('btnAll').onclick = () => {
      if (currentRange !== 'all') {
        currentRange = 'all';
        setActiveButton('btnAll', true);
        fetchHistoricalData();
        announceToScreenReader('Showing all available history');
      }
    };

    fetchLatestRates();

    if (navigator.modelContext && navigator.modelContext.registerTool) {
      const controller = new AbortController();

      const tools = [
        {
          name: 'get_latest_yield_rates',
          description: 'Get the latest U.S. Treasury yield curve rates for all maturities (4WK to 30YR)',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => {
            const response = await fetch('/api/rates/latest.json');
            if (!response.ok) throw new Error(`Rates request failed: ${response.status}`);
            const payload = await response.json();
            return { success: true, data: payload.data };
          },
        },
        {
          name: 'get_historical_yield_rates',
          description: 'Get historical Treasury yield rates for a date range and optional maturity',
          inputSchema: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
              to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
              maturity: { type: 'string', description: 'Optional maturity (e.g., 10YR)' },
              limit: { type: 'number', description: 'Maximum rows to return (default 500, max 2000)' },
            },
          },
          execute: async ({ from, to, maturity, limit = 500 }) => {
            // Static snapshots cannot honor query strings, so filter locally.
            const response = await fetch('/api/rates/all.json');
            if (!response.ok) throw new Error(`Rates request failed: ${response.status}`);
            const payload = await response.json();
            const max = Math.min(Math.max(Number(limit) || 500, 1), 2000);
            const rows = (payload.data || [])
              .filter(row => (!from || row.date >= from) && (!to || row.date <= to))
              .map(row => ({
                date: row.date,
                rates: maturity ? row.rates.filter(r => r.maturity === maturity) : row.rates,
              }))
              .filter(row => row.rates.length > 0);
            return {
              success: true,
              data: rows.slice(-max),
              meta: { matched: rows.length, returned: Math.min(rows.length, max), truncated: rows.length > max },
            };
          },
        },
        {
          name: 'get_available_maturities',
          description: 'Get list of available Treasury maturity tenors',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => {
            const response = await fetch('/api/rates/maturities.json');
            if (!response.ok) throw new Error(`Maturities request failed: ${response.status}`);
            const payload = await response.json();
            return { success: true, data: payload.data };
          },
        },
        {
          name: 'get_yield_statistics',
          description: 'Get historical high/low statistics for Treasury yields',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => {
            const response = await fetch('/api/rates/stats.json');
            if (!response.ok) throw new Error(`Stats request failed: ${response.status}`);
            const payload = await response.json();
            return { success: true, data: payload.data };
          },
        },
        {
          name: 'get_blog_posts',
          description: 'Get Treasury yield analysis blog posts with AI summaries',
          inputSchema: {
            type: 'object',
            properties: {
              page: { type: 'number', description: 'Page number (default: 1)' },
            },
          },
          execute: async ({ page = 1 }) => {
            const response = await fetch('/api/blog/index.json');
            if (!response.ok) throw new Error(`Blog index request failed: ${response.status}`);
            const payload = await response.json();
            const perPage = 10;
            const current = Math.max(Math.floor(Number(page) || 1), 1);
            const start = (current - 1) * perPage;
            const items = (payload.data || []).slice(start, start + perPage);
            return {
              success: true,
              data: items,
              meta: { page: current, perPage, total: payload.meta?.count ?? payload.data?.length ?? 0 },
            };
          },
        },
      ];

      tools.forEach(tool => {
        navigator.modelContext.registerTool(tool, { signal: controller.signal });
      });

      window.addEventListener('unload', () => controller.abort());
    }