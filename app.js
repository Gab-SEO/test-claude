(function () {
  'use strict';

  const PAGESPEED_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const HISTORY_KEY = 'cwv_history';
  const MAX_HISTORY = 50;

  // Google's Core Web Vitals thresholds
  const THRESHOLDS = {
    LCP: { good: 2500, poor: 4000, unit: 'ms', label: 'Largest Contentful Paint' },
    FID: { good: 100, poor: 300, unit: 'ms', label: 'First Input Delay' },
    CLS: { good: 0.1, poor: 0.25, unit: '', label: 'Cumulative Layout Shift' },
    TTFB: { good: 800, poor: 1800, unit: 'ms', label: 'Time to First Byte' },
    FCP: { good: 1800, poor: 3000, unit: 'ms', label: 'First Contentful Paint' },
    INP: { good: 200, poor: 500, unit: 'ms', label: 'Interaction to Next Paint' },
  };

  // DOM references
  const urlForm = document.getElementById('url-form');
  const urlInput = document.getElementById('url-input');
  const strategySelect = document.getElementById('strategy-select');
  const apiKeyInput = document.getElementById('api-key-input');
  const analyzeBtn = document.getElementById('analyze-btn');
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error-msg');
  const resultsSection = document.getElementById('results-section');
  const comparisonGrid = document.getElementById('comparison-grid');
  const clearResultsBtn = document.getElementById('clear-results-btn');
  const historyList = document.getElementById('history-list');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const exportHistoryBtn = document.getElementById('export-history-btn');

  let currentResults = [];

  // --- API ---

  async function fetchPageSpeedData(url, strategy) {
    const apiKey = apiKeyInput.value.trim();
    const params = new URLSearchParams({
      url: url,
      strategy: strategy,
      category: 'performance',
    });
    if (apiKey) {
      params.set('key', apiKey);
    }

    const response = await fetch(`${PAGESPEED_API}?${params}`);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const msg = body?.error?.message || `Erreur HTTP ${response.status}`;
      throw new Error(msg);
    }
    return response.json();
  }

  function extractMetrics(data) {
    const crux = data.loadingExperience?.metrics || {};
    const audits = data.lighthouseResult?.audits || {};
    const score = data.lighthouseResult?.categories?.performance?.score;

    function cruxVal(key) {
      return crux[key]?.percentile ?? null;
    }

    // Prefer CrUX field data; fall back to Lighthouse lab data
    const lcp = cruxVal('LARGEST_CONTENTFUL_PAINT_MS') ?? numericAudit(audits, 'largest-contentful-paint');
    const fid = cruxVal('FIRST_INPUT_DELAY_MS') ?? null;
    const cls = crux['CUMULATIVE_LAYOUT_SHIFT_SCORE']?.percentile != null
      ? crux['CUMULATIVE_LAYOUT_SHIFT_SCORE'].percentile / 100
      : numericAudit(audits, 'cumulative-layout-shift');
    const fcp = cruxVal('FIRST_CONTENTFUL_PAINT_MS') ?? numericAudit(audits, 'first-contentful-paint');
    const inp = cruxVal('INTERACTION_TO_NEXT_PAINT') ?? cruxVal('EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT') ?? null;
    const ttfb = cruxVal('EXPERIMENTAL_TIME_TO_FIRST_BYTE') ?? numericAudit(audits, 'server-response-time');

    return {
      score: score != null ? Math.round(score * 100) : null,
      LCP: lcp,
      FID: fid,
      CLS: cls,
      TTFB: ttfb,
      FCP: fcp,
      INP: inp,
    };
  }

  function numericAudit(audits, id) {
    const val = audits[id]?.numericValue;
    return val != null ? Math.round(val) : null;
  }

  // --- Rating ---

  function getRating(metric, value) {
    if (value == null) return 'na';
    const t = THRESHOLDS[metric];
    if (!t) return 'na';
    if (value <= t.good) return 'good';
    if (value <= t.poor) return 'needs-improvement';
    return 'poor';
  }

  function getScoreRating(score) {
    if (score == null) return 'na';
    if (score >= 90) return 'good';
    if (score >= 50) return 'needs-improvement';
    return 'poor';
  }

  function formatValue(metric, value) {
    if (value == null) return 'N/A';
    const t = THRESHOLDS[metric];
    if (!t) return String(value);
    if (metric === 'CLS') return value.toFixed(3);
    if (t.unit === 'ms' && value >= 1000) return (value / 1000).toFixed(2) + ' s';
    return Math.round(value) + ' ' + t.unit;
  }

  // --- UI ---

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    setTimeout(() => errorEl.classList.add('hidden'), 6000);
  }

  function setLoading(on) {
    loadingEl.classList.toggle('hidden', !on);
    analyzeBtn.disabled = on;
  }

  function renderResults() {
    resultsSection.classList.toggle('hidden', currentResults.length === 0);
    comparisonGrid.innerHTML = '';

    currentResults.forEach((result, index) => {
      const card = document.createElement('div');
      card.className = 'site-card';

      const scoreRating = getScoreRating(result.metrics.score);

      let metricsHTML = '';
      for (const key of ['LCP', 'FID', 'CLS', 'TTFB', 'FCP', 'INP']) {
        const val = result.metrics[key];
        const rating = getRating(key, val);
        metricsHTML += `
          <div class="metric-tile" title="${THRESHOLDS[key].label}">
            <div class="metric-name">${key}</div>
            <div class="metric-value ${rating}">${formatValue(key, val)}</div>
          </div>`;
      }

      card.innerHTML = `
        <button class="remove-btn" data-index="${index}" title="Retirer">&times;</button>
        <div class="card-header">
          <span class="site-url">${escapeHTML(result.url)}</span>
          <span class="strategy-badge">${result.strategy}</span>
        </div>
        <div class="overall-score">
          <div class="score-circle ${scoreRating}">
            ${result.metrics.score != null ? result.metrics.score : '?'}
          </div>
          <span class="score-label">Score Performance</span>
        </div>
        <div class="metrics-grid">${metricsHTML}</div>`;

      comparisonGrid.appendChild(card);
    });

    // Wire remove buttons
    comparisonGrid.querySelectorAll('.remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        currentResults.splice(idx, 1);
        renderResults();
      });
    });
  }

  // --- History ---

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveToHistory(entry) {
    const history = getHistory();
    history.unshift(entry);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    const history = getHistory();
    if (history.length === 0) {
      historyList.innerHTML = '<p class="empty-state">Aucune analyse enregistree.</p>';
      return;
    }

    historyList.innerHTML = history
      .map((h) => {
        const scoreRating = getScoreRating(h.score);
        const date = new Date(h.date).toLocaleString('fr-FR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
        return `
          <div class="history-item" data-url="${escapeAttr(h.url)}" data-strategy="${h.strategy}">
            <span class="history-score ${scoreRating}">${h.score ?? '?'}</span>
            <span class="history-url">${escapeHTML(h.url)}</span>
            <span class="history-strategy">${h.strategy}</span>
            <span class="history-date">${date}</span>
          </div>`;
      })
      .join('');

    // Click to re-analyse
    historyList.querySelectorAll('.history-item').forEach((item) => {
      item.addEventListener('click', () => {
        urlInput.value = item.dataset.url;
        strategySelect.value = item.dataset.strategy;
        urlForm.dispatchEvent(new Event('submit'));
      });
    });
  }

  function exportHistoryCSV() {
    const history = getHistory();
    if (history.length === 0) return;

    const headers = ['Date', 'URL', 'Strategy', 'Score', 'LCP', 'FID', 'CLS', 'TTFB', 'FCP', 'INP'];
    const rows = history.map((h) => [
      new Date(h.date).toISOString(),
      h.url,
      h.strategy,
      h.score ?? '',
      h.LCP ?? '',
      h.FID ?? '',
      h.CLS ?? '',
      h.TTFB ?? '',
      h.FCP ?? '',
      h.INP ?? '',
    ]);

    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `web-vitals-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // --- Helpers ---

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  // --- Event handlers ---

  urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');

    const url = urlInput.value.trim();
    const strategy = strategySelect.value;
    if (!url) return;

    setLoading(true);
    try {
      const data = await fetchPageSpeedData(url, strategy);
      const metrics = extractMetrics(data);

      const result = { url, strategy, metrics, date: new Date().toISOString() };
      currentResults.push(result);
      renderResults();

      saveToHistory({
        url,
        strategy,
        score: metrics.score,
        LCP: metrics.LCP,
        FID: metrics.FID,
        CLS: metrics.CLS,
        TTFB: metrics.TTFB,
        FCP: metrics.FCP,
        INP: metrics.INP,
        date: result.date,
      });

      urlInput.value = '';
    } catch (err) {
      showError(err.message || 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  });

  clearResultsBtn.addEventListener('click', () => {
    currentResults = [];
    renderResults();
  });

  clearHistoryBtn.addEventListener('click', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });

  exportHistoryBtn.addEventListener('click', exportHistoryCSV);

  // Init
  renderHistory();
})();
