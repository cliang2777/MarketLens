/**
 * Precision High-DPI Metallic Financial Chart Engine
 * Self-contained HTML5 Canvas renderer with interactive laser crosshairs & HUD tooltips.
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

/**
 * Renders an interactive multi-series financial time-series chart.
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
    markers = [],
  } = config;

  let hoverIdx = null;

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

    const pad = { top: 28, right: 18, bottom: 28, left: 64 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    let rawMin = Infinity;
    let rawMax = -Infinity;
    for (const s of series) {
      for (const v of s.values) {
        if (v !== null && v !== undefined && Number.isFinite(v)) {
          if (v < rawMin) rawMin = v;
          if (v > rawMax) rawMax = v;
        }
      }
    }
    if (baselineValue !== null) {
      rawMin = Math.min(rawMin, baselineValue);
      rawMax = Math.max(rawMax, baselineValue);
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
      pad.top + (1 - (v - bounds.min) / (bounds.max - bounds.min)) * plotH;

    // Horizontal etched grid lines + Y labels
    const yTicks = 5;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let t = 0; t <= yTicks; t++) {
      const val = bounds.min + ((bounds.max - bounds.min) * t) / yTicks;
      const y = yAt(val);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = "#8a99ad";
      ctx.fillText(yFormat(val), pad.left - 8, y);
    }

    // Baseline dashed reference (e.g. 1.00x or 0.00%)
    if (baselineValue !== null && baselineValue >= bounds.min && baselineValue <= bounds.max) {
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

    // X-axis date ticks
    const xTickCount = Math.min(6, dates.length);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#7c8b9e";
    for (let k = 0; k < xTickCount; k++) {
      const idx =
        xTickCount === 1
          ? 0
          : Math.round((k * (dates.length - 1)) / (xTickCount - 1));
      const x = xAt(idx);
      ctx.fillText(dates[idx], x, pad.top + plotH + 8);
    }

    // Legend bar at top-left
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
      legendX += ctx.measureText(s.label).width + 30;
    });

    // Draw series lines + optional area fills
    series.forEach((s, idx) => {
      const color = s.color || PALETTE[idx % PALETTE.length];
      const pts = [];
      for (let i = 0; i < dates.length; i++) {
        const v = s.values[i];
        if (v !== null && v !== undefined && Number.isFinite(v)) {
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

    // Draw trade markers (BUY / EXIT triangles) if provided
    if (markerByIndex.size > 0 && series[0]) {
      for (const [idx, mList] of markerByIndex.entries()) {
        const baseVal = series[0].values[idx];
        if (baseVal === null || baseVal === undefined) continue;
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

    // Interactive laser crosshair
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
        if (v === null || v === undefined || !Number.isFinite(v)) return;
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
    const padLeft = 64;
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

    const { pad, plotW, plotH, bx, by, xAt, yAt } = getLayout(width, height);

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

    // Scatter points shaded from Cyan to Brass by Sharpe ratio rank
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

    // Legend
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
