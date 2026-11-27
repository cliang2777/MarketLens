import { I18N } from "/static/i18n.js";
import {
  PALETTE,
  exportCanvasPng,
  renderCandlestickChart,
  renderFrontierChart,
  renderTimeSeriesChart,
} from "/static/charts.js";

const state = {
  lang: "en",
  viewMode: "pro", // "pro" | "guide"
  activePage: "asset",
  stratSubtab: "single",
  assetChartMode: "wealth", // "wealth" | "candle"
  logScale: {
    asset: false,
    compare: false,
    portfolio: false,
    strategy: false,
  },
  allocations: [
    { ticker: "AAPL", weight: 50 },
    { ticker: "MSFT", weight: 50 },
  ],
  compareTickers: ["AAPL", "MSFT"],
  optShortOptions: [5, 10, 20, 30, 50],
  optSelectedShorts: [10, 20, 50],
  optLongOptions: [50, 100, 150, 200, 250],
  optSelectedLongs: [50, 100, 200],
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

const fmtMoney = (v) =>
  `$${Math.round(v).toLocaleString("en-US")}`;

/* ==================== SMART FLOATING US TICKER AUTOCOMPLETE ==================== */
const acState = {
  activeInput: null,
  onPick: null,
  items: [],
  activeIdx: -1,
  timer: null,
  reqSeq: 0,
  suppressNextInput: false,
};

function closeTickerDropdown() {
  clearTimeout(acState.timer);
  acState.reqSeq += 1;
  const dd = document.getElementById("ticker-ac-dropdown");
  if (!dd) return;
  dd.classList.remove("open");
  dd.innerHTML = "";
  acState.items = [];
  acState.activeIdx = -1;
}

function positionTickerDropdown(inputEl) {
  const dd = document.getElementById("ticker-ac-dropdown");
  if (!dd || !inputEl) return;
  const rect = inputEl.getBoundingClientRect();
  const isMobile = window.innerWidth <= 860;
  const maxAllowedW = window.innerWidth - 20;
  const ddW = isMobile ? maxAllowedW : Math.min(Math.max(rect.width, 320), maxAllowedW);
  const left = isMobile
    ? 10 + window.scrollX
    : Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - ddW - 10)) + window.scrollX;
  dd.style.left = `${left}px`;
  dd.style.top = `${rect.bottom + window.scrollY + 6}px`;
  dd.style.width = `${ddW}px`;
}

function renderTickerDropdown(results) {
  const dd = document.getElementById("ticker-ac-dropdown");
  if (!dd || !acState.activeInput) return;
  acState.items = results;
  acState.activeIdx = results.length ? 0 : -1;

  if (!results.length) {
    dd.innerHTML = `<div class="ac-empty">${
      state.lang === "zh"
        ? "未找到匹配的美股代码，请尝试输入英文公司名或美股代码 (如 KO, AAPL)"
        : "No matching US ticker found. Try a US symbol or company name (e.g. KO, AAPL)."
    }</div>`;
    positionTickerDropdown(acState.activeInput);
    dd.classList.add("open");
    return;
  }

  dd.innerHTML = results
    .map((item, idx) => {
      const subLine =
        state.lang === "zh" && item.nameZh
          ? `<span class="ac-zh">${item.nameZh} · ${item.category}</span>`
          : `<span class="ac-zh">${item.category}</span>`;
      return `
        <button type="button" class="ac-item ${idx === 0 ? "active" : ""}" data-ac-idx="${idx}">
          <span class="ac-left">
            <span class="ac-sym">${item.ticker}</span>
            <span class="ac-names">
              <span class="ac-en">${item.name}</span>
              ${subLine}
            </span>
          </span>
          <span class="ac-meta">${item.exchange}</span>
        </button>
      `;
    })
    .join("");

  positionTickerDropdown(acState.activeInput);
  dd.classList.add("open");

  dd.querySelectorAll(".ac-item").forEach((btn) => {
    const handlePick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const chosen = acState.items[Number(btn.dataset.acIdx)];
      if (chosen) selectAcItem(chosen);
    };
    btn.addEventListener("mousedown", handlePick);
    btn.addEventListener("click", handlePick);
  });
}

function selectAcItem(item) {
  const inputEl = acState.activeInput;
  const cb = acState.onPick;
  closeTickerDropdown();
  if (inputEl) {
    acState.suppressNextInput = true;
    inputEl.value = item.ticker;
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    acState.suppressNextInput = false;
    inputEl.blur();
  }
  if (cb) cb(item.ticker);
}

async function queryTickerSuggestions(inputEl, queryStr) {
  const seq = ++acState.reqSeq;
  try {
    const res = await fetch(`/api/tickers/search?q=${encodeURIComponent(queryStr)}&limit=8`);
    const data = await res.json();
    if (seq !== acState.reqSeq || acState.activeInput !== inputEl) return;
    renderTickerDropdown(data.results || []);
  } catch {
    // ignore transient search errors
  }
}

function attachTickerAutocomplete(inputEl, onPick = null) {
  if (!inputEl || inputEl.dataset.acBound === "1") return;
  inputEl.dataset.acBound = "1";

  const triggerSearch = (immediate = false) => {
    closeAllPopovers("ticker");
    acState.activeInput = inputEl;
    acState.onPick = onPick;
    clearTimeout(acState.timer);
    const q = inputEl.value.trim();
    if (immediate) {
      queryTickerSuggestions(inputEl, q);
    } else {
      acState.timer = setTimeout(() => queryTickerSuggestions(inputEl, q), 150);
    }
  };

  inputEl.addEventListener("focus", () => triggerSearch(true));
  inputEl.addEventListener("input", () => {
    if (acState.suppressNextInput) {
      acState.suppressNextInput = false;
      return;
    }
    triggerSearch(false);
  });
  inputEl.addEventListener("blur", () => {
    setTimeout(() => {
      if (acState.activeInput === inputEl) closeTickerDropdown();
    }, 220);
  });

  inputEl.addEventListener("keydown", (e) => {
    const dd = document.getElementById("ticker-ac-dropdown");
    if (!dd || !dd.classList.contains("open") || !acState.items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      acState.activeIdx = (acState.activeIdx + 1) % acState.items.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      acState.activeIdx = (acState.activeIdx - 1 + acState.items.length) % acState.items.length;
    } else if (e.key === "Enter" && acState.activeIdx >= 0) {
      const chosen = acState.items[acState.activeIdx];
      // If user typed a company name (contains spaces or differs from exact ticker), pick suggestion instead of submitting invalid name
      if (chosen && inputEl.value.trim().toUpperCase() !== chosen.ticker) {
        e.preventDefault();
        selectAcItem(chosen);
      } else {
        closeTickerDropdown();
      }
      return;
    } else if (e.key === "Escape") {
      closeTickerDropdown();
      return;
    } else {
      return;
    }

    dd.querySelectorAll(".ac-item").forEach((el, idx) => {
      el.classList.toggle("active", idx === acState.activeIdx);
    });
  });
}

/* ==================== CUSTOM METALLIC SELECT & DATE PICKER PORTALS ==================== */
const metalSelectState = {
  activeSelect: null,
  activeTrigger: null,
};

const metalDateState = {
  activeInput: null,
  viewYear: 2025,
  viewMonth: 0, // 0..11
  pickingYear: false,
};

function closeMetalSelect() {
  const pop = document.getElementById("metal-select-popover");
  if (pop) {
    pop.classList.remove("open");
    pop.innerHTML = "";
  }
  if (metalSelectState.activeTrigger) {
    metalSelectState.activeTrigger.classList.remove("open");
  }
  metalSelectState.activeSelect = null;
  metalSelectState.activeTrigger = null;
}

function closeMetalDate() {
  const pop = document.getElementById("metal-date-popover");
  if (pop) {
    pop.classList.remove("open");
    pop.innerHTML = "";
  }
  metalDateState.activeInput = null;
  metalDateState.pickingYear = false;
}

function closeAllPopovers(except = null) {
  if (except !== "ticker") closeTickerDropdown();
  if (except !== "select") closeMetalSelect();
  if (except !== "date") closeMetalDate();
}

function positionFloatingPopover(pop, anchorEl, minW = 200) {
  const rect = anchorEl.getBoundingClientRect();
  const popW = Math.max(rect.width, minW);
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - popW - 10));
  pop.style.left = `${left}px`;
  pop.style.width = `${Math.min(popW, window.innerWidth - 16)}px`;

  // Measure height to flip above anchor if near bottom edge
  pop.style.visibility = "hidden";
  pop.classList.add("open");
  const popH = pop.offsetHeight || 240;
  const spaceBelow = window.innerHeight - rect.bottom - 10;
  const top =
    spaceBelow < popH && rect.top > popH + 10
      ? Math.max(8, rect.top - popH - 5)
      : rect.bottom + 5;
  pop.style.top = `${top}px`;
  pop.style.visibility = "visible";
}

function syncMetalSelectLabels() {
  document.querySelectorAll("select.metal-select").forEach((sel) => {
    const trig = sel._metalTrigger;
    if (!trig) return;
    const selectedOpt = sel.options[sel.selectedIndex];
    const lbl = trig.querySelector(".metal-select-label");
    if (lbl && selectedOpt) lbl.textContent = selectedOpt.textContent;
  });
}

function initMetalSelects() {
  document.querySelectorAll("select.metal-select").forEach((sel) => {
    if (sel.dataset.metalEnhanced === "1") return;
    sel.dataset.metalEnhanced = "1";
    sel.classList.add("metal-select-native-hidden");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "metal-select-trigger";
    const initialText = sel.options[sel.selectedIndex]?.textContent || "";
    trigger.innerHTML = `<span class="metal-select-label">${initialText}</span><span class="metal-select-chevron">▾</span>`;
    sel.insertAdjacentElement("afterend", trigger);
    sel._metalTrigger = trigger;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasSame = metalSelectState.activeSelect === sel;
      closeAllPopovers();
      if (wasSame) return;

      metalSelectState.activeSelect = sel;
      metalSelectState.activeTrigger = trigger;
      trigger.classList.add("open");

      const pop = document.getElementById("metal-select-popover");
      pop.innerHTML = Array.from(sel.options)
        .map((opt) => {
          const isSel = opt.value === sel.value;
          return `
            <button type="button" class="mselect-opt ${isSel ? "selected" : ""}" data-val="${opt.value}">
              <span>${opt.textContent}</span>
              ${isSel ? `<span class="mselect-check">✓</span>` : ""}
            </button>
          `;
        })
        .join("");

      positionFloatingPopover(pop, trigger, trigger.offsetWidth || 180);

      pop.querySelectorAll(".mselect-opt").forEach((optBtn) => {
        optBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          sel.value = optBtn.dataset.val;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          syncMetalSelectLabels();
          closeMetalSelect();
        });
      });
    });
  });
}

function _parseIsoDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((str || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return { y, mo, d };
}

function _toIsoDate(y, mo, d) {
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function renderMetalCalendar() {
  const pop = document.getElementById("metal-date-popover");
  const inp = metalDateState.activeInput;
  if (!pop || !inp) return;

  const isZh = state.lang === "zh";
  const monthNames = isZh
    ? ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]
    : ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const weekdays = isZh
    ? ["一", "二", "三", "四", "五", "六", "日"]
    : ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

  const y = metalDateState.viewYear;
  const mo = metalDateState.viewMonth;
  const parsedSel = _parseIsoDate(inp.value);
  const now = new Date();
  const todayIso = _toIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
  const ymLabel = isZh ? `${y}年 ${monthNames[mo]} ▾` : `${monthNames[mo]} ${y} ▾`;

  let bodyHtml = "";
  if (metalDateState.pickingYear) {
    const maxY = Math.max(now.getFullYear(), 2026);
    const years = [];
    for (let yr = maxY; yr >= 1990; yr--) years.push(yr);
    bodyHtml = `
      <div class="cal-year-grid">
        ${years
          .map(
            (yr) =>
              `<button type="button" class="cal-yr-btn ${yr === y ? "selected" : ""}" data-yr="${yr}">${yr}</button>`
          )
          .join("")}
      </div>
    `;
  } else {
    const firstDow = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const prevMonthDays = new Date(y, mo, 0).getDate();
    const cells = [];

    for (let i = firstDow - 1; i >= 0; i--) {
      const py = mo === 0 ? y - 1 : y;
      const pm = mo === 0 ? 11 : mo - 1;
      const pd = prevMonthDays - i;
      cells.push({ y: py, mo: pm, d: pd, muted: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ y, mo, d, muted: false });
    }
    while (cells.length % 7 !== 0) {
      const idx = cells.length - firstDow - daysInMonth + 1;
      const ny = mo === 11 ? y + 1 : y;
      const nm = mo === 11 ? 0 : mo + 1;
      cells.push({ y: ny, mo: nm, d: idx, muted: true });
    }

    bodyHtml = `
      <div class="cal-weekdays">${weekdays.map((w) => `<div class="cal-wd">${w}</div>`).join("")}</div>
      <div class="cal-days">
        ${cells
          .map((c) => {
            const iso = _toIsoDate(c.y, c.mo, c.d);
            const isSel = parsedSel && iso === _toIsoDate(parsedSel.y, parsedSel.mo, parsedSel.d);
            const isToday = iso === todayIso;
            const cls = [
              "cal-day",
              c.muted ? "muted" : "",
              isToday ? "today" : "",
              isSel ? "selected" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return `<button type="button" class="${cls}" data-iso="${iso}">${c.d}</button>`;
          })
          .join("")}
      </div>
    `;
  }

  pop.innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav-btn" data-cal-nav="-1">‹</button>
      <button type="button" class="cal-ym-btn" id="cal-toggle-year">${ymLabel}</button>
      <button type="button" class="cal-nav-btn" data-cal-nav="1">›</button>
    </div>
    ${bodyHtml}
    <div class="cal-foot">
      <button type="button" class="cal-quick-btn" data-cal-quick="${y}-01-01">${isZh ? "年初 (1/1)" : "Jan 1"}</button>
      <button type="button" class="cal-quick-btn" data-cal-quick="${y}-12-31">${isZh ? "年末 (12/31)" : "Dec 31"}</button>
      <button type="button" class="cal-quick-btn" data-cal-quick="${todayIso}">${isZh ? "今天" : "Today"}</button>
    </div>
  `;

  positionFloatingPopover(pop, inp, 282);

  pop.querySelectorAll("[data-cal-nav]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const delta = Number(btn.dataset.calNav);
      if (metalDateState.pickingYear) {
        metalDateState.viewYear += delta;
      } else {
        metalDateState.viewMonth += delta;
        if (metalDateState.viewMonth < 0) {
          metalDateState.viewMonth = 11;
          metalDateState.viewYear -= 1;
        } else if (metalDateState.viewMonth > 11) {
          metalDateState.viewMonth = 0;
          metalDateState.viewYear += 1;
        }
      }
      renderMetalCalendar();
    });
  });

  const ymBtn = pop.querySelector("#cal-toggle-year");
  if (ymBtn) {
    ymBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      metalDateState.pickingYear = !metalDateState.pickingYear;
      renderMetalCalendar();
    });
  }

  pop.querySelectorAll(".cal-yr-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      metalDateState.viewYear = Number(btn.dataset.yr);
      metalDateState.pickingYear = false;
      renderMetalCalendar();
    });
  });

  const pickIso = (iso) => {
    inp.value = iso;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    closeMetalDate();
  };

  pop.querySelectorAll(".cal-day").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      pickIso(btn.dataset.iso);
    });
  });

  pop.querySelectorAll("[data-cal-quick]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      pickIso(btn.dataset.calQuick);
    });
  });
}

function openMetalCalendarFor(inp) {
  closeAllPopovers("date");
  const parsed = _parseIsoDate(inp.value);
  const now = new Date();
  metalDateState.activeInput = inp;
  metalDateState.viewYear = parsed ? parsed.y : now.getFullYear();
  metalDateState.viewMonth = parsed ? parsed.mo : now.getMonth();
  metalDateState.pickingYear = false;
  renderMetalCalendar();
}

function initMetalDatePickers() {
  const calSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="2"/><line x1="5" y1="1.5" x2="5" y2="4"/><line x1="11" y1="1.5" x2="11" y2="4"/><line x1="2" y1="6.8" x2="14" y2="6.8"/></svg>`;

  document.querySelectorAll('input[type="date"].metal-input').forEach((inp) => {
    if (inp.dataset.metalDate === "1") return;
    inp.dataset.metalDate = "1";
    inp.type = "text";
    inp.readOnly = true;
    inp.inputMode = "none";
    inp.placeholder = "YYYY-MM-DD";
    inp.autocomplete = "off";
    inp.maxLength = 10;

    const wrap = document.createElement("div");
    wrap.className = "metal-date-wrap";
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);

    const iconBtn = document.createElement("button");
    iconBtn.type = "button";
    iconBtn.className = "metal-date-icon-btn";
    iconBtn.setAttribute("aria-label", "Open calendar");
    iconBtn.innerHTML = calSvg;
    wrap.appendChild(iconBtn);

    inp.addEventListener("click", (e) => {
      e.stopPropagation();
      if (metalDateState.activeInput === inp) closeMetalDate();
      else openMetalCalendarFor(inp);
    });

    iconBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (metalDateState.activeInput === inp) closeMetalDate();
      else openMetalCalendarFor(inp);
    });

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMetalDate();
    });
  });
}

document.addEventListener("click", (e) => {
  const tPop = document.getElementById("ticker-ac-dropdown");
  const sPop = document.getElementById("metal-select-popover");
  const dPop = document.getElementById("metal-date-popover");
  if (sPop && sPop.classList.contains("open") && !sPop.contains(e.target)) {
    closeMetalSelect();
  }
  if (dPop && dPop.classList.contains("open") && !dPop.contains(e.target)) {
    closeMetalDate();
  }
  if (tPop && tPop.classList.contains("open") && !tPop.contains(e.target) && e.target !== acState.activeInput) {
    closeTickerDropdown();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllPopovers();
});

window.addEventListener(
  "scroll",
  (e) => {
    const target = e.target;
    if (
      target instanceof Element &&
      (target.closest(".metal-popover") || target.closest(".ticker-ac-dropdown"))
    ) {
      return;
    }
    // Keep absolute-positioned ticker dropdown open during iOS keyboard auto-scroll
    closeAllPopovers("ticker");
  },
  true
);
let _lastWindowWidth = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth !== _lastWindowWidth) {
    _lastWindowWidth = window.innerWidth;
    closeAllPopovers();
  }
});

function showError(msg) {
  const el = document.getElementById("global-error");
  if (!msg) {
    el.classList.remove("visible");
    el.innerHTML = "";
    return;
  }
  const safeMsg = String(msg).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const match = String(msg).match(/Did you mean ([A-Z0-9.-]+)\?/);
  if (match) {
    const suggested = match[1];
    el.innerHTML = `
      <span>⚠ ${safeMsg}</span>
      <button type="button" class="brass-btn" id="btn-fix-typo" style="height:28px;padding:0 12px;font-size:11px;">
        ${t("assetPage.switchTo")} ${suggested} →
      </button>
    `;
    const fixBtn = document.getElementById("btn-fix-typo");
    if (fixBtn) {
      fixBtn.addEventListener("click", () => {
        if (state.activePage === "asset") {
          document.getElementById("asset-ticker").value = suggested;
          runAssetAnalysis();
        } else if (state.activePage === "strategy") {
          if (state.stratSubtab === "single") {
            document.getElementById("strat-ticker").value = suggested;
            runStrategySingle();
          } else {
            document.getElementById("opt-ticker").value = suggested;
            runStrategyOptimize();
          }
        }
      });
    }
  } else {
    el.textContent = `⚠ ${msg}`;
  }
  el.classList.add("visible");
}

function downloadCsv(filename, headers, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) {
    lines.push(r.map(esc).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  if (!chip) return;
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
  if (cacheChip) {
    cacheChip.textContent = `${c.backend.toUpperCase()} · ${c.tickerCount} ${t("status.tickers")} · ${c.totalBars.toLocaleString()} ${t("status.bars")}`;
  }

  const tiingoLed = document.getElementById("tiingo-led");
  const tiingoTxt = document.getElementById("tiingo-status-text");
  if (tiingoLed && tiingoTxt) {
    if (h.tiingoConfigured) {
      tiingoLed.className = "led-dot";
      tiingoTxt.textContent = t("status.tiingoReady");
    } else {
      tiingoLed.className = "led-dot amber";
      tiingoTxt.textContent = t("status.tiingoMissing");
    }
  }
}

function rerenderActiveViews() {
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

function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
  syncMetalSelectLabels();
  renderAllWindowChips();
  rerenderActiveViews();
}

function kpiCardHtml(label, value, sub, tone = "", hintKey = null) {
  const hintHtml =
    state.viewMode === "guide" && hintKey
      ? `<div class="kpi-hint">${t(`hints.${hintKey}`)}</div>`
      : "";
  return `
    <div class="kpi-plate">
      <div class="kpi-top"><span>${label}</span></div>
      <div class="kpi-value ${tone}">${value}</div>
      <div class="kpi-sub">${sub || "&nbsp;"}</div>
      ${hintHtml}
    </div>
  `;
}

function renderGuidedBanner(containerId, htmlBody, pills = []) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (state.viewMode !== "guide" || !htmlBody) {
    el.classList.remove("visible");
    el.innerHTML = "";
    return;
  }
  const pillsHtml = pills.length
    ? `<div class="guided-pills">${pills.map((p) => `<span class="guided-pill">${p}</span>`).join("")}</div>`
    : "";
  el.innerHTML = `
    <div class="guided-header">
      <div class="guided-tag"><span class="led-dot"></span>${t("mode.guideTag")}</div>
    </div>
    <div class="guided-body">${htmlBody}</div>
    ${pillsHtml}
  `;
  el.classList.add("visible");
}

/**
 * Renders Year x 12 Months + Annual Total Monthly Returns Calendar Heatmap.
 */
function renderMonthlyHeatmap(containerId, monthlyRows) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!monthlyRows || !monthlyRows.length) {
    el.innerHTML = `<div style="padding:16px;text-align:center;color:var(--steel-400);font-family:var(--mono);">NO MONTHLY DATA</div>`;
    return;
  }

  const months = t("common.months");
  const cellBg = (val) => {
    if (val === undefined || val === null || !Number.isFinite(val)) return "";
    const mag = Math.min(0.62, Math.abs(val) * 4.2 + 0.06);
    return val >= 0
      ? `background: rgba(45, 212, 191, ${mag.toFixed(2)});`
      : `background: rgba(244, 63, 94, ${mag.toFixed(2)});`;
  };

  let html = `<table class="heatmap-table"><thead><tr><th>${t("common.yearCol")}</th>`;
  for (const mLabel of months) html += `<th>${mLabel}</th>`;
  html += `<th>${t("common.annualCol")}</th></tr></thead><tbody>`;

  for (const row of monthlyRows) {
    html += `<tr><td class="hm-year">${row.year}</td>`;
    for (let m = 1; m <= 12; m++) {
      const val = row.months[String(m)];
      if (val === undefined) {
        html += `<td class="hm-empty">—</td>`;
      } else {
        html += `<td style="${cellBg(val)}">${val >= 0 ? "+" : ""}${(val * 100).toFixed(1)}%</td>`;
      }
    }
    const ytd = row.ytd;
    html += `<td class="hm-ytd" style="${cellBg(ytd * 0.45)}">${ytd >= 0 ? "+" : ""}${(ytd * 100).toFixed(1)}%</td></tr>`;
  }
  html += `</tbody></table>`;
  el.innerHTML = html;
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

    const data = await apiFetch("/api/assets/analyze", {
      method: "POST",
      body: JSON.stringify({ ticker, benchmark, startDate, endDate, forceRefresh: false }),
    });
    state.cacheAsset = data;
    renderAssetView(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t("common.runAnalysis");
  }
}

function buildAssetGuide(data) {
  const s = data.summary;
  const st = data.stats;
  const bc = data.benchmarkComparison;
  const endMoney = 10000 * (1 + s.totalReturn);
  const ddLoss = Math.abs(s.maximumDrawdown) * 10000;
  const isZh = state.lang === "zh";

  if (isZh) {
    const riskProfile =
      s.annualVolatility > 0.32 ? "高波动激进型" : s.annualVolatility > 0.18 ? "中高波动成长型" : "相对稳健型";
    const benchText = bc
      ? `同期对比大盘基准 ${bc.benchmarkTicker}，年化${bc.annualReturnDifference >= 0 ? "跑赢" : "跑输"} <strong>${fmtPct(bc.annualReturnDifference)}</strong>；大盘每波动 1%，${data.ticker} 平均同向波动约 <strong>${bc.beta.toFixed(2)}%</strong>（Beta）。`
      : `该时间区间共包含 <strong>${st.observations}</strong> 个交易日。`;
    const body =
      `如果在 ${st.firstDate} 投入 <strong>$10,000</strong> 买入 <strong>${data.ticker}</strong> 并持有至 ${st.lastDate}，账户最终会变为 <strong>${fmtMoney(endMoney)}</strong>（累计 <strong>${fmtPct(s.totalReturn)}</strong>，折合年化 <strong>${fmtPct(s.annualReturn)}</strong>）。` +
      `但持有过程中最难熬时曾从高点回撤 <strong>${fmtPct(s.maximumDrawdown)}</strong>（每 $10,000 峰值浮亏约 ${fmtMoney(ddLoss)}），整体属于<strong>${riskProfile}</strong>资产。${benchText}`;
    const pills = [
      `$10,000 期初 → ${fmtMoney(endMoney)} 期末`,
      `风险定性：${riskProfile}`,
      s.sharpeRatio >= 1 ? `收益性价比优秀 (夏普 ${s.sharpeRatio.toFixed(2)})` : `收益性价比一般 (夏普 ${s.sharpeRatio.toFixed(2)})`,
    ];
    return { body, pills };
  }

  const riskProfile =
    s.annualVolatility > 0.32 ? "High-Volatility Aggressive" : s.annualVolatility > 0.18 ? "Growth / Moderate-High Volatility" : "Relatively Defensive";
  const benchText = bc
    ? `Compared with ${bc.benchmarkTicker}, it ${bc.annualReturnDifference >= 0 ? "outperformed" : "trailed"} by <strong>${fmtPct(bc.annualReturnDifference)}</strong> per year, moving roughly <strong>${bc.beta.toFixed(2)}%</strong> for every 1% benchmark move (Beta).`
    : `Covered <strong>${st.observations}</strong> trading sessions.`;
  const body =
    `Investing <strong>$10,000</strong> in <strong>${data.ticker}</strong> on ${st.firstDate} would have grown to <strong>${fmtMoney(endMoney)}</strong> by ${st.lastDate} (<strong>${fmtPct(s.totalReturn)}</strong> total, or <strong>${fmtPct(s.annualReturn)}</strong>/yr). ` +
    `At its worst point, an investor faced a <strong>${fmtPct(s.maximumDrawdown)}</strong> peak-to-trough drop (~${fmtMoney(ddLoss)} per $10k peak), classifying it as <strong>${riskProfile}</strong>. ${benchText}`;
  const pills = [
    `$10,000 Initial → ${fmtMoney(endMoney)} Terminal`,
    `Profile: ${riskProfile}`,
    `Sharpe: ${s.sharpeRatio.toFixed(2)}`,
  ];
  return { body, pills };
}

function renderAssetProfile(data) {
  const card = document.getElementById("asset-profile-card");
  if (!card) return;
  const p = data.profile;
  if (!p) {
    card.classList.remove("visible");
    card.innerHTML = "";
    return;
  }

  const isZh = state.lang === "zh";
  const enName = p.name || data.ticker;
  const displayName = isZh && p.nameZh ? `${p.nameZh} · ${enName}` : enName;
  const exchange = p.exchangeCode || "US";
  const sinceDate = p.startDate || data.stats.firstDate;
  const desc = p.description || "";

  const needsToggle = desc.length > 210;
  card.innerHTML = `
    <div class="profile-top">
      <div class="profile-ident">
        <span class="profile-ticker">${data.ticker}</span>
        <span class="profile-name">${displayName}</span>
      </div>
      <div class="profile-badges">
        <span class="profile-tag exch">${exchange}</span>
        <span class="profile-tag">US MARKET</span>
        ${isZh && desc ? `<span class="profile-tag">OFFICIAL ENGLISH BIO</span>` : ""}
        ${sinceDate ? `<span class="profile-tag">${t("assetPage.profileSince")}: ${sinceDate}</span>` : ""}
      </div>
    </div>
    ${
      desc
        ? `<div class="profile-desc-row">
             <p class="profile-desc ${needsToggle ? "clamped" : ""}" id="profile-desc-text">${desc}</p>
             ${
               needsToggle
                 ? `<button type="button" class="steel-chip" id="btn-toggle-bio">${t("assetPage.expandBio")}</button>`
                 : ""
             }
           </div>`
        : ""
    }
  `;
  card.classList.add("visible");

  const toggleBtn = document.getElementById("btn-toggle-bio");
  const descEl = document.getElementById("profile-desc-text");
  if (toggleBtn && descEl) {
    toggleBtn.addEventListener("click", () => {
      const clamped = descEl.classList.toggle("clamped");
      toggleBtn.textContent = clamped ? t("assetPage.expandBio") : t("assetPage.collapseBio");
    });
  }
}

function renderAssetView(data) {
  const s = data.summary;
  const st = data.stats;
  const bc = data.benchmarkComparison;

  renderAssetProfile(data);

  const guide = buildAssetGuide(data);
  renderGuidedBanner("guided-asset", guide.body, guide.pills);

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
      "cyan",
      "beta"
    );
  } else {
    sixthCard = kpiCardHtml(
      t("assetPage.positiveDays"),
      fmtPctUnsigned(st.positiveDaysRatio, 1),
      `${st.observations} ${t("common.observations")}`,
      "cyan",
      "positiveDays"
    );
  }

  document.getElementById("asset-kpis").innerHTML = [
    kpiCardHtml(t("common.totalReturn"), fmtPct(s.totalReturn), benchSubRet, s.totalReturn >= 0 ? "pos" : "neg", "totalReturn"),
    kpiCardHtml(t("common.annualReturn"), fmtPct(s.annualReturn), benchSubAnn, s.annualReturn >= 0 ? "pos" : "neg", "annualReturn"),
    kpiCardHtml(t("common.annualVolatility"), fmtPctUnsigned(s.annualVolatility), benchSubVol, "brass", "annualVolatility"),
    kpiCardHtml(t("common.sharpeRatio"), fmtNum(s.sharpeRatio, 3), benchSubSharpe, s.sharpeRatio >= 1 ? "pos" : "", "sharpeRatio"),
    kpiCardHtml(t("common.maxDrawdown"), fmtPct(s.maximumDrawdown), benchSubDd, "neg", "maxDrawdown"),
    sixthCard,
  ].join("");

  document.getElementById("asset-span-badge").textContent = `${st.firstDate} → ${st.lastDate} (${st.observations}d)`;

  // Primary Chart: Wealth vs Benchmark OR Adjusted OHLC Candlesticks + Volume
  const mainTitle = document.getElementById("asset-main-chart-title");
  const mainGuide = document.getElementById("asset-main-chart-guide");
  const mainCanvas = document.getElementById("chart-asset-wealth");
  const dates = data.series.map((p) => p.date);

  if (state.assetChartMode === "candle") {
    mainTitle.textContent = t("common.candleChart");
    if (mainGuide) {
      mainGuide.setAttribute("data-i18n", "panelGuides.assetCandle");
      mainGuide.textContent = t("panelGuides.assetCandle");
    }
    renderCandlestickChart(mainCanvas, {
      ticker: data.ticker,
      bars: data.series,
      logScale: state.logScale.asset,
    });
  } else {
    mainTitle.textContent = t("common.wealthCurve");
    if (mainGuide) {
      mainGuide.setAttribute("data-i18n", "panelGuides.assetWealth");
      mainGuide.textContent = t("panelGuides.assetWealth");
    }
    const wealthSeries = [
      {
        label: data.ticker,
        values: data.series.map((p) => p.wealthIndex),
        color: "#e6b963",
        area: true,
      },
    ];
    if (bc) {
      wealthSeries.push({
        label: bc.benchmarkTicker,
        values: data.series.map((p) => p.benchmarkWealthIndex),
        color: "#4cc9f0",
        dashed: true,
      });
    }
    renderTimeSeriesChart(mainCanvas, {
      dates,
      series: wealthSeries,
      baselineValue: 1.0,
      logScale: state.logScale.asset,
      yFormat: fmtWealth,
    });
  }

  const ddSeries = [
    {
      label: `${data.ticker} DD`,
      values: data.series.map((p) => p.drawdown),
      color: "#f43f5e",
    },
  ];
  if (bc) {
    ddSeries.push({
      label: `${bc.benchmarkTicker} DD`,
      values: data.series.map((p) => p.benchmarkDrawdown),
      color: "#4cc9f0",
      dashed: true,
    });
  }

  renderTimeSeriesChart(document.getElementById("chart-asset-drawdown"), {
    dates,
    series: ddSeries,
    baselineValue: 0.0,
    fillZeroFloor: true,
    yFormat: (v) => `${(v * 100).toFixed(1)}%`,
  });

  renderMonthlyHeatmap("asset-monthly-heatmap", data.monthlyReturns);

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
function renderCompareTickerInputs() {
  const container = document.getElementById("compare-ticker-list");
  if (!container) return;
  container.innerHTML = state.compareTickers
    .map(
      (sym, idx) => `
      <div class="ticker-slot">
        <span class="ticker-slot-lbl">#${idx + 1}</span>
        <input class="metal-input compare-ticker-inp" type="text" autocomplete="off" placeholder="US e.g. KO" value="${sym}" data-idx="${idx}" required />
        <button type="button" class="icon-del-btn compare-ticker-del" data-idx="${idx}" ${state.compareTickers.length <= 1 ? "disabled" : ""}>×</button>
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".compare-ticker-inp").forEach((inp) => {
    const idx = Number(inp.dataset.idx);
    inp.addEventListener("input", (e) => {
      state.compareTickers[idx] = e.target.value.trim().toUpperCase();
    });
    attachTickerAutocomplete(inp, (picked) => {
      state.compareTickers[idx] = picked;
    });
  });

  container.querySelectorAll(".compare-ticker-del").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const i = Number(e.currentTarget.dataset.idx);
      if (state.compareTickers.length > 1) {
        state.compareTickers.splice(i, 1);
        renderCompareTickerInputs();
      }
    });
  });
}

async function runAssetComparison() {
  const btn = document.getElementById("btn-run-compare");
  btn.disabled = true;
  btn.textContent = t("common.running");
  try {
    const tickers = state.compareTickers
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!tickers.length) {
      throw new Error(state.lang === "zh" ? "请至少输入一个股票代码。" : "Please enter at least one ticker.");
    }
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

function buildCompareGuide(data) {
  const sortedBySharpe = [...data.assets].sort((a, b) => b.sharpeRatio - a.sharpeRatio);
  const top = sortedBySharpe[0];
  const calmest = [...data.assets].sort((a, b) => a.annualVolatility - b.annualVolatility)[0];
  if (!top) return { body: "", pills: [] };

  if (state.lang === "zh") {
    return {
      body: `在共同对齐的 <strong>${data.observations}</strong> 个交易日里，综合风险收益性价比最高的是 <strong>${top.ticker}</strong>（年化 <strong>${fmtPct(top.annualReturn)}</strong>，夏普 <strong>${top.sharpeRatio.toFixed(2)}</strong>）；走势最稳健的是 <strong>${calmest.ticker}</strong>（波动率 ${fmtPctUnsigned(calmest.annualVolatility)}）。右下角相关系数矩阵越接近 0 或负数，说明两只资产越适合搭配在一起分散风险。`,
      pills: [`最高性价比：${top.ticker}`, `最低波动：${calmest.ticker}`, `基准：${data.benchmark}`],
    };
  }
  return {
    body: `Across <strong>${data.observations}</strong> aligned trading days, <strong>${top.ticker}</strong> delivered the highest risk-adjusted return (<strong>${fmtPct(top.annualReturn)}</strong>/yr, Sharpe <strong>${top.sharpeRatio.toFixed(2)}</strong>), while <strong>${calmest.ticker}</strong> was the steadiest (volatility ${fmtPctUnsigned(calmest.annualVolatility)}). Lower values in the correlation matrix indicate stronger diversification benefits.`,
    pills: [`Top Sharpe: ${top.ticker}`, `Lowest Vol: ${calmest.ticker}`, `Benchmark: ${data.benchmark}`],
  };
}

function renderCompareView(data) {
  const guide = buildCompareGuide(data);
  renderGuidedBanner("guided-compare", guide.body, guide.pills);

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
    logScale: state.logScale.compare,
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
function _distributeRemainder(rem, baseWeights) {
  const k = baseWeights.length;
  const baseSum = baseWeights.reduce((a, b) => a + b, 0) || k;
  const raw = baseWeights.map((b) => (rem * b) / baseSum);
  const alloc = raw.map((r) => Math.max(1, Math.floor(r)));
  let diff = rem - alloc.reduce((a, b) => a + b, 0);

  if (diff > 0) {
    const order = raw
      .map((r, idx) => ({ idx, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac);
    for (let p = 0; p < diff; p++) {
      alloc[order[p % k].idx] += 1;
    }
  } else if (diff < 0) {
    let safety = 0;
    while (diff < 0 && safety++ < 300) {
      const order = alloc
        .map((v, idx) => ({ idx, v }))
        .sort((a, b) => b.v - a.v);
      let changed = false;
      for (const item of order) {
        if (diff === 0) break;
        if (alloc[item.idx] > 1) {
          alloc[item.idx] -= 1;
          diff += 1;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  return alloc;
}

function renderAllocationControls() {
  const container = document.getElementById("portfolio-alloc-list");
  const n = state.allocations.length;
  const maxForOne = Math.max(1, 100 - (n - 1));

  container.innerHTML = state.allocations
    .map(
      (item, idx) => `
      <div class="alloc-row" data-idx="${idx}">
        <input class="metal-input alloc-ticker-inp" type="text" autocomplete="off" placeholder="US e.g. KO" value="${item.ticker}" data-idx="${idx}" />
        <input class="alloc-slider" type="range" min="1" max="${maxForOne}" step="1" value="${Math.min(maxForOne, Math.max(1, item.weight))}" style="--pct:${Math.min(100, Math.max(0, ((Math.min(maxForOne, Math.max(1, item.weight)) - 1) / Math.max(1, maxForOne - 1)) * 100))}%;" data-idx="${idx}" />
        <input class="metal-input alloc-weight-inp" type="number" min="1" max="${maxForOne}" step="0.5" value="${item.weight}" data-idx="${idx}" />
        <button type="button" class="icon-del-btn" data-idx="${idx}" ${n <= 2 ? "disabled" : ""}>×</button>
      </div>
    `
    )
    .join("");

  updateAllocSumBadge();

  container.querySelectorAll(".alloc-ticker-inp").forEach((inp) => {
    const idx = Number(inp.dataset.idx);
    inp.addEventListener("change", (e) => {
      state.allocations[idx].ticker = e.target.value.trim().toUpperCase();
    });
    attachTickerAutocomplete(inp, (picked) => {
      state.allocations[idx].ticker = picked;
    });
  });

  // Update slider fill & numeric box in-place (ZERO DOM rebuild during drag -> 60fps silky smooth!)
  const syncSliderVisual = (index, val) => {
    const clamped = Math.min(maxForOne, Math.max(1, val));
    const fillPct = ((clamped - 1) / Math.max(1, maxForOne - 1)) * 100;
    const slEl = container.querySelector(`.alloc-slider[data-idx="${index}"]`);
    const numEl = container.querySelector(`.alloc-weight-inp[data-idx="${index}"]`);
    if (slEl) {
      slEl.value = clamped;
      slEl.style.setProperty("--pct", `${fillPct.toFixed(1)}%`);
    }
    if (numEl) {
      numEl.value = val;
    }
  };

  let dragSnapshot = null;

  container.querySelectorAll(".alloc-slider").forEach((sl) => {
    const captureBaseline = () => {
      const i = Number(sl.dataset.idx);
      dragSnapshot = {
        idx: i,
        weights: state.allocations.map((a) => Math.max(0.5, Number(a.weight) || 1)),
      };
    };
    sl.addEventListener("pointerdown", captureBaseline);
    sl.addEventListener("mousedown", captureBaseline);
    sl.addEventListener("touchstart", captureBaseline, { passive: true });
    sl.addEventListener("change", () => {
      dragSnapshot = null;
    });

    sl.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.idx);
      const val = Math.min(maxForOne, Math.max(1, Math.round(Number(e.target.value))));
      if (!dragSnapshot || dragSnapshot.idx !== i) {
        captureBaseline();
      }

      // Proportional N-asset auto-balance strictly locked to 100%
      const otherIndices = [];
      const otherBase = [];
      for (let j = 0; j < n; j++) {
        if (j !== i) {
          otherIndices.push(j);
          otherBase.push(dragSnapshot.weights[j]);
        }
      }
      const distributed = _distributeRemainder(100 - val, otherBase);

      state.allocations[i].weight = val;
      syncSliderVisual(i, val);
      otherIndices.forEach((otherIdx, k) => {
        state.allocations[otherIdx].weight = distributed[k];
        syncSliderVisual(otherIdx, distributed[k]);
      });

      updateAllocSumBadge();
    });
  });

  // Manual numeric input: allow free typing without interrupting cursor, intercept via SUM guardrail
  container.querySelectorAll(".alloc-weight-inp").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      dragSnapshot = null;
      const i = Number(e.target.dataset.idx);
      const raw = Number(e.target.value);
      const val = Number.isFinite(raw) ? raw : 0;
      state.allocations[i].weight = val;
      const clamped = Math.min(maxForOne, Math.max(1, val));
      const fillPct = ((clamped - 1) / Math.max(1, maxForOne - 1)) * 100;
      const sl = container.querySelector(`.alloc-slider[data-idx="${i}"]`);
      if (sl) {
        sl.value = clamped;
        sl.style.setProperty("--pct", `${fillPct.toFixed(1)}%`);
      }
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
  const runBtn = document.getElementById("btn-run-portfolio");
  const diff = sum - 100;
  const ok = Math.abs(diff) <= 0.05 && state.allocations.every((a) => Number(a.weight) > 0);

  badge.classList.remove("sum-err", "sum-warn");
  if (ok) {
    badge.innerHTML = `<span class="led-dot"></span><span>SUM: 100%</span>`;
  } else if (diff > 0) {
    badge.classList.add("sum-err");
    badge.innerHTML = `<span class="led-dot red"></span><span>SUM: ${sum.toFixed(1)}% (+${diff.toFixed(1)}%)</span>`;
  } else {
    badge.classList.add("sum-warn");
    badge.innerHTML = `<span class="led-dot amber"></span><span>SUM: ${sum.toFixed(1)}% (${diff.toFixed(1)}%)</span>`;
  }

  if (runBtn && runBtn.textContent !== t("common.running")) {
    runBtn.disabled = !ok;
  }
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

function buildPortfolioGuide(data) {
  const s = data.summary;
  const fr = data.frontier;
  const endMoney = 10000 * (1 + s.totalReturn);
  const avgAssetVol =
    data.assetBreakdown.reduce((acc, a) => acc + a.weight * a.annualVolatility, 0);
  const volSaved = Math.max(0, avgAssetVol - s.annualVolatility);

  if (state.lang === "zh") {
    return {
      body: `按你当前设置的配比（<strong>${formatWeightMap(data.weights)}</strong>），期初投入 $10,000 期末将增长至 <strong>${fmtMoney(endMoney)}</strong>（年化 <strong>${fmtPct(s.annualReturn)}</strong>）。由于资产涨跌不完全同步，组合分散效应帮你凭空压低了约 <strong>${fmtPctUnsigned(volSaved)}</strong> 的年化波动率！如果你想追求历史最高性价比，可以点击下方「套用此配比」一键切换到 <strong>${formatWeightMap(fr.highestSharpe.weights)}</strong>。`,
      pills: [
        `$10,000 → ${fmtMoney(endMoney)}`,
        `分散化降波：-${fmtPctUnsigned(volSaved)}`,
        `推荐最高夏普：${formatWeightMap(fr.highestSharpe.weights)}`,
      ],
    };
  }
  return {
    body: `With your active mix (<strong>${formatWeightMap(data.weights)}</strong>), $10,000 invested at the start grew to <strong>${fmtMoney(endMoney)}</strong> (<strong>${fmtPct(s.annualReturn)}</strong>/yr). Diversification reduced annualized volatility by roughly <strong>${fmtPctUnsigned(volSaved)}</strong> compared to the weighted average of individual assets. Click "Apply Weights" below to jump straight to the highest-Sharpe mix (<strong>${formatWeightMap(fr.highestSharpe.weights)}</strong>).`,
    pills: [
      `$10,000 → ${fmtMoney(endMoney)}`,
      `Diversification Benefit: -${fmtPctUnsigned(volSaved)} Vol`,
      `Best Sharpe: ${formatWeightMap(fr.highestSharpe.weights)}`,
    ],
  };
}

function renderPortfolioView(data) {
  const s = data.summary;
  const bc = data.benchmarkComparison;
  const fr = data.frontier;

  const guide = buildPortfolioGuide(data);
  renderGuidedBanner("guided-portfolio", guide.body, guide.pills);

  document.getElementById("port-span-badge").textContent =
    `${data.alignedStartDate} → ${data.alignedEndDate} (${data.observations}d)`;

  document.getElementById("portfolio-kpis").innerHTML = [
    kpiCardHtml(
      t("common.totalReturn"),
      fmtPct(s.totalReturn),
      bc ? `vs ${bc.benchmarkTicker} ${fmtPct(bc.benchmarkSummary.totalReturn)}` : formatWeightMap(data.weights),
      s.totalReturn >= 0 ? "pos" : "neg",
      "totalReturn"
    ),
    kpiCardHtml(
      t("common.annualReturn"),
      fmtPct(s.annualReturn),
      bc ? `Alpha ${fmtPct(bc.annualReturnDifference)}` : "252d Annualized",
      s.annualReturn >= 0 ? "pos" : "neg",
      "annualReturn"
    ),
    kpiCardHtml(t("common.annualVolatility"), fmtPctUnsigned(s.annualVolatility), "Portfolio StdDev", "brass", "annualVolatility"),
    kpiCardHtml(t("common.sharpeRatio"), fmtNum(s.sharpeRatio, 3), "Risk-Adjusted", "pos", "sharpeRatio"),
    kpiCardHtml(t("common.maxDrawdown"), fmtPct(s.maximumDrawdown), "Portfolio Peak-to-Trough", "neg", "maxDrawdown"),
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
    logScale: state.logScale.portfolio,
    yFormat: fmtWealth,
  });

  renderMonthlyHeatmap("portfolio-monthly-heatmap", data.monthlyReturns);

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

function buildStratSingleGuide(data) {
  const st = data.strategySummary;
  const bh = data.buyHoldSummary;
  const ts = data.tradeStats;
  const beatReturn = st.totalReturn > bh.totalReturn;
  const betterDd = st.maximumDrawdown > bh.maximumDrawdown;

  if (state.lang === "zh") {
    return {
      body: `这条策略的规则很简单：当 <strong>${data.shortWindow}日均线</strong> 高于 <strong>${data.longWindow}日均线</strong> 时，在第二天开盘满仓买入 ${data.ticker}；反之次日开盘清仓避险（每次调仓扣除 ${data.costBps} bps 手续费）。回测结果显示：策略总收益为 <strong>${fmtPct(st.totalReturn)}</strong>，${beatReturn ? "跑赢了" : "落后于"}一直拿着不动的 Buy & Hold（<strong>${fmtPct(bh.totalReturn)}</strong>）；但在控制下跌方面，策略最大回撤为 <strong>${fmtPct(st.maximumDrawdown)}</strong>，${betterDd ? "明显小于" : "大于"}死拿的 ${fmtPct(bh.maximumDrawdown)}。`,
      pills: [
        `调仓次数：${ts.totalTrades} 次`,
        `空仓避险时间：${fmtPctUnsigned(1 - ts.exposureRatio, 1)}`,
        `累计手续费损耗：${fmtPctUnsigned(ts.totalCostDrag, 2)}`,
      ],
    };
  }
  return {
    body: `This rule goes 100% long ${data.ticker} at next-day open whenever its <strong>${data.shortWindow}-day SMA</strong> exceeds its <strong>${data.longWindow}-day SMA</strong>, and moves to cash otherwise (paying ${data.costBps} bps per trade). Over the period, the strategy returned <strong>${fmtPct(st.totalReturn)}</strong> (${beatReturn ? "beating" : "trailing"} Buy & Hold's <strong>${fmtPct(bh.totalReturn)}</strong>), with a max drawdown of <strong>${fmtPct(st.maximumDrawdown)}</strong> vs. ${fmtPct(bh.maximumDrawdown)} for Buy & Hold.`,
    pills: [
      `Executions: ${ts.totalTrades}`,
      `Time in Cash: ${fmtPctUnsigned(1 - ts.exposureRatio, 1)}`,
      `Fee Drag: ${fmtPctUnsigned(ts.totalCostDrag, 2)}`,
    ],
  };
}

function renderStratSingleView(data) {
  const st = data.strategySummary;
  const bh = data.buyHoldSummary;
  const ts = data.tradeStats;

  const guide = buildStratSingleGuide(data);
  renderGuidedBanner("guided-strat-single", guide.body, guide.pills);

  document.getElementById("strat-span-badge").textContent =
    `${data.comparisonStart} → ${data.comparisonEnd} (${data.backtestObservations}d)`;

  document.getElementById("strat-kpis").innerHTML = [
    kpiCardHtml(
      `${t("common.strategy")} ${t("common.totalReturn")}`,
      fmtPct(st.totalReturn),
      `Buy & Hold ${fmtPct(bh.totalReturn)}`,
      st.totalReturn >= 0 ? "pos" : "neg",
      "totalReturn"
    ),
    kpiCardHtml(
      `${t("common.strategy")} ${t("common.annualReturn")}`,
      fmtPct(st.annualReturn),
      `Buy & Hold ${fmtPct(bh.annualReturn)}`,
      st.annualReturn >= 0 ? "pos" : "neg",
      "annualReturn"
    ),
    kpiCardHtml(
      `${t("common.strategy")} Sharpe`,
      fmtNum(st.sharpeRatio, 3),
      `Buy & Hold ${fmtNum(bh.sharpeRatio, 3)}`,
      st.sharpeRatio >= bh.sharpeRatio ? "pos" : "brass",
      "sharpeRatio"
    ),
    kpiCardHtml(
      `${t("common.strategy")} ${t("common.maxDrawdown")}`,
      fmtPct(st.maximumDrawdown),
      `Buy & Hold ${fmtPct(bh.maximumDrawdown)}`,
      "neg",
      "maxDrawdown"
    ),
    kpiCardHtml(
      t("strategyPage.totalTrades"),
      `${ts.totalTrades}`,
      `BUY ${ts.buyTrades} / EXIT ${ts.sellTrades} · ${data.costBps} bps`,
      "brass",
      "totalTrades"
    ),
    kpiCardHtml(
      t("strategyPage.exposure"),
      fmtPctUnsigned(ts.exposureRatio, 1),
      `${t("strategyPage.costDrag")} ${fmtPctUnsigned(ts.totalCostDrag, 2)}`,
      "cyan",
      "exposure"
    ),
  ].join("");

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

  const eqDates = data.equitySeries.map((r) => r.date);
  renderTimeSeriesChart(document.getElementById("chart-strat-equity"), {
    dates: eqDates,
    series: [
      { label: `SMA(${data.shortWindow}/${data.longWindow})`, values: data.equitySeries.map((r) => r.strategyWealth), color: "#e6b963", area: true },
      { label: "Buy & Hold", values: data.equitySeries.map((r) => r.buyHoldWealth), color: "#4cc9f0", dashed: true },
    ],
    baselineValue: 1.0,
    logScale: state.logScale.strategy,
    yFormat: fmtWealth,
  });

  renderMonthlyHeatmap("strat-monthly-heatmap", data.monthlyReturns);

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

function renderWindowChipGroup(containerId, optionsKey, selectedKey, minVal, maxVal) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const options = [...state[optionsKey]].sort((a, b) => a - b);
  const selectedSet = new Set(state[selectedKey]);

  const chipsHtml = options
    .map((val) => {
      const isSel = selectedSet.has(val);
      return `<button type="button" class="win-chip ${isSel ? "selected" : ""}" data-val="${val}">${val}d${isSel ? " ✓" : ""}</button>`;
    })
    .join("");

  container.innerHTML = `
    ${chipsHtml}
    <span class="win-custom-wrap">
      <input type="number" class="metal-input win-custom-input" min="${minVal}" max="${maxVal}" placeholder="${t("portfolioPage.customDays")}" />
      <button type="button" class="steel-chip win-custom-add">+</button>
    </span>
  `;

  container.querySelectorAll(".win-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = Number(btn.dataset.val);
      const cur = new Set(state[selectedKey]);
      if (cur.has(v)) {
        if (cur.size > 1) cur.delete(v);
      } else {
        cur.add(v);
      }
      state[selectedKey] = Array.from(cur).sort((a, b) => a - b);
      renderWindowChipGroup(containerId, optionsKey, selectedKey, minVal, maxVal);
    });
  });

  const inp = container.querySelector(".win-custom-input");
  const addBtn = container.querySelector(".win-custom-add");
  const addCustom = () => {
    const val = Math.round(Number(inp.value));
    if (!Number.isFinite(val) || val < minVal || val > maxVal) return;
    if (!state[optionsKey].includes(val)) state[optionsKey].push(val);
    if (!state[selectedKey].includes(val)) state[selectedKey].push(val);
    state[selectedKey].sort((a, b) => a - b);
    renderWindowChipGroup(containerId, optionsKey, selectedKey, minVal, maxVal);
  };
  addBtn.addEventListener("click", addCustom);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustom();
    }
  });
}

function renderAllWindowChips() {
  renderWindowChipGroup("opt-short-chips", "optShortOptions", "optSelectedShorts", 2, 250);
  renderWindowChipGroup("opt-long-chips", "optLongOptions", "optSelectedLongs", 5, 400);
}

async function runStrategyOptimize() {
  const btn = document.getElementById("btn-run-opt");
  btn.disabled = true;
  btn.textContent = t("common.running");
  try {
    const ticker = document.getElementById("opt-ticker").value.trim().toUpperCase();
    const shortWindows = [...state.optSelectedShorts];
    const longWindows = [...state.optSelectedLongs];
    if (!shortWindows.length || !longWindows.length) {
      throw new Error(
        state.lang === "zh"
          ? "请至少各选择一个短期和长期均线窗口。"
          : "Select at least one short window and one long window."
      );
    }
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

function buildStratOptGuide(data) {
  const oos = data.outOfSampleValidation;
  const oosSt = oos.testingStrategySummary;
  const oosBh = oos.testingBuyHoldSummary;
  const decayed = oosSt.sharpeRatio < oos.bestTrainingResult.sharpeRatio;

  if (state.lang === "zh") {
    return {
      body: `为了防止「事后诸葛亮（过拟合）」，系统只用前 <strong>${(oos.trainRatio * 100).toFixed(0)}%</strong> 的历史数据挑出了表现最好的参数 <strong>SMA ${oos.selectedShortWindow}/${oos.selectedLongWindow}</strong>（训练期夏普 ${oos.bestTrainingResult.sharpeRatio.toFixed(2)}），再拿去后 <strong>${((1 - oos.trainRatio) * 100).toFixed(0)}%</strong> 从未见过的新行情里做盲测：样本外夏普为 <strong>${oosSt.sharpeRatio.toFixed(2)}</strong>（同期买入持有为 ${oosBh.sharpeRatio.toFixed(2)}）${decayed ? "，相对训练期有所衰减——这正是实证研究中常见的样本外过拟合现象" : "，在未见数据上保持了较好的稳健性"}。`,
      pills: [
        `训练集选中：SMA ${oos.selectedShortWindow}/${oos.selectedLongWindow}`,
        `训练期夏普 ${oos.bestTrainingResult.sharpeRatio.toFixed(2)} → 样本外 ${oosSt.sharpeRatio.toFixed(2)}`,
      ],
    };
  }
  return {
    body: `To guard against hindsight bias (overfitting), the engine selected <strong>SMA ${oos.selectedShortWindow}/${oos.selectedLongWindow}</strong> using only the first <strong>${(oos.trainRatio * 100).toFixed(0)}%</strong> of data (In-Sample Sharpe ${oos.bestTrainingResult.sharpeRatio.toFixed(2)}), then blind-tested it on the remaining unseen period. Out-of-sample Sharpe came in at <strong>${oosSt.sharpeRatio.toFixed(2)}</strong> vs. ${oosBh.sharpeRatio.toFixed(2)} for Buy & Hold${decayed ? " — illustrating classic out-of-sample decay" : " — holding up well on unseen data"}.`,
    pills: [
      `Selected: SMA ${oos.selectedShortWindow}/${oos.selectedLongWindow}`,
      `Train Sharpe ${oos.bestTrainingResult.sharpeRatio.toFixed(2)} → Test ${oosSt.sharpeRatio.toFixed(2)}`,
    ],
  };
}

function renderStratOptView(data) {
  const oos = data.outOfSampleValidation;
  const grid = data.parameterComparison;
  const oosSt = oos.testingStrategySummary;
  const oosBh = oos.testingBuyHoldSummary;

  const guide = buildStratOptGuide(data);
  renderGuidedBanner("guided-strat-opt", guide.body, guide.pills);

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
      oosSt.totalReturn >= 0 ? "pos" : "neg",
      "totalReturn"
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
      oosSt.sharpeRatio >= oosBh.sharpeRatio ? "pos" : "",
      "sharpeRatio"
    ),
    kpiCardHtml(
      "OOS Max Drawdown",
      fmtPct(oosSt.maximumDrawdown),
      `Buy & Hold ${fmtPct(oosBh.maximumDrawdown)}`,
      "neg",
      "maxDrawdown"
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

/* ==================== NAVIGATION, EXPORTS & EVENTS ==================== */
function closeMobileMenu() {
  document.getElementById("sidebar-rail").classList.remove("open");
  document.getElementById("mobile-backdrop").classList.remove("open");
}

function switchPage(page) {
  state.activePage = page;
  closeMobileMenu();
  showError(null);
  document.querySelectorAll(".nav-btn, .mobile-nav-tab").forEach((b) => {
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

function setViewMode(mode) {
  state.viewMode = mode === "guide" ? "guide" : "pro";
  document.body.classList.toggle("guide-mode", state.viewMode === "guide");
  document.querySelectorAll(".mode-opt").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === state.viewMode)
  );
  rerenderActiveViews();
}

function renderLatexFormulas() {
  if (!window.katex) return;
  document.querySelectorAll(".latex-formula[data-latex]").forEach((el) => {
    if (el.dataset.rendered === "1") return;
    try {
      window.katex.render(el.dataset.latex, el, {
        displayMode: true,
        throwOnError: false,
      });
      el.dataset.rendered = "1";
    } catch {
      // Keep native MathML fallback if KaTeX throws
    }
  });
}

function initEvents() {
  // Welcome entry modal mode selection
  const welcomeOverlay = document.getElementById("welcome-overlay");
  document.querySelectorAll("[data-choose-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const chosen = btn.dataset.chooseMode;
      try {
        sessionStorage.setItem("ml_mode_chosen", chosen);
      } catch {
        // ignore storage restrictions
      }
      welcomeOverlay.classList.add("hidden");
      setViewMode(chosen);
    });
  });

  // Prevent accidental pinch-zoom & double-tap zoom on iOS Safari / standalone PWA
  ["gesturestart", "gesturechange", "gestureend"].forEach((evt) => {
    document.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
  });
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

  // Clicking brand logo/header navigates smoothly to Home (01 Asset Terminal)
  const goHome = () => {
    switchPage("asset");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const brandPlate = document.querySelector(".brand-plate");
  if (brandPlate) {
    brandPlate.style.cursor = "pointer";
    brandPlate.title = "AlphaMetric Home";
    brandPlate.addEventListener("click", goHome);
  }
  const mobileBrand = document.querySelector(".mobile-brand");
  if (mobileBrand) {
    mobileBrand.addEventListener("click", goHome);
  }

  // Mobile drawer
  document.getElementById("btn-mobile-menu").addEventListener("click", () => {
    document.getElementById("sidebar-rail").classList.toggle("open");
    document.getElementById("mobile-backdrop").classList.toggle("open");
  });
  document.getElementById("mobile-backdrop").addEventListener("click", closeMobileMenu);

  // Navigation (Desktop sidebar + Mobile top module rail)
  document.querySelectorAll(".nav-btn, .mobile-nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchPage(btn.dataset.page);
      if (btn.dataset.page === "methodology") renderLatexFormulas();
      if (btn.classList.contains("mobile-nav-tab")) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  });

  // PRO | GUIDE dual mode switch
  document.querySelectorAll(".mode-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      try {
        sessionStorage.setItem("ml_mode_chosen", btn.dataset.mode);
      } catch {
        // ignore
      }
      setViewMode(btn.dataset.mode);
    });
  });

  // EN | ZH language switch (syncs both modal & top bar switches)
  document.querySelectorAll(".lang-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.lang = btn.dataset.lang;
      document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
      document.querySelectorAll(".lang-opt").forEach((b) =>
        b.classList.toggle("active", b.dataset.lang === state.lang)
      );
      applyStaticI18n();
    });
  });

  // Asset chart mode (Wealth vs OHLC Candlestick)
  document.querySelectorAll("[data-asset-chart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.assetChartMode = btn.dataset.assetChart;
      document.querySelectorAll("[data-asset-chart]").forEach((b) =>
        b.classList.toggle("active", b.dataset.assetChart === state.assetChartMode)
      );
      if (state.cacheAsset) renderAssetView(state.cacheAsset);
    });
  });

  // LIN | LOG Scale toggles
  document.querySelectorAll("[data-scale-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.scaleTarget;
      const isLog = btn.dataset.scale === "log";
      state.logScale[target] = isLog;
      document.querySelectorAll(`[data-scale-target="${target}"]`).forEach((b) =>
        b.classList.toggle("active", b.dataset.scale === btn.dataset.scale)
      );
      rerenderActiveViews();
    });
  });

  // PNG chart downloads
  document.querySelectorAll(".btn-save-png").forEach((btn) => {
    btn.addEventListener("click", () => {
      const canvas = document.getElementById(btn.dataset.canvas);
      const name = `${btn.dataset.name || "chart"}-${new Date().toISOString().slice(0, 10)}.png`;
      exportCanvasPng(canvas, name);
    });
  });

  // Print / PDF Tear Sheet
  document.querySelectorAll(".btn-print-sheet").forEach((btn) => {
    btn.addEventListener("click", () => window.print());
  });

  // CSV Exports
  document.getElementById("btn-export-asset-csv").addEventListener("click", () => {
    const d = state.cacheAsset;
    if (!d) return;
    downloadCsv(
      `AlphaMetric_${d.ticker}_${d.stats.firstDate}_${d.stats.lastDate}.csv`,
      ["date", "adjOpen", "adjHigh", "adjLow", "adjClose", "volume", "simpleReturn", "wealthIndex", "drawdown"],
      d.series.map((r) => [r.date, r.adjOpen, r.adjHigh, r.adjLow, r.adjClose, r.volume, r.simpleReturn, r.wealthIndex, r.drawdown])
    );
  });

  document.getElementById("btn-export-port-csv").addEventListener("click", () => {
    const d = state.cachePortfolio;
    if (!d) return;
    downloadCsv(
      `AlphaMetric_Portfolio_${d.tickers.join("_")}.csv`,
      ["date", "portfolioWealthIndex", "portfolioDrawdown", "simpleReturn", "benchmarkWealthIndex"],
      d.series.map((r) => [r.date, r.wealthIndex, r.drawdown, r.simpleReturn, r.benchmarkWealthIndex ?? ""])
    );
  });

  document.getElementById("btn-export-strat-csv").addEventListener("click", () => {
    const d = state.cacheStratSingle;
    if (!d) return;
    downloadCsv(
      `AlphaMetric_SMA_${d.ticker}_${d.shortWindow}_${d.longWindow}.csv`,
      ["date", "position", "turnover", "strategyWealth", "strategyDrawdown", "buyHoldWealth", "buyHoldDrawdown"],
      d.equitySeries.map((r) => [r.date, r.position, r.turnover, r.strategyWealth, r.strategyDrawdown, r.buyHoldWealth, r.buyHoldDrawdown])
    );
  });

  // Strategy subtabs
  document.querySelectorAll(".subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchStratSubtab(btn.dataset.subtab));
  });

  // Attach smart metallic ticker autocomplete to all static ticker inputs
  attachTickerAutocomplete(document.getElementById("asset-ticker"));
  attachTickerAutocomplete(document.getElementById("compare-benchmark"));
  attachTickerAutocomplete(document.getElementById("strat-ticker"));
  attachTickerAutocomplete(document.getElementById("opt-ticker"));

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

  // Compare form, individual ticker boxes & presets
  renderCompareTickerInputs();
  document.getElementById("btn-add-compare-ticker").addEventListener("click", () => {
    if (state.compareTickers.length >= 6) return;
    const pool = ["NVDA", "GOOGL", "AMZN", "META", "QQQ", "TLT", "GLD"];
    const used = new Set(state.compareTickers);
    const next = pool.find((s) => !used.has(s)) || "NVDA";
    state.compareTickers.push(next);
    renderCompareTickerInputs();
  });

  document.getElementById("form-compare").addEventListener("submit", (e) => {
    e.preventDefault();
    runAssetComparison();
  });

  document.querySelectorAll(".compare-preset").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.compareTickers = chip.dataset.tickers
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      renderCompareTickerInputs();
      document.getElementById("compare-benchmark").value = chip.dataset.bench;
      runAssetComparison();
    });
  });

  // OOS Toggleable Window Chips
  renderAllWindowChips();

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
  initMetalSelects();
  initMetalDatePickers();
  initEvents();

  // Check if visitor already picked a mode in this browser tab session
  const welcomeOverlay = document.getElementById("welcome-overlay");
  let savedMode = null;
  try {
    savedMode = sessionStorage.getItem("ml_mode_chosen");
  } catch {
    savedMode = null;
  }
  if (savedMode === "pro" || savedMode === "guide") {
    state.viewMode = savedMode;
    document.body.classList.toggle("guide-mode", savedMode === "guide");
    document.querySelectorAll(".mode-opt").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === savedMode)
    );
    welcomeOverlay.classList.add("hidden");
  }

  applyStaticI18n();
  renderAllWindowChips();
  renderLatexFormulas();
  window.addEventListener("load", renderLatexFormulas);

  await refreshHealthSilent();
  await runAssetAnalysis();
}

boot();
