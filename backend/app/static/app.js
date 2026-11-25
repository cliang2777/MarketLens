import { I18N } from "/static/i18n.js";
import { PALETTE, renderFrontierChart, renderTimeSeriesChart } from "/static/charts.js";

const state = {
  lang: "zh",
  activePage: "asset",
  stratSubtab: "single",
  allocations: [
    { ticker: "AAPL", weight: 50 },
    { ticker: "MSFT", weight: 50 },
  ],
  cacheAsset: null,
  cacheCompare: null,
  cachePortfolio: null,
  cacheStratSingle: null,
  cacheStratOpt: null,
  health: null,
};

function t(path) {
  const parts = path.split(".");
  let cur = I18N[state.lang];
  for (const p of parts) {
    if (cur && p in cur) cur = cur[p];
    else return path;
  }
  return cur;
}

const fmtPct = (v, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "--"
    : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;

const fmtPctUnsigned = (v, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "--"
    : `${(v * 100).toFixed(digits)}%`;

const fmtNum = (v, digits = 4) =>
  v === null || v === undefined || !Number.isFinite(v) ? "--" : v.toFixed(digits);

const fmtWealth = (v) =>
  v === null || v === undefined || !Number.isFinite(v) ? "--" : `${v.toFixed(3)}x`;

const fmtUsd = (v) =>
  v === null || v === undefined || !Number.isFinite(v) ? "--" : `$${v.toFixed(2)}`;

function showError(msg) {
  const el = document.getElementById("global-error");
  if (!msg) {
    el.classList.remove("visible");
    el.textContent = "";
    return;
  }
  el.textContent = `⚠ ${msg}`;
  el.classList.add("visible");
}

async function apiFetch(url, options = {}) {
  showError(null);
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : Array.isArray(data.detail)
        ? data.detail.map((d) => d.msg).join("; ")
        : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  if (data.telemetry) {
    updateQueryTelemetry(data.telemetry);
    refreshHealthSilent();
  }
  return data;
}

function updateQueryTelemetry(tel) {
  const chip = document.getElementById("last-query-telemetry");
  const isLive = tel.liveFetches > 0;
  const modeText = isLive ? t("status.liveFetch") : t("status.cacheHit");
  const dotClass = isLive ? "amber" : "";
  chip.innerHTML = `<span class="led-dot ${dotClass}"></span><span>${modeText} · ${tel.totalElapsedMs.toFixed(1)} ms</span>`;
}

async function refreshHealthSilent() {
  try {
    const h = await fetch("/api/health").then((r) => r.json());
    state.health = h;
    renderHealthBar();
    if (state.activePage === "methodology") {
      renderCacheInventoryTable(h.cache);
    }
  } catch {
    // ignore silent telemetry poll errors
  }
}

function renderHealthBar() {
  const h = state.health;
  if (!h) return;
  const c = h.cache;
  const cacheChip = document.getElementById("cache-summary-chip");
  cacheChip.textContent = `${c.backend.toUpperCase()} · ${c.tickerCount} ${t("status.tickers")} · ${c.totalBars.toLocaleString()} ${t("status.bars")}`;

  const tiingoLed = document.getElementById("tiingo-led");
  const tiingoTxt = document.getElementById("tiingo-status-text");
  if (h.tiingoConfigured) {
    tiingoLed.className = "led-dot";
    tiingoTxt.textContent = t("status.tiingoReady");
  } else {
    tiingoLed.className = "led-dot amber";
    tiingoTxt.textContent = t("status.tiingoMissing");
  }
}

function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
  renderHealthBar();
  if (state.cacheAsset) renderAssetView(state.cacheAsset);
  if (state.cacheCompare && state.activePage === "compare") renderCompareView(state.cacheCompare);
  if (state.cachePortfolio && state.activePage === "portfolio") renderPortfolioView(state.cachePortfolio);
  if (state.cacheStratSingle && state.activePage === "strategy" && state.stratSubtab === "single") {
    renderStratSingleView(state.cacheStratSingle);
  }
  if (state.cacheStratOpt && state.activePage === "strategy" && state.stratSubtab === "optimize") {
    renderStratOptView(state.cacheStratOpt);
  }
  if (state.activePage === "methodology" && state.health) {
    renderCacheInventoryTable(state.health.cache);
  }
}

function kpiCardHtml(label, value, sub, tone = "") {
  return `
    <div class="kpi-plate">
      <div class="kpi-top"><span>${label}</span></div>
      <div class="kpi-value ${tone}">${value}</div>
      <div class="kpi-sub">${sub || "&nbsp;"}</div>
    </div>
  `;
}

/* ==================== 01. SINGLE ASSET ==================== */
async function runAssetAnalysis() {
  const btn = document.getElementById("btn-run-asset");
  btn.disabled = true;
  btn.textContent = t("common.running");
  try {
    const ticker = document.getElementById("asset-ticker").value.trim().toUpperCase();
    const benchmark = document.getElementById("asset-benchmark").value;
    const startDate = document.getElementById("asset-start").value;
    const endDate = document.getElementById("asset-end").value;
    const forceRefresh = document.getElementById("asset-force-refresh").checked;

    const data = await apiFetch("/api/assets/analyze", {
      method: "POST",
      body: JSON.stringify({ ticker, benchmark, startDate, endDate, forceRefresh }),
    });
    document.getElementById("asset-force-refresh").checked = false;
    state.cacheAsset = data;
    renderAssetView(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t("common.runAnalysis");
  }
}

function renderAssetView(data) {
  const s = data.summary;
  const st = data.stats;
  const bc = data.benchmarkComparison;

  const benchSubRet = bc
    ? `vs ${bc.benchmarkTicker} ${fmtPct(bc.benchmarkSummary.totalReturn)}`
    : `${st.observations} ${t("common.observations")}`;
  const benchSubAnn = bc
    ? `Alpha ${fmtPct(bc.annualReturnDifference)}`
    : `${st.firstDate} → ${st.lastDate}`;
  const benchSubVol = bc
    ? `${bc.benchmarkTicker} Vol ${fmtPctUnsigned(bc.benchmarkSummary.annualVolatility)}`
    : "252d Annualized";
  const benchSubSharpe = bc
    ? `${bc.benchmarkTicker} Sharpe ${fmtNum(bc.benchmarkSummary.sharpeRatio, 2)}`
    : "Risk-Adjusted";
  const benchSubDd = bc
    ? `${bc.benchmarkTicker} DD ${fmtPct(bc.benchmarkSummary.maximumDrawdown)}`
    : "Peak-to-Trough";

  let sixthCard = "";
  if (bc) {
    sixthCard = kpiCardHtml(
      `${t("common.beta")} / Corr`,
      `${fmtNum(bc.beta, 2)}`,
      `Corr ${fmtNum(bc.returnCorrelation, 3)} vs ${bc.benchmarkTicker}`,
      "cyan"
    );
  } else {
    sixthCard = kpiCardHtml(
      t("assetPage.positiveDays"),
      fmtPctUnsigned(st.positiveDaysRatio, 1),
      `${st.observations} ${t("common.observations")}`,
      "cyan"
    );
  }

  document.getElementById("asset-kpis").innerHTML = [
    kpiCardHtml(t("common.totalReturn"), fmtPct(s.totalReturn), benchSubRet, s.totalReturn >= 0 ? "pos" : "neg"),
    kpiCardHtml(t("common.annualReturn"), fmtPct(s.annualReturn), benchSubAnn, s.annualReturn >= 0 ? "pos" : "neg"),
    kpiCardHtml(t("common.annualVolatility"), fmtPctUnsigned(s.annualVolatility), benchSubVol, "brass"),
    kpiCardHtml(t("common.sharpeRatio"), fmtNum(s.sharpeRatio, 3), benchSubSharpe, s.sharpeRatio >= 1 ? "pos" : ""),
    kpiCardHtml(t("common.maxDrawdown"), fmtPct(s.maximumDrawdown), benchSubDd, "neg"),
    sixthCard,
  ].join("");

  document.getElementById("asset-span-badge").textContent = `${st.firstDate} → ${st.lastDate} (${st.observations}d)`;

  const dates = data.series.map((p) => p.date);
  const wealthSeries = [
    {
      label: data.ticker,
      values: data.series.map((p) => p.wealthIndex),
      color: "#e6b963",
      area: true,
    },
  ];
  const ddSeries = [
    {
      label: `${data.ticker} DD`,
      values: data.series.map((p) => p.drawdown),
      color: "#f43f5e",
    },
  ];

  if (bc) {
    wealthSeries.push({
      label: bc.benchmarkTicker,
      values: data.series.map((p) => p.benchmarkWealthIndex),
      color: "#4cc9f0",
      dashed: true,
    });
    ddSeries.push({
      label: `${bc.benchmarkTicker} DD`,
      values: data.series.map((p) => p.benchmarkDrawdown),
      color: "#4cc9f0",
      dashed: true,
    });
  }

  renderTimeSeriesChart(document.getElementById("chart-asset-wealth"), {
    dates,
    series: wealthSeries,
    baselineValue: 1.0,
    yFormat: fmtWealth,
  });

  renderTimeSeriesChart(document.getElementById("chart-asset-drawdown"), {
    dates,
    series: ddSeries,
    baselineValue: 0.0,
    fillZeroFloor: true,
    yFormat: (v) => `${(v * 100).toFixed(1)}%`,
  });

  document.getElementById("table-asset-diagnostics").innerHTML = `
    <thead>
      <tr>
        <th>${t("common.metric")}</th>
        <th>${data.ticker}</th>
        <th>${bc ? bc.benchmarkTicker : "REFERENCE"}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${t("common.tradingSpan")}</td>
        <td>${st.firstDate} → ${st.lastDate}</td>
        <td>${st.observations} ${t("common.observations")}</td>
      </tr>
      <tr>
        <td>${t("assetPage.startPrice")} / ${t("assetPage.endPrice")}</td>
        <td>${fmtUsd(st.startAdjClose)} → <span class="val-brass">${fmtUsd(st.endAdjClose)}</span></td>
        <td>Adj. Split &amp; Dividend</td>
      </tr>
      <tr>
        <td>${t("assetPage.positiveDays")}</td>
        <td class="val-pos">${fmtPctUnsigned(st.positiveDaysRatio, 2)}</td>
        <td>Daily Simple Returns &gt; 0</td>
      </tr>
      <tr>
        <td>${t("assetPage.bestDay")}</td>
        <td class="val-pos">${fmtPct(st.bestDayReturn)} (${st.bestDayDate})</td>
        <td>Peak Daily Gain</td>
      </tr>
      <tr>
        <td>${t("assetPage.worstDay")}</td>
        <td class="val-neg">${fmtPct(st.worstDayReturn)} (${st.worstDayDate})</td>
        <td>Worst Daily Drop</td>
      </tr>
      ${
        bc
          ? `<tr>
              <td>${t("common.alphaDiff")} / ${t("common.beta")} / Corr</td>
              <td class="${bc.annualReturnDifference >= 0 ? "val-pos" : "val-neg"}">${fmtPct(bc.annualReturnDifference)}</td>
              <td>Beta ${fmtNum(bc.beta, 4)} · Corr ${fmtNum(bc.returnCorrelation, 4)}</td>
            </tr>`
          : ""
      }
    </tbody>
  `;
}

/* ==================== 02. MULTI-ASSET COMPARISON ==================== */
async function runAssetComparison() {
  const btn = document.getElementById("btn-run-compare");
  btn.disabled = true;
  btn.textContent = t("common.running");
  try {
    const rawTickers = document.getElementById("compare-tickers").value;
    const tickers = rawTickers
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const benchmark = document.getElementById("compare-benchmark").value.trim().toUpperCase();
    const startDate = document.getElementById("compare-start").value;
    const endDate = document.getElementById("compare-end").value;

    const data = await apiFetch("/api/assets/compare", {
      method: "POST",
      body: JSON.stringify({ tickers, benchmark, startDate, endDate }),
    });
    state.cacheCompare = data;
    renderCompareView(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t("common.runAnalysis");
  }
}

function renderCompareView(data) {
  document.getElementById("compare-span-badge").textContent =
    `${data.alignedStartDate} → ${data.alignedEndDate} (${data.observations}d)`;

  const dates = data.timeline.map((r) => r.date);
  const wealthSeries = data.symbols.map((sym, idx) => ({
    label: sym === data.benchmark ? `${sym} (Bench)` : sym,
    values: data.timeline.map((r) => r.wealth[sym]),
    color: PALETTE[idx % PALETTE.length],
    dashed: sym === data.benchmark,
  }));

  const ddSeries = data.symbols.map((sym, idx) => ({
    label: sym,
    values: data.timeline.map((r) => r.drawdown[sym]),
    color: PALETTE[idx % PALETTE.length],
    dashed: sym === data.benchmark,
  }));

  renderTimeSeriesChart(document.getElementById("chart-compare-wealth"), {
    dates,
    series: wealthSeries,
    baselineValue: 1.0,
    yFormat: fmtWealth,
  });

  renderTimeSeriesChart(document.getElementById("chart-compare-drawdown"), {
    dates,
    series: ddSeries,
    baselineValue: 0.0,
    fillZeroFloor: false,
    yFormat: (v) => `${(v * 100).toFixed(1)}%`,
  });

  const rowsHtml = data.assets
    .map(
      (a) => `
      <tr>
        <td class="val-brass">${a.ticker}</td>
        <td class="${a.totalReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(a.totalReturn)}</td>
        <td class="${a.annualReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(a.annualReturn)}</td>
        <td>${fmtPctUnsigned(a.annualVolatility)}</td>
        <td>${fmtNum(a.sharpeRatio, 3)}</td>
        <td class="val-neg">${fmtPct(a.maximumDrawdown)}</td>
        <td class="${a.annualReturnDifference >= 0 ? "val-pos" : "val-neg"}">${fmtPct(a.annualReturnDifference)}</td>
        <td>${fmtNum(a.beta, 3)}</td>
        <td>${fmtNum(a.returnCorrelation, 3)}</td>
      </tr>`
    )
    .join("");

  const b = data.benchmarkSummary;
  const benchRow = `
    <tr style="background: rgba(76, 201, 240, 0.06);">
      <td style="color: var(--cyan); font-weight:700;">${data.benchmark} (BENCH)</td>
      <td class="${b.totalReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(b.totalReturn)}</td>
      <td class="${b.annualReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(b.annualReturn)}</td>
      <td>${fmtPctUnsigned(b.annualVolatility)}</td>
      <td>${fmtNum(b.sharpeRatio, 3)}</td>
      <td class="val-neg">${fmtPct(b.maximumDrawdown)}</td>
      <td>0.00%</td>
      <td>1.000</td>
      <td>1.000</td>
    </tr>
  `;

  document.getElementById("table-compare-summary").innerHTML = `
    <thead>
      <tr>
        <th>Ticker</th>
        <th>${t("common.totalReturn")}</th>
        <th>${t("common.annualReturn")}</th>
        <th>${t("common.annualVolatility")}</th>
        <th>Sharpe</th>
        <th>${t("common.maxDrawdown")}</th>
        <th>Alpha</th>
        <th>Beta</th>
        <th>Corr</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}${benchRow}</tbody>
  `;

  // Render Correlation Heatmap
  const n = data.symbols.length;
  const grid = document.getElementById("compare-corr-matrix");
  let html = `<div class="corr-grid" style="grid-template-columns: 76px repeat(${n}, 1fr);">`;
  html += `<div class="corr-cell corr-hdr">CORR</div>`;
  for (const sym of data.symbols) {
    html += `<div class="corr-cell corr-hdr">${sym}</div>`;
  }
  for (const row of data.correlationMatrix) {
    html += `<div class="corr-cell corr-hdr">${row.ticker}</div>`;
    for (const val of row.values) {
      const alpha = Math.min(0.55, Math.abs(val) * 0.5);
      const bg =
        val >= 0
          ? `rgba(45, 212, 191, ${alpha.toFixed(2)})`
          : `rgba(244, 63, 94, ${alpha.toFixed(2)})`;
      html += `<div class="corr-cell" style="background:${bg}">${val.toFixed(3)}</div>`;
    }
  }
  html += `</div>`;
  grid.innerHTML = html;
}

/* ==================== 03. PORTFOLIO & FRONTIER ==================== */
function renderAllocationControls() {
  const container = document.getElementById("portfolio-alloc-list");
  container.innerHTML = state.allocations
    .map(
      (item, idx) => `
      <div class="alloc-row" data-idx="${idx}">
        <input class="metal-input alloc-ticker-inp" type="text" value="${item.ticker}" data-idx="${idx}" />
        <input class="alloc-slider" type="range" min="1" max="99" step="1" value="${item.weight}" data-idx="${idx}" />
        <input class="metal-input alloc-weight-inp" type="number" min="1" max="99" step="0.5" value="${item.weight}" data-idx="${idx}" />
        <button type="button" class="icon-del-btn" data-idx="${idx}" ${state.allocations.length <= 2 ? "disabled" : ""}>×</button>
      </div>
    `
    )
    .join("");

  updateAllocSumBadge();

  container.querySelectorAll(".alloc-ticker-inp").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      const i = Number(e.target.dataset.idx);
      state.allocations[i].ticker = e.target.value.trim().toUpperCase();
    });
  });

  container.querySelectorAll(".alloc-slider").forEach((sl) => {
    sl.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.idx);
      const val = Number(e.target.value);
      state.allocations[i].weight = val;
      // If 2 assets, auto-balance second asset to 100 - val for effortless dragging!
      if (state.allocations.length === 2) {
        const other = i === 0 ? 1 : 0;
        state.allocations[other].weight = Math.max(1, 100 - val);
        renderAllocationControls();
        return;
      }
      container.querySelector(`.alloc-weight-inp[data-idx="${i}"]`).value = val;
      updateAllocSumBadge();
    });
  });

  container.querySelectorAll(".alloc-weight-inp").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.idx);
      const val = Number(e.target.value) || 0;
      state.allocations[i].weight = val;
      const sl = container.querySelector(`.alloc-slider[data-idx="${i}"]`);
      if (sl) sl.value = Math.min(99, Math.max(1, val));
      updateAllocSumBadge();
    });
  });

  container.querySelectorAll(".icon-del-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const i = Number(e.currentTarget.dataset.idx);
      if (state.allocations.length > 2) {
        state.allocations.splice(i, 1);
        normalizeAllocations();
      }
    });
  });
}

function updateAllocSumBadge() {
  const sum = state.allocations.reduce((acc, a) => acc + Number(a.weight || 0), 0);
  const badge = document.getElementById("alloc-sum-badge");
  const ok = Math.abs(sum - 100) <= 0.05;
  badge.innerHTML = `<span class="led-dot ${ok ? "" : "amber"}"></span><span>SUM: ${sum.toFixed(1)}%</span>`;
}

function normalizeAllocations() {
  const total = state.allocations.reduce((acc, a) => acc + Math.max(0.1, Number(a.weight || 0)), 0);
  let running = 0;
  state.allocations.forEach((a, idx) => {
    if (idx === state.allocations.length - 1) {
      a.weight = Number((100 - running).toFixed(1));
    } else {
      const w = Number(((Math.max(0.1, Number(a.weight || 0)) / total) * 100).toFixed(1));
      a.weight = w;
      running += w;
    }
  });
  renderAllocationControls();
}

async function runPortfolioAnalysis() {
  const btn = document.getElementById("btn-run-portfolio");
  btn.disabled = true;
  btn.textContent = t("common.running");
  try {
    const benchmark = document.getElementById("port-benchmark").value;
    const frontierStep = Number(document.getElementById("port-step").value);
    const startDate = document.getElementById("port-start").value;
    const endDate = document.getElementById("port-end").value;

    const data = await apiFetch("/api/portfolio/analyze", {
      method: "POST",
      body: JSON.stringify({
        allocations: state.allocations,
        benchmark,
        startDate,
        endDate,
        frontierStep,
      }),
    });
    state.cachePortfolio = data;
    renderPortfolioView(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t("common.runAnalysis");
  }
}

function formatWeightMap(weightsObj) {
  return Object.entries(weightsObj)
    .map(([sym, w]) => `${sym} ${(w * 100).toFixed(0)}%`)
    .join(" · ");
}

function renderPortfolioView(data) {
  const s = data.summary;
  const bc = data.benchmarkComparison;
  const fr = data.frontier;

  document.getElementById("port-span-badge").textContent =
    `${data.alignedStartDate} → ${data.alignedEndDate} (${data.observations}d)`;

  document.getElementById("portfolio-kpis").innerHTML = [
    kpiCardHtml(
      t("common.totalReturn"),
      fmtPct(s.totalReturn),
      bc ? `vs ${bc.benchmarkTicker} ${fmtPct(bc.benchmarkSummary.totalReturn)}` : formatWeightMap(data.weights),
      s.totalReturn >= 0 ? "pos" : "neg"
    ),
    kpiCardHtml(
      t("common.annualReturn"),
      fmtPct(s.annualReturn),
      bc ? `Alpha ${fmtPct(bc.annualReturnDifference)}` : "252d Annualized",
      s.annualReturn >= 0 ? "pos" : "neg"
    ),
    kpiCardHtml(t("common.annualVolatility"), fmtPctUnsigned(s.annualVolatility), "Portfolio StdDev", "brass"),
    kpiCardHtml(t("common.sharpeRatio"), fmtNum(s.sharpeRatio, 3), "Risk-Adjusted", "pos"),
    kpiCardHtml(t("common.maxDrawdown"), fmtPct(s.maximumDrawdown), "Portfolio Peak-to-Trough", "neg"),
  ].join("");

  const optCards = [
    { title: `★ ${t("portfolioPage.maxSharpeCard")}`, pt: fr.highestSharpe, metric: `Sharpe ${fr.highestSharpe.sharpeRatio.toFixed(3)}`, tone: "brass" },
    { title: `◆ ${t("portfolioPage.minVolCard")}`, pt: fr.lowestVolatility, metric: `Vol ${fmtPctUnsigned(fr.lowestVolatility.annualVolatility)}`, tone: "cyan" },
    { title: `🛡 ${t("portfolioPage.minDdCard")}`, pt: fr.smallestDrawdown, metric: `Max DD ${fmtPct(fr.smallestDrawdown.maximumDrawdown)}`, tone: "pos" },
  ];

  const optContainer = document.getElementById("portfolio-optimal-cards");
  optContainer.innerHTML = optCards
    .map(
      (c, i) => `
      <div class="kpi-plate">
        <div class="kpi-top">
          <span>${c.title}</span>
          <button type="button" class="steel-chip apply-opt-btn" data-opt-idx="${i}">${t("common.applyWeights")}</button>
        </div>
        <div class="kpi-value ${c.tone}" style="font-size:16px; margin-top:10px;">${formatWeightMap(c.pt.weights)}</div>
        <div class="kpi-sub">${c.metric} · Return ${fmtPct(c.pt.annualReturn)}</div>
      </div>
    `
    )
    .join("");

  optContainer.querySelectorAll(".apply-opt-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const chosen = optCards[Number(e.currentTarget.dataset.optIdx)].pt;
      const entries = Object.entries(chosen.weights).filter(([, w]) => w > 0.001);
      if (entries.length >= 2) {
        state.allocations = entries.map(([sym, w]) => ({
          ticker: sym,
          weight: Number((w * 100).toFixed(1)),
        }));
        normalizeAllocations();
        runPortfolioAnalysis();
      }
    });
  });

  renderFrontierChart(document.getElementById("chart-portfolio-frontier"), {
    points: fr.points,
    isTwoAssetCurve: fr.isTwoAssetCurve,
    highestSharpe: fr.highestSharpe,
    lowestVolatility: fr.lowestVolatility,
    currentPoint: {
      weights: data.weights,
      annualVolatility: s.annualVolatility,
      annualReturn: s.annualReturn,
      sharpeRatio: s.sharpeRatio,
      maximumDrawdown: s.maximumDrawdown,
    },
  });

  const dates = data.series.map((p) => p.date);
  const wSeries = [
    {
      label: "Active Portfolio",
      values: data.series.map((p) => p.wealthIndex),
      color: "#2dd4bf",
      area: true,
      areaTop: "rgba(45, 212, 191, 0.22)",
    },
  ];
  if (bc) {
    wSeries.push({
      label: bc.benchmarkTicker,
      values: data.series.map((p) => p.benchmarkWealthIndex),
      color: "#4cc9f0",
      dashed: true,
    });
  }
  renderTimeSeriesChart(document.getElementById("chart-portfolio-wealth"), {
    dates,
    series: wSeries,
    baselineValue: 1.0,
    yFormat: fmtWealth,
  });

  document.getElementById("table-portfolio-components").innerHTML = `
    <thead>
      <tr>
        <th>Ticker</th>
        <th>Weight</th>
        <th>${t("common.totalReturn")}</th>
        <th>${t("common.annualReturn")}</th>
        <th>${t("common.annualVolatility")}</th>
        <th>Sharpe</th>
        <th>${t("common.maxDrawdown")}</th>
      </tr>
    </thead>
    <tbody>
      ${data.assetBreakdown
        .map(
          (a) => `
          <tr>
            <td class="val-brass">${a.ticker}</td>
            <td>${fmtPctUnsigned(a.weight, 1)}</td>
            <td class="${a.totalReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(a.totalReturn)}</td>
            <td class="${a.annualReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(a.annualReturn)}</td>
            <td>${fmtPctUnsigned(a.annualVolatility)}</td>
            <td>${fmtNum(a.sharpeRatio, 3)}</td>
            <td class="val-neg">${fmtPct(a.maximumDrawdown)}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  `;

  document.getElementById("table-portfolio-sweep").innerHTML = `
    <thead>
      <tr>
        <th>Allocation</th>
        <th>${t("common.annualReturn")}</th>
        <th>${t("common.annualVolatility")}</th>
        <th>Sharpe</th>
        <th>${t("common.maxDrawdown")}</th>
      </tr>
    </thead>
    <tbody>
      ${fr.points
        .map(
          (p) => `
          <tr>
            <td>${formatWeightMap(p.weights)}</td>
            <td class="${p.annualReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(p.annualReturn)}</td>
            <td>${fmtPctUnsigned(p.annualVolatility)}</td>
            <td class="val-brass">${fmtNum(p.sharpeRatio, 4)}</td>
            <td class="val-neg">${fmtPct(p.maximumDrawdown)}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  `;
}

/* ==================== 04. STRATEGY BACKTEST & OOS ==================== */
async function runStrategySingle() {
  const btn = document.getElementById("btn-run-strat");
  btn.disabled = true;
  btn.textContent = t("common.running");
  try {
    const ticker = document.getElementById("strat-ticker").value.trim().toUpperCase();
    const shortWindow = Number(document.getElementById("strat-short").value);
    const longWindow = Number(document.getElementById("strat-long").value);
    const costBps = Number(document.getElementById("strat-cost").value);
    const startDate = document.getElementById("strat-start").value;
    const endDate = document.getElementById("strat-end").value;

    const data = await apiFetch("/api/strategy/backtest", {
      method: "POST",
      body: JSON.stringify({ ticker, shortWindow, longWindow, costBps, startDate, endDate }),
    });
    state.cacheStratSingle = data;
    renderStratSingleView(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t("common.runAnalysis");
  }
}

function renderStratSingleView(data) {
  const st = data.strategySummary;
  const bh = data.buyHoldSummary;
  const ts = data.tradeStats;

  document.getElementById("strat-span-badge").textContent =
    `${data.comparisonStart} → ${data.comparisonEnd} (${data.backtestObservations}d)`;

  document.getElementById("strat-kpis").innerHTML = [
    kpiCardHtml(
      `${t("common.strategy")} ${t("common.totalReturn")}`,
      fmtPct(st.totalReturn),
      `Buy & Hold ${fmtPct(bh.totalReturn)}`,
      st.totalReturn >= 0 ? "pos" : "neg"
    ),
    kpiCardHtml(
      `${t("common.strategy")} ${t("common.annualReturn")}`,
      fmtPct(st.annualReturn),
      `Buy & Hold ${fmtPct(bh.annualReturn)}`,
      st.annualReturn >= 0 ? "pos" : "neg"
    ),
    kpiCardHtml(
      `${t("common.strategy")} Sharpe`,
      fmtNum(st.sharpeRatio, 3),
      `Buy & Hold ${fmtNum(bh.sharpeRatio, 3)}`,
      st.sharpeRatio >= bh.sharpeRatio ? "pos" : "brass"
    ),
    kpiCardHtml(
      `${t("common.strategy")} ${t("common.maxDrawdown")}`,
      fmtPct(st.maximumDrawdown),
      `Buy & Hold ${fmtPct(bh.maximumDrawdown)}`,
      "neg"
    ),
    kpiCardHtml(
      t("strategyPage.totalTrades"),
      `${ts.totalTrades}`,
      `BUY ${ts.buyTrades} / EXIT ${ts.sellTrades} · ${data.costBps} bps`,
      "brass"
    ),
    kpiCardHtml(
      t("strategyPage.exposure"),
      fmtPctUnsigned(ts.exposureRatio, 1),
      `${t("strategyPage.costDrag")} ${fmtPctUnsigned(ts.totalCostDrag, 2)}`,
      "cyan"
    ),
  ].join("");

  // Price + SMA + Execution Markers
  const pDates = data.priceSignalSeries.map((r) => r.date);
  const markers = data.trades.map((tr) => ({
    date: tr.executionDate,
    type: tr.action,
    label: `${tr.action} @ Next Open $${(tr.executionAdjOpen || 0).toFixed(2)}`,
  }));

  renderTimeSeriesChart(document.getElementById("chart-strat-signals"), {
    dates: pDates,
    series: [
      { label: `${data.ticker} AdjClose`, values: data.priceSignalSeries.map((r) => r.adjClose), color: "#cbd5e1", width: 1.5 },
      { label: `SMA ${data.shortWindow}`, values: data.priceSignalSeries.map((r) => r.shortAverage), color: "#e6b963", width: 1.8 },
      { label: `SMA ${data.longWindow}`, values: data.priceSignalSeries.map((r) => r.longAverage), color: "#4cc9f0", width: 1.8 },
    ],
    markers,
    yFormat: fmtUsd,
  });

  // Equity & Drawdown Curves
  const eqDates = data.equitySeries.map((r) => r.date);
  renderTimeSeriesChart(document.getElementById("chart-strat-equity"), {
    dates: eqDates,
    series: [
      { label: `SMA(${data.shortWindow}/${data.longWindow})`, values: data.equitySeries.map((r) => r.strategyWealth), color: "#e6b963", area: true },
      { label: "Buy & Hold", values: data.equitySeries.map((r) => r.buyHoldWealth), color: "#4cc9f0", dashed: true },
    ],
    baselineValue: 1.0,
    yFormat: fmtWealth,
  });

  renderTimeSeriesChart(document.getElementById("chart-strat-drawdown"), {
    dates: eqDates,
    series: [
      { label: "Strategy DD", values: data.equitySeries.map((r) => r.strategyDrawdown), color: "#f43f5e" },
      { label: "Buy & Hold DD", values: data.equitySeries.map((r) => r.buyHoldDrawdown), color: "#4cc9f0", dashed: true },
    ],
    baselineValue: 0.0,
    fillZeroFloor: true,
    yFormat: (v) => `${(v * 100).toFixed(1)}%`,
  });

  document.getElementById("table-strat-trades").innerHTML = `
    <thead>
      <tr>
        <th>${t("strategyPage.signalDate")}</th>
        <th>${t("strategyPage.execDate")}</th>
        <th>${t("strategyPage.action")}</th>
        <th>${t("strategyPage.execPrice")}</th>
        <th>${t("strategyPage.cost")}</th>
      </tr>
    </thead>
    <tbody>
      ${
        data.trades.length
          ? data.trades
              .map(
                (tr) => `
              <tr>
                <td>${tr.signalDate}</td>
                <td>${tr.executionDate}</td>
                <td class="${tr.action === "BUY" ? "val-pos" : "val-neg"}">${tr.action === "BUY" ? "▲ BUY (100%)" : "▼ EXIT (CASH)"}</td>
                <td>${fmtUsd(tr.executionAdjOpen)}</td>
                <td>${(tr.transactionCost * 10000).toFixed(1)} bps</td>
              </tr>`
              )
              .join("")
          : `<tr><td colspan="5" style="text-align:center; color:var(--steel-400);">No position changes triggered in this window.</td></tr>`
      }
    </tbody>
  `;
}

async function runStrategyOptimize() {
  const btn = document.getElementById("btn-run-opt");
  btn.disabled = true;
  btn.textContent = t("common.running");
  try {
    const ticker = document.getElementById("opt-ticker").value.trim().toUpperCase();
    const shortWindows = document
      .getElementById("opt-shorts")
      .value.split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    const longWindows = document
      .getElementById("opt-longs")
      .value.split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    const trainRatio = Number(document.getElementById("opt-train-ratio").value);
    const costBps = Number(document.getElementById("opt-cost").value);
    const startDate = document.getElementById("opt-start").value;
    const endDate = document.getElementById("opt-end").value;

    const data = await apiFetch("/api/strategy/optimize", {
      method: "POST",
      body: JSON.stringify({
        ticker,
        shortWindows,
        longWindows,
        trainRatio,
        costBps,
        startDate,
        endDate,
      }),
    });
    state.cacheStratOpt = data;
    renderStratOptView(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t("common.runAnalysis");
  }
}

function renderStratOptView(data) {
  const oos = data.outOfSampleValidation;
  const grid = data.parameterComparison;
  const oosSt = oos.testingStrategySummary;
  const oosBh = oos.testingBuyHoldSummary;

  document.getElementById("opt-oos-span").textContent = `${oos.testingStart} → ${oos.testingEnd}`;
  document.getElementById("opt-grid-span").textContent = `${grid.comparisonStart} → ${grid.comparisonEnd}`;

  document.getElementById("opt-oos-kpis").innerHTML = [
    kpiCardHtml(
      t("strategyPage.inSampleBest"),
      `SMA ${oos.selectedShortWindow}/${oos.selectedLongWindow}`,
      `Train Sharpe ${fmtNum(oos.bestTrainingResult.sharpeRatio, 3)}`,
      "brass"
    ),
    kpiCardHtml(
      `OOS ${t("common.strategy")} Return`,
      fmtPct(oosSt.totalReturn),
      `Annualized ${fmtPct(oosSt.annualReturn)}`,
      oosSt.totalReturn >= 0 ? "pos" : "neg"
    ),
    kpiCardHtml(
      `OOS ${t("common.buyHold")} Return`,
      fmtPct(oosBh.totalReturn),
      `Annualized ${fmtPct(oosBh.annualReturn)}`,
      oosBh.totalReturn >= 0 ? "cyan" : "neg"
    ),
    kpiCardHtml(
      "OOS Sharpe Ratio",
      fmtNum(oosSt.sharpeRatio, 3),
      `Buy & Hold ${fmtNum(oosBh.sharpeRatio, 3)}`,
      oosSt.sharpeRatio >= oosBh.sharpeRatio ? "pos" : ""
    ),
    kpiCardHtml(
      "OOS Max Drawdown",
      fmtPct(oosSt.maximumDrawdown),
      `Buy & Hold ${fmtPct(oosBh.maximumDrawdown)}`,
      "neg"
    ),
  ].join("");

  const oosDates = oos.testingSeries.map((p) => p.date);
  renderTimeSeriesChart(document.getElementById("chart-opt-oos"), {
    dates: oosDates,
    series: [
      {
        label: `OOS SMA(${oos.selectedShortWindow}/${oos.selectedLongWindow})`,
        values: oos.testingSeries.map((p) => p.strategyWealth),
        color: "#e6b963",
        area: true,
      },
      {
        label: "OOS Buy & Hold",
        values: oos.testingSeries.map((p) => p.buyHoldWealth),
        color: "#4cc9f0",
        dashed: true,
      },
    ],
    baselineValue: 1.0,
    yFormat: fmtWealth,
  });

  document.getElementById("table-opt-oos").innerHTML = `
    <thead>
      <tr>
        <th>${t("common.metric")}</th>
        <th>OOS ${t("common.strategy")} (${oos.selectedShortWindow}/${oos.selectedLongWindow})</th>
        <th>OOS ${t("common.buyHold")}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${t("strategyPage.trainSpan")}</td>
        <td colspan="2">${oos.trainingStart} → ${oos.trainingEnd} (${oos.trainingObservations}d, ${(oos.trainRatio * 100).toFixed(0)}%)</td>
      </tr>
      <tr>
        <td>${t("strategyPage.testSpan")}</td>
        <td colspan="2">${oos.testingStart} → ${oos.testingEnd} (${oos.testingObservations}d, Out-of-Sample)</td>
      </tr>
      <tr>
        <td>${t("common.totalReturn")}</td>
        <td class="${oosSt.totalReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(oosSt.totalReturn)}</td>
        <td class="${oosBh.totalReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(oosBh.totalReturn)}</td>
      </tr>
      <tr>
        <td>${t("common.annualReturn")}</td>
        <td class="${oosSt.annualReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(oosSt.annualReturn)}</td>
        <td class="${oosBh.annualReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(oosBh.annualReturn)}</td>
      </tr>
      <tr>
        <td>${t("common.annualVolatility")}</td>
        <td>${fmtPctUnsigned(oosSt.annualVolatility)}</td>
        <td>${fmtPctUnsigned(oosBh.annualVolatility)}</td>
      </tr>
      <tr>
        <td>${t("common.sharpeRatio")}</td>
        <td class="val-brass">${fmtNum(oosSt.sharpeRatio, 4)}</td>
        <td>${fmtNum(oosBh.sharpeRatio, 4)}</td>
      </tr>
      <tr>
        <td>${t("common.maxDrawdown")}</td>
        <td class="val-neg">${fmtPct(oosSt.maximumDrawdown)}</td>
        <td class="val-neg">${fmtPct(oosBh.maximumDrawdown)}</td>
      </tr>
      <tr>
        <td>OOS Trades</td>
        <td>${oos.testingTrades}</td>
        <td>1 (Initial Entry)</td>
      </tr>
    </tbody>
  `;

  const gridTable = document.getElementById("table-opt-grid");
  gridTable.innerHTML = `
    <thead>
      <tr>
        <th>Rank / Windows</th>
        <th>${t("common.totalReturn")}</th>
        <th>${t("common.annualReturn")}</th>
        <th>${t("common.annualVolatility")}</th>
        <th>Sharpe</th>
        <th>${t("common.maxDrawdown")}</th>
        <th>Trades</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>
      ${grid.results
        .map(
          (r, idx) => `
          <tr>
            <td class="val-brass">#${idx + 1} · SMA ${r.shortWindow} / ${r.longWindow}</td>
            <td class="${r.totalReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(r.totalReturn)}</td>
            <td class="${r.annualReturn >= 0 ? "val-pos" : "val-neg"}">${fmtPct(r.annualReturn)}</td>
            <td>${fmtPctUnsigned(r.annualVolatility)}</td>
            <td class="val-brass">${fmtNum(r.sharpeRatio, 4)}</td>
            <td class="val-neg">${fmtPct(r.maximumDrawdown)}</td>
            <td>${r.totalTrades}</td>
            <td>
              <button type="button" class="steel-chip load-bt-btn" data-short="${r.shortWindow}" data-long="${r.longWindow}">
                ${t("common.loadBacktest")}
              </button>
            </td>
          </tr>`
        )
        .join("")}
    </tbody>
  `;

  gridTable.querySelectorAll(".load-bt-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const sw = e.currentTarget.dataset.short;
      const lw = e.currentTarget.dataset.long;
      document.getElementById("strat-ticker").value = data.ticker;
      document.getElementById("strat-short").value = sw;
      document.getElementById("strat-long").value = lw;
      document.getElementById("strat-cost").value = data.costBps;
      document.getElementById("strat-start").value = document.getElementById("opt-start").value;
      document.getElementById("strat-end").value = document.getElementById("opt-end").value;
      switchStratSubtab("single");
      runStrategySingle();
    });
  });
}

/* ==================== 05. METHODOLOGY & CACHE ==================== */
function renderCacheInventoryTable(cache) {
  const tbl = document.getElementById("table-cache-inventory");
  if (!cache || !cache.tickers) return;
  tbl.innerHTML = `
    <thead>
      <tr>
        <th>Ticker</th>
        <th>First Cached Bar</th>
        <th>Last Cached Bar</th>
        <th>Cached Daily Bars</th>
        <th>Storage Engine</th>
      </tr>
    </thead>
    <tbody>
      ${
        cache.tickers.length
          ? cache.tickers
              .map(
                (item) => `
              <tr>
                <td class="val-brass">${item.ticker}</td>
                <td>${item.firstDate}</td>
                <td>${item.lastDate}</td>
                <td class="val-pos">${item.bars.toLocaleString()}</td>
                <td>${cache.backend.toUpperCase()}</td>
              </tr>`
              )
              .join("")
          : `<tr><td colspan="5" style="text-align:center;">Cache is empty.</td></tr>`
      }
    </tbody>
  `;
}

/* ==================== NAVIGATION & EVENTS ==================== */
function switchPage(page) {
  state.activePage = page;
  showError(null);
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.page === page);
  });
  document.querySelectorAll(".page-view").forEach((sec) => {
    sec.classList.toggle("active", sec.id === `page-${page}`);
  });

  if (page === "asset") {
    if (state.cacheAsset) renderAssetView(state.cacheAsset);
    else runAssetAnalysis();
  } else if (page === "compare") {
    if (state.cacheCompare) renderCompareView(state.cacheCompare);
    else runAssetComparison();
  } else if (page === "portfolio") {
    if (state.cachePortfolio) renderPortfolioView(state.cachePortfolio);
    else runPortfolioAnalysis();
  } else if (page === "strategy") {
    if (state.stratSubtab === "single") {
      if (state.cacheStratSingle) renderStratSingleView(state.cacheStratSingle);
      else runStrategySingle();
    } else if (state.cacheStratOpt) {
      renderStratOptView(state.cacheStratOpt);
    } else {
      runStrategyOptimize();
    }
  } else if (page === "methodology") {
    refreshHealthSilent();
  }
}

function switchStratSubtab(sub) {
  state.stratSubtab = sub;
  document.querySelectorAll(".subtab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.subtab === sub);
  });
  document.getElementById("strat-sub-single").style.display = sub === "single" ? "block" : "none";
  document.getElementById("strat-sub-optimize").style.display = sub === "optimize" ? "block" : "none";

  if (sub === "single") {
    if (state.cacheStratSingle) renderStratSingleView(state.cacheStratSingle);
    else runStrategySingle();
  } else {
    if (state.cacheStratOpt) renderStratOptView(state.cacheStratOpt);
    else runStrategyOptimize();
  }
}

function initEvents() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchPage(btn.dataset.page));
  });

  document.querySelectorAll(".lang-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.lang = btn.dataset.lang;
      document.querySelectorAll(".lang-opt").forEach((b) =>
        b.classList.toggle("active", b.dataset.lang === state.lang)
      );
      applyStaticI18n();
    });
  });

  document.querySelectorAll(".subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchStratSubtab(btn.dataset.subtab));
  });

  // Asset form & quick presets
  document.getElementById("form-asset").addEventListener("submit", (e) => {
    e.preventDefault();
    runAssetAnalysis();
  });

  document.querySelectorAll(".asset-quick-ticker").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("asset-ticker").value = chip.dataset.ticker;
      runAssetAnalysis();
    });
  });

  document.querySelectorAll(".date-preset").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("asset-start").value = chip.dataset.start;
      document.getElementById("asset-end").value = chip.dataset.end;
      runAssetAnalysis();
    });
  });

  // Compare form & presets
  document.getElementById("form-compare").addEventListener("submit", (e) => {
    e.preventDefault();
    runAssetComparison();
  });

  document.querySelectorAll(".compare-preset").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("compare-tickers").value = chip.dataset.tickers;
      document.getElementById("compare-benchmark").value = chip.dataset.bench;
      runAssetComparison();
    });
  });

  // Portfolio controls
  renderAllocationControls();
  document.getElementById("btn-add-alloc").addEventListener("click", () => {
    if (state.allocations.length >= 5) return;
    const candidates = ["SPY", "QQQ", "NVDA", "GOOGL", "AMZN"];
    const used = new Set(state.allocations.map((a) => a.ticker));
    const nextSym = candidates.find((c) => !used.has(c)) || "SPY";
    state.allocations.push({ ticker: nextSym, weight: 20 });
    normalizeAllocations();
  });
  document.getElementById("btn-equal-alloc").addEventListener("click", () => {
    state.allocations.forEach((a) => {
      a.weight = 100 / state.allocations.length;
    });
    normalizeAllocations();
  });
  document.getElementById("btn-norm-alloc").addEventListener("click", normalizeAllocations);
  document.getElementById("form-portfolio").addEventListener("submit", (e) => {
    e.preventDefault();
    runPortfolioAnalysis();
  });

  // Strategy forms
  document.getElementById("form-strat-single").addEventListener("submit", (e) => {
    e.preventDefault();
    runStrategySingle();
  });
  document.getElementById("form-strat-opt").addEventListener("submit", (e) => {
    e.preventDefault();
    runStrategyOptimize();
  });

  // Cache management
  document.getElementById("btn-refresh-cache").addEventListener("click", () => refreshHealthSilent());
  document.getElementById("btn-clear-cache").addEventListener("click", async () => {
    try {
      const res = await apiFetch("/api/cache?reseed=true", { method: "DELETE" });
      state.health = { ...state.health, cache: res.cache };
      renderHealthBar();
      renderCacheInventoryTable(res.cache);
    } catch (err) {
      showError(err.message);
    }
  });
}

async function boot() {
  initEvents();
  applyStaticI18n();
  await refreshHealthSilent();
  await runAssetAnalysis();
}

boot();
