/**
 * Precision High-DPI Metallic Financial Chart Engine
 * Supports multi-series lines, logarithmic scale, OHLC candlesticks + volume,
 * Risk-Return efficient frontier, laser crosshairs, HUD tooltips, and PNG export.
 */

const PALETTE = [
  "#e6b963", // Champagne Brass
  "#4cc9f0", // Tungsten Cyan
  "#2dd4bf", // Anodized Emerald
  "#a78bfa", // Titanium Violet
  "#fb923c", // Forged Copper
  "#f43f5e", // Oxide Crimson
  "#94a3b8", // Brushed Steel
];

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(rect.width, 280);
  const height = Math.max(rect.height, 220);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function ensureTooltip(wrapper) {
  let tip = wrapper.querySelector(".chart-hud-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-hud-tooltip";
    wrapper.appendChild(tip);
  }
  return tip;
}

function niceBounds(minVal, maxVal, padFraction = 0.08) {
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
    return { min: 0, max: 1 };
  }
  if (Math.abs(maxVal - minVal) < 1e-9) {
    const delta = Math.abs(minVal) * 0.05 || 0.1;
    return { min: minVal - delta, max: maxVal + delta };
  }
  const span = maxVal - minVal;
  return {
    min: minVal - span * padFraction,
    max: maxVal + span * padFraction,
  };
}

function fmtVolCompact(v) {
  if (!Number.isFinite(v)) return "--";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

/**
 * Exports any live Canvas chart as a crisp dark-gunmetal PNG file.
 */
export function exportCanvasPng(canvas, filename = "alphametric-chart.png") {
  if (!canvas || !canvas.width || !canvas.height) return;
  const off = document.createElement("canvas");
  off.width = canvas.width;
  off.height = canvas.height;
  const ctx = off.getContext("2d");
  ctx.fillStyle = "#090c11";
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(canvas, 0, 0);
  const link = document.createElement("a");
  link.download = filename;
  link.href = off.toDataURL("image/png");
  link.click();
}

/**
 * Renders an interactive multi-series financial time-series chart (LIN or LOG).
 */
export function renderTimeSeriesChart(canvas, config) {
  const wrapper = canvas.parentElement;
  wrapper.style.position = "relative";
  const tip = ensureTooltip(wrapper);

  const {
    dates = [],
    series = [],
    yFormat = (v) => v.toFixed(2),
    baselineValue = null,
    fillZeroFloor = false,
    logScale = false,
    markers = [],
  } = config;

  let hoverIdx = null;
  const useLog = Boolean(logScale) && !fillZeroFloor;

  const transformY = (v) => (useLog ? Math.log(v) : v);
  const invertY = (t) => (useLog ? Math.exp(t) : t);
  const isValidVal = (v) =>
    v !== null && v !== undefined && Number.isFinite(v) && (!useLog || v > 0);

  const markerByIndex = new Map();
  if (markers.length && dates.length) {
    const dateIdx = new Map(dates.map((d, i) => [d, i]));
    for (const m of markers) {
      const i = dateIdx.get(m.date);
      if (i !== undefined) {
        if (!markerByIndex.has(i)) markerByIndex.set(i, []);
        markerByIndex.get(i).push(m);
      }
    }
  }

  function draw() {
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);

    if (!dates.length || !series.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("NO DATA SERIES LOADED", width / 2, height / 2);
      return;
    }

    const pad = { top: 28, right: 18, bottom: 28, left: 66 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    let rawMin = Infinity;
    let rawMax = -Infinity;
    for (const s of series) {
      for (const v of s.values) {
        if (isValidVal(v)) {
          const tv = transformY(v);
          if (tv < rawMin) rawMin = tv;
          if (tv > rawMax) rawMax = tv;
        }
      }
    }
    if (baselineValue !== null && isValidVal(baselineValue)) {
      const tb = transformY(baselineValue);
      rawMin = Math.min(rawMin, tb);
      rawMax = Math.max(rawMax, tb);
    }
    if (fillZeroFloor) {
      rawMax = Math.max(rawMax, 0);
    }

    const bounds = niceBounds(rawMin, rawMax, 0.07);
    if (fillZeroFloor && bounds.max > 0) {
      bounds.max = Math.min(bounds.max, (bounds.max - bounds.min) * 0.04);
    }

    const xAt = (i) =>
      dates.length === 1
        ? pad.left + plotW / 2
        : pad.left + (i / (dates.length - 1)) * plotW;
    const yAt = (v) =>
      pad.top + (1 - (transformY(v) - bounds.min) / (bounds.max - bounds.min)) * plotH;

    // Horizontal etched grid lines + Y labels
    const yTicks = 5;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let t = 0; t <= yTicks; t++) {
      const tVal = bounds.min + ((bounds.max - bounds.min) * t) / yTicks;
      const realVal = invertY(tVal);
      const y = pad.top + (1 - t / yTicks) * plotH;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = "#8a99ad";
      ctx.fillText(yFormat(realVal), pad.left - 8, y);
    }

    // Baseline dashed reference
    if (baselineValue !== null && isValidVal(baselineValue)) {
      const tb = transformY(baselineValue);
      if (tb >= bounds.min && tb <= bounds.max) {
        const by = yAt(baselineValue);
        ctx.save();
        ctx.strokeStyle = "rgba(230, 185, 99, 0.35)";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, by);
        ctx.lineTo(width - pad.right, by);
        ctx.stroke();
        ctx.restore();
      }
    }

    // X-axis date ticks (adaptive density so mobile screens never overlap labels)
    const compactDate = plotW < 380;
    const minTickPx = compactDate ? 78 : 96;
    const xTickCount = Math.max(2, Math.min(6, Math.floor(plotW / minTickPx), dates.length));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#7c8b9e";
    for (let k = 0; k < xTickCount; k++) {
      const idx =
        xTickCount === 1
          ? 0
          : Math.round((k * (dates.length - 1)) / (xTickCount - 1));
      const label = compactDate ? dates[idx].slice(0, 7) : dates[idx];
      ctx.fillText(label, xAt(idx), pad.top + plotH + 8);
    }

    // Legend bar
    let legendX = pad.left;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    series.forEach((s, idx) => {
      const color = s.color || PALETTE[idx % PALETTE.length];
      ctx.fillStyle = color;
      ctx.fillRect(legendX, 10, 10, 3);
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText(s.label, legendX + 14, 11.5);
      legendX += ctx.measureText(s.label).width + 28;
    });

    if (useLog) {
      ctx.fillStyle = "#e6b963";
      ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "right";
      ctx.fillText("LOG SCALE", width - pad.right, 11.5);
    }

    // Draw series
    series.forEach((s, idx) => {
      const color = s.color || PALETTE[idx % PALETTE.length];
      const pts = [];
      for (let i = 0; i < dates.length; i++) {
        const v = s.values[i];
        if (isValidVal(v)) {
          pts.push({ x: xAt(i), y: yAt(v), v, i });
        }
      }
      if (!pts.length) return;

      if (s.area || fillZeroFloor) {
        const refY = fillZeroFloor ? yAt(0) : pad.top + plotH;
        const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
        if (fillZeroFloor) {
          grad.addColorStop(0, "rgba(244, 63, 94, 0.04)");
          grad.addColorStop(1, "rgba(244, 63, 94, 0.34)");
        } else {
          grad.addColorStop(0, s.areaTop || "rgba(230, 185, 99, 0.24)");
          grad.addColorStop(1, "rgba(230, 185, 99, 0.0)");
        }
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, refY);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.lineTo(pts[pts.length - 1].x, refY);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = s.width || (idx === 0 ? 2.0 : 1.5);
      if (s.dashed) ctx.setLineDash([5, 4]);
      ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach((p, j) => {
        if (j === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.restore();
    });

    // Trade markers
    if (markerByIndex.size > 0 && series[0]) {
      for (const [idx, mList] of markerByIndex.entries()) {
        const baseVal = series[0].values[idx];
        if (!isValidVal(baseVal)) continue;
        const x = xAt(idx);
        const y = yAt(baseVal);
        for (const m of mList) {
          const isBuy = m.type === "BUY";
          ctx.save();
          ctx.fillStyle = isBuy ? "#2dd4bf" : "#f43f5e";
          ctx.strokeStyle = "#090b0f";
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (isBuy) {
            ctx.moveTo(x, y - 3);
            ctx.lineTo(x - 5, y + 6);
            ctx.lineTo(x + 5, y + 6);
          } else {
            ctx.moveTo(x, y + 3);
            ctx.lineTo(x - 5, y - 6);
            ctx.lineTo(x + 5, y - 6);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Crosshair
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < dates.length) {
      const cx = xAt(hoverIdx);
      ctx.save();
      ctx.strokeStyle = "rgba(226, 232, 240, 0.35)";
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, pad.top);
      ctx.lineTo(cx, pad.top + plotH);
      ctx.stroke();
      ctx.restore();

      series.forEach((s, idx) => {
        const v = s.values[hoverIdx];
        if (!isValidVal(v)) return;
        const cy = yAt(v);
        const color = s.color || PALETTE[idx % PALETTE.length];
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#090b0f";
        ctx.stroke();
      });
    }
  }

  function onMove(ev) {
    if (!dates.length) return;
    const rect = canvas.getBoundingClientRect();
    const padLeft = 66;
    const padRight = 18;
    const plotW = rect.width - padLeft - padRight;
    const relX = Math.max(0, Math.min(plotW, ev.clientX - rect.left - padLeft));
    const idx =
      dates.length === 1
        ? 0
        : Math.round((relX / Math.max(plotW, 1)) * (dates.length - 1));

    hoverIdx = idx;
    draw();

    const rowsHtml = series
      .map((s, sIdx) => {
        const val = s.values[idx];
        if (val === null || val === undefined || !Number.isFinite(val)) return "";
        const color = s.color || PALETTE[sIdx % PALETTE.length];
        return `<div class="hud-row">
          <span class="hud-dot" style="background:${color}"></span>
          <span class="hud-lbl">${s.label}</span>
          <span class="hud-val">${yFormat(val)}</span>
        </div>`;
      })
      .join("");

    const mList = markerByIndex.get(idx) || [];
    const markerHtml = mList
      .map(
        (m) =>
          `<div class="hud-badge ${m.type === "BUY" ? "pos" : "neg"}">${m.label || m.type}</div>`
      )
      .join("");

    tip.innerHTML = `<div class="hud-date">${dates[idx]}</div>${rowsHtml}${markerHtml}`;
    tip.style.opacity = "1";

    const tipW = tip.offsetWidth || 180;
    const leftPos =
      ev.clientX - rect.left + 16 + tipW > rect.width
        ? Math.max(8, ev.clientX - rect.left - tipW - 14)
        : ev.clientX - rect.left + 14;
    tip.style.left = `${leftPos}px`;
    tip.style.top = `${Math.max(24, ev.clientY - rect.top - 18)}px`;
  }

  function onLeave() {
    hoverIdx = null;
    tip.style.opacity = "0";
    draw();
  }

  if (canvas._cleanup) canvas._cleanup();
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);
  const ro = new ResizeObserver(() => draw());
  ro.observe(wrapper);

  canvas._cleanup = () => {
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mouseleave", onLeave);
    ro.disconnect();
  };

  draw();
}

/**
 * Aggregates daily OHLCV bars into weekly candles when > 260 bars so candlesticks stay crisp.
 */
function aggregateBarsIfNeeded(rawBars) {
  if (rawBars.length <= 260) {
    return { bars: rawBars, timeframe: "DAILY" };
  }
  const buckets = new Map();
  for (const b of rawBars) {
    const dt = new Date(`${b.date}T00:00:00Z`);
    const day = dt.getUTCDay();
    const diffToMon = (day + 6) % 7;
    const mon = new Date(dt.getTime() - diffToMon * 86400000);
    const key = mon.toISOString().slice(0, 10);
    if (!buckets.has(key)) {
      buckets.set(key, {
        date: b.date,
        adjOpen: b.adjOpen,
        adjHigh: b.adjHigh,
        adjLow: b.adjLow,
        adjClose: b.adjClose,
        volume: b.volume || 0,
      });
    } else {
      const cur = buckets.get(key);
      cur.date = b.date;
      cur.adjHigh = Math.max(cur.adjHigh, b.adjHigh);
      cur.adjLow = Math.min(cur.adjLow, b.adjLow);
      cur.adjClose = b.adjClose;
      cur.volume += b.volume || 0;
    }
  }
  return { bars: Array.from(buckets.values()), timeframe: "WEEKLY" };
}

/**
 * Renders Adjusted OHLC Candlestick chart with Volume subplot and LIN/LOG support.
 */
export function renderCandlestickChart(canvas, config) {
  const wrapper = canvas.parentElement;
  wrapper.style.position = "relative";
  const tip = ensureTooltip(wrapper);

  const { ticker = "", bars: rawBars = [], logScale = false } = config;
  const { bars, timeframe } = aggregateBarsIfNeeded(rawBars);
  let hoverIdx = null;

  const transformY = (v) => (logScale ? Math.log(v) : v);
  const invertY = (t) => (logScale ? Math.exp(t) : t);

  function draw() {
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    if (!bars.length) return;

    const pad = { top: 28, right: 18, bottom: 26, left: 66 };
    const plotW = width - pad.left - pad.right;
    const totalH = height - pad.top - pad.bottom;
    const priceH = totalH * 0.74;
    const volTop = pad.top + priceH + 10;
    const volH = totalH - priceH - 10;

    let minP = Infinity;
    let maxP = -Infinity;
    let maxVol = 1;
    for (const b of bars) {
      if (b.adjLow > 0 && b.adjHigh > 0) {
        minP = Math.min(minP, transformY(b.adjLow));
        maxP = Math.max(maxP, transformY(b.adjHigh));
      }
      if ((b.volume || 0) > maxVol) maxVol = b.volume;
    }

    const bounds = niceBounds(minP, maxP, 0.06);
    const stepX = plotW / Math.max(bars.length, 1);
    const candleW = Math.max(1.8, Math.min(10, stepX * 0.66));
    const xAt = (i) => pad.left + (i + 0.5) * stepX;
    const yAt = (v) =>
      pad.top + (1 - (transformY(v) - bounds.min) / (bounds.max - bounds.min)) * priceH;

    // Grid + Price Y-axis
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let t = 0; t <= 4; t++) {
      const tv = bounds.min + ((bounds.max - bounds.min) * t) / 4;
      const y = pad.top + (1 - t / 4) * priceH;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.10)";
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = "#8a99ad";
      ctx.fillText(`$${invertY(tv).toFixed(1)}`, pad.left - 8, y);
    }

    // Separator between Price & Volume
    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    ctx.beginPath();
    ctx.moveTo(pad.left, volTop - 4);
    ctx.lineTo(width - pad.right, volTop - 4);
    ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.fillText("VOL", pad.left - 8, volTop + volH * 0.5);

    // Header tags
    ctx.textAlign = "left";
    ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#e6b963";
    ctx.fillText(`${ticker} · ${timeframe} ADJ. OHLCV`, pad.left, 11.5);
    if (logScale) {
      ctx.textAlign = "right";
      ctx.fillText("LOG SCALE", width - pad.right, 11.5);
    }

    // X-axis labels (adaptive density for mobile)
    const compactDate = plotW < 380;
    const xTicks = Math.max(2, Math.min(6, Math.floor(plotW / (compactDate ? 78 : 96)), bars.length));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#7c8b9e";
    for (let k = 0; k < xTicks; k++) {
      const idx = xTicks === 1 ? 0 : Math.round((k * (bars.length - 1)) / (xTicks - 1));
      const label = compactDate ? bars[idx].date.slice(0, 7) : bars[idx].date;
      ctx.fillText(label, xAt(idx), pad.top + totalH + 6);
    }

    // Draw candles & volume bars
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const cx = xAt(i);
      const isUp = b.adjClose >= b.adjOpen;
      const color = isUp ? "#2dd4bf" : "#f43f5e";

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yAt(b.adjHigh));
      ctx.lineTo(cx, yAt(b.adjLow));
      ctx.stroke();

      // Body
      const yO = yAt(b.adjOpen);
      const yC = yAt(b.adjClose);
      const bodyTop = Math.min(yO, yC);
      const bodyH = Math.max(1.2, Math.abs(yC - yO));
      ctx.fillStyle = color;
      ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyH);

      // Volume bar
      const vh = ((b.volume || 0) / maxVol) * volH;
      ctx.fillStyle = isUp ? "rgba(45, 212, 191, 0.35)" : "rgba(244, 63, 94, 0.35)";
      ctx.fillRect(cx - candleW / 2, volTop + volH - vh, candleW, vh);
    }

    // Crosshair
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < bars.length) {
      const cx = xAt(hoverIdx);
      ctx.save();
      ctx.strokeStyle = "rgba(226, 232, 240, 0.35)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, pad.top);
      ctx.lineTo(cx, pad.top + totalH);
      ctx.stroke();
      ctx.restore();
    }
  }

  function onMove(ev) {
    if (!bars.length) return;
    const rect = canvas.getBoundingClientRect();
    const padLeft = 66;
    const padRight = 18;
    const plotW = rect.width - padLeft - padRight;
    const relX = Math.max(0, Math.min(plotW - 1, ev.clientX - rect.left - padLeft));
    const idx = Math.min(bars.length - 1, Math.floor((relX / Math.max(plotW, 1)) * bars.length));
    hoverIdx = idx;
    draw();

    const b = bars[idx];
    const chg = b.adjOpen > 0 ? (b.adjClose / b.adjOpen - 1) * 100 : 0;
    tip.innerHTML = `
      <div class="hud-date">${b.date} (${timeframe})</div>
      <div class="hud-row"><span class="hud-lbl">Adj Open</span><span class="hud-val">$${b.adjOpen.toFixed(2)}</span></div>
      <div class="hud-row"><span class="hud-lbl">Adj High</span><span class="hud-val">$${b.adjHigh.toFixed(2)}</span></div>
      <div class="hud-row"><span class="hud-lbl">Adj Low</span><span class="hud-val">$${b.adjLow.toFixed(2)}</span></div>
      <div class="hud-row"><span class="hud-lbl">Adj Close</span><span class="hud-val">$${b.adjClose.toFixed(2)} (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%)</span></div>
      <div class="hud-row"><span class="hud-lbl">Volume</span><span class="hud-val">${fmtVolCompact(b.volume)}</span></div>
    `;
    tip.style.opacity = "1";
    const tipW = tip.offsetWidth || 195;
    const leftPos =
      ev.clientX - rect.left + 16 + tipW > rect.width
        ? Math.max(8, ev.clientX - rect.left - tipW - 14)
        : ev.clientX - rect.left + 14;
    tip.style.left = `${leftPos}px`;
    tip.style.top = `${Math.max(24, ev.clientY - rect.top - 18)}px`;
  }

  function onLeave() {
    hoverIdx = null;
    tip.style.opacity = "0";
    draw();
  }

  if (canvas._cleanup) canvas._cleanup();
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);
  const ro = new ResizeObserver(() => draw());
  ro.observe(wrapper);
  canvas._cleanup = () => {
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mouseleave", onLeave);
    ro.disconnect();
  };

  draw();
}

/**
 * Renders Risk-Return Efficient Frontier (Volatility X vs Annual Return Y).
 */
export function renderFrontierChart(canvas, config) {
  const wrapper = canvas.parentElement;
  wrapper.style.position = "relative";
  const tip = ensureTooltip(wrapper);

  const {
    points = [],
    isTwoAssetCurve = true,
    highestSharpe = null,
    lowestVolatility = null,
    currentPoint = null,
    fmtPct = (v) => `${(v * 100).toFixed(2)}%`,
  } = config;

  let hoveredPoint = null;

  function drawStar(ctx, cx, cy, spikes, outerR, innerR, fill) {
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#090b0f";
    ctx.stroke();
    ctx.restore();
  }

  function drawDiamond(ctx, cx, cy, r, fill) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#090b0f";
    ctx.stroke();
    ctx.restore();
  }

  function getLayout(width, height) {
    const pad = { top: 30, right: 24, bottom: 34, left: 66 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const allPts = [...points];
    if (currentPoint) allPts.push(currentPoint);

    for (const p of allPts) {
      if (p.annualVolatility < minX) minX = p.annualVolatility;
      if (p.annualVolatility > maxX) maxX = p.annualVolatility;
      if (p.annualReturn < minY) minY = p.annualReturn;
      if (p.annualReturn > maxY) maxY = p.annualReturn;
    }

    const bx = niceBounds(minX, maxX, 0.12);
    const by = niceBounds(minY, maxY, 0.14);

    const xAt = (v) => pad.left + ((v - bx.min) / (bx.max - bx.min)) * plotW;
    const yAt = (v) => pad.top + (1 - (v - by.min) / (by.max - by.min)) * plotH;

    return { pad, plotW, plotH, bx, by, xAt, yAt };
  }

  function draw() {
    const { ctx, width, height } = setupCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    if (!points.length) return;

    const { pad, plotH, bx, by, xAt, yAt } = getLayout(width, height);

    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    for (let i = 0; i <= 4; i++) {
      const yVal = by.min + ((by.max - by.min) * i) / 4;
      const y = yAt(yVal);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.10)";
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = "#8a99ad";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(fmtPct(yVal), pad.left - 8, y);
    }

    for (let j = 0; j <= 4; j++) {
      const xVal = bx.min + ((bx.max - bx.min) * j) / 4;
      const x = xAt(xVal);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.06)";
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      ctx.fillStyle = "#7c8b9e";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fmtPct(xVal), x, pad.top + plotH + 8);
    }

    if (isTwoAssetCurve && points.length > 1) {
      ctx.save();
      ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      points.forEach((p, i) => {
        const px = xAt(p.annualVolatility);
        const py = yAt(p.annualReturn);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }

    const sharpes = points.map((p) => p.sharpeRatio);
    const minS = Math.min(...sharpes);
    const maxS = Math.max(...sharpes);
    const spanS = Math.max(maxS - minS, 1e-6);

    for (const p of points) {
      const ratio = (p.sharpeRatio - minS) / spanS;
      const r = Math.round(76 + ratio * (230 - 76));
      const g = Math.round(201 + ratio * (185 - 201));
      const b = Math.round(240 + ratio * (99 - 240));
      ctx.beginPath();
      ctx.arc(xAt(p.annualVolatility), yAt(p.annualReturn), isTwoAssetCurve ? 4.2 : 3.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
      ctx.fill();
    }

    if (lowestVolatility) {
      drawDiamond(
        ctx,
        xAt(lowestVolatility.annualVolatility),
        yAt(lowestVolatility.annualReturn),
        7,
        "#4cc9f0"
      );
    }

    if (highestSharpe) {
      drawStar(
        ctx,
        xAt(highestSharpe.annualVolatility),
        yAt(highestSharpe.annualReturn),
        5,
        8.5,
        4,
        "#e6b963"
      );
    }

    if (currentPoint) {
      const cx = xAt(currentPoint.annualVolatility);
      const cy = yAt(currentPoint.annualReturn);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
      ctx.strokeStyle = "#2dd4bf";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#2dd4bf";
      ctx.fill();
      ctx.restore();
    }

    if (hoveredPoint) {
      const hx = xAt(hoveredPoint.annualVolatility);
      const hy = yAt(hoveredPoint.annualReturn);
      ctx.beginPath();
      ctx.arc(hx, hy, 7, 0, Math.PI * 2);
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.font = "600 11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let lx = pad.left;
    const legendItems = [
      { color: "#e6b963", text: "★ Max Sharpe" },
      { color: "#4cc9f0", text: "◆ Min Volatility" },
      { color: "#2dd4bf", text: "◎ Active Portfolio" },
    ];
    for (const item of legendItems) {
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, lx, 12);
      lx += ctx.measureText(item.text).width + 22;
    }
  }

  function onMove(ev) {
    if (!points.length) return;
    const rect = canvas.getBoundingClientRect();
    const { xAt, yAt } = getLayout(rect.width, rect.height);
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;

    let best = null;
    let bestDist = Infinity;
    for (const p of points) {
      const dx = xAt(p.annualVolatility) - mx;
      const dy = yAt(p.annualReturn) - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = p;
      }
    }

    if (!best || bestDist > 1600) {
      hoveredPoint = null;
      tip.style.opacity = "0";
      draw();
      return;
    }

    hoveredPoint = best;
    draw();

    const allocStr = Object.entries(best.weights || {})
      .map(([sym, w]) => `${sym} ${(w * 100).toFixed(0)}%`)
      .join(" · ");

    tip.innerHTML = `
      <div class="hud-date">${allocStr}</div>
      <div class="hud-row"><span class="hud-lbl">Annual Return</span><span class="hud-val">${fmtPct(best.annualReturn)}</span></div>
      <div class="hud-row"><span class="hud-lbl">Volatility</span><span class="hud-val">${fmtPct(best.annualVolatility)}</span></div>
      <div class="hud-row"><span class="hud-lbl">Sharpe Ratio</span><span class="hud-val">${best.sharpeRatio.toFixed(4)}</span></div>
      <div class="hud-row"><span class="hud-lbl">Max Drawdown</span><span class="hud-val">${fmtPct(best.maximumDrawdown)}</span></div>
    `;
    tip.style.opacity = "1";
    const tipW = tip.offsetWidth || 190;
    const leftPos =
      mx + 16 + tipW > rect.width ? Math.max(8, mx - tipW - 14) : mx + 14;
    tip.style.left = `${leftPos}px`;
    tip.style.top = `${Math.max(24, my - 18)}px`;
  }

  function onLeave() {
    hoveredPoint = null;
    tip.style.opacity = "0";
    draw();
  }

  if (canvas._cleanup) canvas._cleanup();
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);
  const ro = new ResizeObserver(() => draw());
  ro.observe(wrapper);
  canvas._cleanup = () => {
    canvas.removeEventListener("mousemove", onMove);
    canvas.removeEventListener("mouseleave", onLeave);
    ro.disconnect();
  };

  draw();
}

export { PALETTE };
