import math
import statistics
from itertools import combinations_with_replacement

import backend.app.config  # noqa: F401 - ensures research/ is on sys.path

from backtest_moving_average import (
    calculate_backtest,
    calculate_buy_and_hold,
    calculate_signals,
)
from calculate_metrics import calculate as calc_asset_metrics
from calculate_metrics import summarize as summarize_metrics
from compare_assets import calculate_comparison_from_rows
from compare_moving_averages import build_window_pairs, compare_window_pairs
from validate_moving_average import evaluate_out_of_sample, split_data


def compute_monthly_returns(
    series: list[dict],
    wealth_key: str = "wealthIndex",
) -> list[dict]:
    """Compute exact compounded monthly and annual return matrix from wealth series."""
    if not series:
        return []

    month_end_wealth: dict[tuple[int, int], float] = {}
    for pt in series:
        d = pt["date"]
        w = pt.get(wealth_key)
        if w is None or not math.isfinite(w) or w <= 0:
            continue
        yr = int(d[:4])
        mo = int(d[5:7])
        month_end_wealth[(yr, mo)] = float(w)

    if not month_end_wealth:
        return []

    ordered_keys = sorted(month_end_wealth.keys())
    by_year: dict[int, dict[str, float]] = {}
    year_start_wealth: dict[int, float] = {}
    year_end_wealth: dict[int, float] = {}

    prev_wealth = 1.0
    for yr, mo in ordered_keys:
        if yr not in year_start_wealth:
            year_start_wealth[yr] = prev_wealth
        cur_wealth = month_end_wealth[(yr, mo)]
        m_ret = cur_wealth / prev_wealth - 1.0
        by_year.setdefault(yr, {})[str(mo)] = m_ret
        year_end_wealth[yr] = cur_wealth
        prev_wealth = cur_wealth

    return [
        {
            "year": yr,
            "months": by_year[yr],
            "ytd": year_end_wealth[yr] / year_start_wealth[yr] - 1.0,
        }
        for yr in sorted(by_year.keys())
    ]


def align_series_by_date(
    series_map: dict[str, list[dict]],
) -> tuple[dict[str, list[dict]], list[str]]:
    """Intersect trading dates across multiple ticker series chronologically."""
    if not series_map:
        raise ValueError("No asset price series provided.")

    date_sets = []
    indexed: dict[str, dict[str, dict]] = {}
    for ticker, rows in series_map.items():
        if not rows:
            raise ValueError(f"Price series for {ticker} is empty.")
        by_date: dict[str, dict] = {}
        for row in rows:
            d = row["date"][:10]
            row_copy = dict(row)
            row_copy["date"] = d
            by_date[d] = row_copy
        indexed[ticker] = by_date
        date_sets.append(set(by_date.keys()))

    common_dates = sorted(set.intersection(*date_sets))
    if len(common_dates) < 3:
        raise ValueError(
            "At least 3 overlapping trading days are required across all selected tickers."
        )

    aligned = {
        ticker: [by_date[d] for d in common_dates]
        for ticker, by_date in indexed.items()
    }
    return aligned, common_dates


def analyze_single_asset(
    ticker: str,
    asset_rows: list[dict],
    benchmark_ticker: str | None = None,
    benchmark_rows: list[dict] | None = None,
) -> dict:
    if benchmark_ticker and benchmark_rows and benchmark_ticker != ticker:
        aligned, common_dates = align_series_by_date(
            {ticker: asset_rows, benchmark_ticker: benchmark_rows}
        )
        a_rows = aligned[ticker]
        b_rows = aligned[benchmark_ticker]
    else:
        a_rows = sorted(
            [{**r, "date": r["date"][:10]} for r in asset_rows],
            key=lambda r: r["date"],
        )
        b_rows = None
        common_dates = [r["date"] for r in a_rows]

    if len(a_rows) < 3:
        raise ValueError(f"Not enough observations for {ticker} (minimum 3 trading days).")

    asset_series = calc_asset_metrics(a_rows)
    asset_summary = summarize_metrics(asset_series)

    daily_returns = [
        r["simpleReturn"] for r in asset_series if r["simpleReturn"] is not None
    ]
    positive_days = sum(1 for r in daily_returns if r > 0)
    best_day_row = max(
        (r for r in asset_series if r["simpleReturn"] is not None),
        key=lambda r: r["simpleReturn"],
    )
    worst_day_row = min(
        (r for r in asset_series if r["simpleReturn"] is not None),
        key=lambda r: r["simpleReturn"],
    )

    extra_stats = {
        "observations": len(asset_series),
        "firstDate": common_dates[0],
        "lastDate": common_dates[-1],
        "startAdjClose": float(a_rows[0]["adjClose"]),
        "endAdjClose": float(a_rows[-1]["adjClose"]),
        "positiveDaysRatio": positive_days / len(daily_returns),
        "bestDayReturn": best_day_row["simpleReturn"],
        "bestDayDate": best_day_row["date"],
        "worstDayReturn": worst_day_row["simpleReturn"],
        "worstDayDate": worst_day_row["date"],
    }

    comparison_info = None
    bench_series_by_date: dict[str, dict] = {}
    if b_rows is not None and benchmark_ticker:
        comp = calculate_comparison_from_rows(
            a_rows, b_rows, ticker, benchmark_ticker
        )
        b_calc = calc_asset_metrics(b_rows)
        bench_series_by_date = {r["date"]: r for r in b_calc}
        comparison_info = {
            "benchmarkTicker": benchmark_ticker,
            "benchmarkSummary": comp["benchmarkSummary"],
            "annualReturnDifference": comp["annualReturnDifference"],
            "returnCorrelation": comp["returnCorrelation"],
            "beta": comp["beta"],
        }

    raw_by_date = {r["date"][:10]: r for r in a_rows}
    merged_series = []
    for item in asset_series:
        d = item["date"]
        raw = raw_by_date[d]
        adj_c = item["adjClose"]
        adj_o = float(raw.get("adjOpen", adj_c))
        adj_h = float(raw.get("adjHigh", max(adj_o, adj_c)))
        adj_l = float(raw.get("adjLow", min(adj_o, adj_c)))
        point = {
            "date": d,
            "adjOpen": adj_o,
            "adjHigh": adj_h,
            "adjLow": adj_l,
            "adjClose": adj_c,
            "close": float(raw.get("close", adj_c)),
            "volume": float(raw.get("volume", 0.0)),
            "simpleReturn": item["simpleReturn"],
            "wealthIndex": item["wealthIndex"],
            "drawdown": item["drawdown"],
        }
        if d in bench_series_by_date:
            b_pt = bench_series_by_date[d]
            point["benchmarkWealthIndex"] = b_pt["wealthIndex"]
            point["benchmarkDrawdown"] = b_pt["drawdown"]
        merged_series.append(point)

    return {
        "ticker": ticker,
        "summary": asset_summary,
        "stats": extra_stats,
        "benchmarkComparison": comparison_info,
        "monthlyReturns": compute_monthly_returns(merged_series, "wealthIndex"),
        "series": merged_series,
    }


def compare_multiple_assets(
    tickers: list[str],
    benchmark: str,
    raw_series_map: dict[str, list[dict]],
) -> dict:
    aligned, common_dates = align_series_by_date(raw_series_map)
    bench_rows = aligned[benchmark]
    bench_calc = calc_asset_metrics(bench_rows)
    bench_summary = summarize_metrics(bench_calc)

    ordered_all = list(dict.fromkeys([*tickers, benchmark]))
    calc_map: dict[str, list[dict]] = {benchmark: bench_calc}
    returns_map: dict[str, list[float]] = {
        benchmark: [
            r["simpleReturn"] for r in bench_calc if r["simpleReturn"] is not None
        ]
    }

    comparisons = []
    for t in tickers:
        if t == benchmark:
            comparisons.append(
                {
                    "ticker": t,
                    **bench_summary,
                    "annualReturnDifference": 0.0,
                    "returnCorrelation": 1.0,
                    "beta": 1.0,
                }
            )
            continue

        comp = calculate_comparison_from_rows(
            aligned[t], bench_rows, t, benchmark
        )
        t_calc = calc_asset_metrics(aligned[t])
        calc_map[t] = t_calc
        returns_map[t] = [
            r["simpleReturn"] for r in t_calc if r["simpleReturn"] is not None
        ]
        comparisons.append(
            {
                "ticker": t,
                **comp["assetSummary"],
                "annualReturnDifference": comp["annualReturnDifference"],
                "returnCorrelation": comp["returnCorrelation"],
                "beta": comp["beta"],
            }
        )

    correlation_matrix = []
    for t1 in ordered_all:
        row_vals = []
        for t2 in ordered_all:
            if t1 == t2:
                row_vals.append(1.0)
            else:
                try:
                    corr = statistics.correlation(returns_map[t1], returns_map[t2])
                except statistics.StatisticsError:
                    corr = 0.0
                row_vals.append(corr)
        correlation_matrix.append({"ticker": t1, "values": row_vals})

    timeline = []
    for idx, d in enumerate(common_dates):
        entry = {"date": d, "wealth": {}, "drawdown": {}}
        for sym in ordered_all:
            pt = calc_map[sym][idx]
            entry["wealth"][sym] = pt["wealthIndex"]
            entry["drawdown"][sym] = pt["drawdown"]
        timeline.append(entry)

    return {
        "benchmark": benchmark,
        "benchmarkSummary": bench_summary,
        "alignedStartDate": common_dates[0],
        "alignedEndDate": common_dates[-1],
        "observations": len(common_dates),
        "symbols": ordered_all,
        "assets": comparisons,
        "correlationMatrix": correlation_matrix,
        "timeline": timeline,
    }


def build_portfolio_from_rows(
    datasets: list[list[dict]],
    weights: list[float],
) -> list[dict]:
    if len(datasets) < 2:
        raise ValueError("A portfolio requires at least two assets.")
    if len(datasets) != len(weights):
        raise ValueError("Number of assets and weights must match.")
    if any(not math.isfinite(w) or w < 0 for w in weights):
        raise ValueError("Portfolio weights cannot be negative.")
    if not math.isclose(sum(weights), 1.0, abs_tol=1e-6):
        raise ValueError("Portfolio weights must sum to 1.0 (100%).")

    dates = [r["date"] for r in datasets[0]]
    first_prices = [float(ds[0]["adjClose"]) for ds in datasets]

    previous_value = None
    peak = 1.0
    results = []

    for idx, current_date in enumerate(dates):
        portfolio_value = 0.0
        for ds, first_px, w in zip(datasets, first_prices, weights):
            px = float(ds[idx]["adjClose"])
            if not math.isfinite(px) or px <= 0:
                raise ValueError(f"Invalid price on {current_date}.")
            portfolio_value += w * (px / first_px)

        peak = max(peak, portfolio_value)
        drawdown = portfolio_value / peak - 1

        if previous_value is None:
            daily_ret = None
            log_ret = None
        else:
            daily_ret = portfolio_value / previous_value - 1
            log_ret = math.log(portfolio_value / previous_value)

        results.append(
            {
                "date": current_date,
                "portfolioValue": portfolio_value,
                "simpleReturn": daily_ret,
                "logReturn": log_ret,
                "wealthIndex": portfolio_value,
                "drawdown": drawdown,
            }
        )
        previous_value = portfolio_value

    return results


def _generate_simplex_weights(n_assets: int, step_pct: int) -> list[list[float]]:
    if n_assets == 2:
        grid = []
        for p in range(0, 101, step_pct):
            w1 = round(p / 100.0, 6)
            w2 = round(1.0 - w1, 6)
            grid.append([w1, w2])
        return grid

    # For 3..5 assets, choose coarsened simplex divisions so total points <= ~250
    divisions = 20 if n_assets == 3 else (10 if n_assets == 4 else 8)
    grid = []
    # Stars and bars over `divisions` units distributed into `n_assets` buckets
    for combo in combinations_with_replacement(range(n_assets), divisions):
        counts = [0] * n_assets
        for bucket in combo:
            counts[bucket] += 1
        weights = [round(c / divisions, 6) for c in counts]
        grid.append(weights)
    return grid


def analyze_portfolio_and_frontier(
    tickers: list[str],
    weights_pct: list[float],
    raw_series_map: dict[str, list[dict]],
    benchmark: str | None = None,
    frontier_step: int = 5,
) -> dict:
    aligned, common_dates = align_series_by_date(raw_series_map)
    datasets = [aligned[t] for t in tickers]
    weights = [w / 100.0 for w in weights_pct]

    portfolio_series = build_portfolio_from_rows(datasets, weights)
    portfolio_summary = summarize_metrics(portfolio_series)

    asset_breakdown = []
    for t, w in zip(tickers, weights):
        a_calc = calc_asset_metrics(aligned[t])
        a_sum = summarize_metrics(a_calc)
        asset_breakdown.append(
            {
                "ticker": t,
                "weight": w,
                **a_sum,
            }
        )

    bench_info = None
    bench_by_date: dict[str, dict] = {}
    if benchmark and benchmark in aligned:
        b_calc = calc_asset_metrics(aligned[benchmark])
        b_sum = summarize_metrics(b_calc)
        bench_by_date = {r["date"]: r for r in b_calc}

        port_rets = [
            r["simpleReturn"] for r in portfolio_series if r["simpleReturn"] is not None
        ]
        bench_rets = [
            r["simpleReturn"] for r in b_calc if r["simpleReturn"] is not None
        ]
        corr = statistics.correlation(port_rets, bench_rets)
        b_var = statistics.variance(bench_rets)
        beta = statistics.covariance(port_rets, bench_rets) / b_var if b_var > 0 else 0.0
        bench_info = {
            "benchmarkTicker": benchmark,
            "benchmarkSummary": b_sum,
            "annualReturnDifference": portfolio_summary["annualReturn"] - b_sum["annualReturn"],
            "returnCorrelation": corr,
            "beta": beta,
        }

    # Build Efficient Frontier / Weight Sweep
    weight_grid = _generate_simplex_weights(len(tickers), frontier_step)
    frontier_points = []
    for w_vec in weight_grid:
        sim_port = build_portfolio_from_rows(datasets, w_vec)
        sim_metrics = summarize_metrics(sim_port)
        frontier_points.append(
            {
                "weights": {t: w for t, w in zip(tickers, w_vec)},
                "firstWeight": w_vec[0],
                "secondWeight": w_vec[1] if len(w_vec) > 1 else 0.0,
                **sim_metrics,
            }
        )

    highest_sharpe = max(frontier_points, key=lambda p: p["sharpeRatio"])
    lowest_vol = min(frontier_points, key=lambda p: p["annualVolatility"])
    smallest_dd = max(frontier_points, key=lambda p: p["maximumDrawdown"])

    series_out = []
    for pt in portfolio_series:
        d = pt["date"]
        item = {
            "date": d,
            "wealthIndex": pt["wealthIndex"],
            "drawdown": pt["drawdown"],
            "simpleReturn": pt["simpleReturn"],
        }
        if d in bench_by_date:
            item["benchmarkWealthIndex"] = bench_by_date[d]["wealthIndex"]
            item["benchmarkDrawdown"] = bench_by_date[d]["drawdown"]
        series_out.append(item)

    return {
        "tickers": tickers,
        "weights": {t: w for t, w in zip(tickers, weights)},
        "alignedStartDate": common_dates[0],
        "alignedEndDate": common_dates[-1],
        "observations": len(common_dates),
        "summary": portfolio_summary,
        "assetBreakdown": asset_breakdown,
        "benchmarkComparison": bench_info,
        "monthlyReturns": compute_monthly_returns(series_out, "wealthIndex"),
        "series": series_out,
        "frontier": {
            "isTwoAssetCurve": len(tickers) == 2,
            "points": frontier_points,
            "highestSharpe": highest_sharpe,
            "lowestVolatility": lowest_vol,
            "smallestDrawdown": smallest_dd,
        },
    }


def _validate_ma_rows(rows: list[dict]) -> list[dict]:
    ordered = sorted(
        [{**r, "date": r["date"][:10]} for r in rows],
        key=lambda r: r["date"],
    )
    if not ordered or "adjOpen" not in ordered[0] or "adjClose" not in ordered[0]:
        raise ValueError("Price data must include both adjOpen and adjClose.")
    for row in ordered:
        for col in ("adjClose", "adjOpen"):
            px = float(row[col])
            if not math.isfinite(px) or px <= 0:
                raise ValueError(f"Invalid {col} on {row['date']}.")
    return ordered


def run_ma_backtest(
    ticker: str,
    raw_rows: list[dict],
    short_window: int,
    long_window: int,
    cost_bps: float,
) -> dict:
    if short_window <= 0 or long_window <= 0:
        raise ValueError("Moving-average windows must be positive integers.")
    if short_window >= long_window:
        raise ValueError("Short window must be strictly smaller than long window.")
    if not math.isfinite(cost_bps) or not 0 <= cost_bps < 10000:
        raise ValueError("Transaction cost must be between 0 and 10,000 bps.")

    rows = _validate_ma_rows(raw_rows)
    if len(rows) < long_window + 3:
        raise ValueError(
            f"Not enough trading days ({len(rows)}) for long window {long_window}. "
            f"Need at least {long_window + 3} trading days."
        )

    cost_rate = cost_bps / 10000.0
    signals = calculate_signals(rows, short_window, long_window)
    backtest = calculate_backtest(rows, signals, long_window, cost_rate)
    buy_hold = calculate_buy_and_hold(backtest, cost_rate)

    try:
        strategy_summary = summarize_metrics(backtest)
    except ValueError:
        # Handle edge case where strategy stays 100% in cash (zero volatility)
        total_ret = backtest[-1]["wealthIndex"] - 1
        strategy_summary = {
            "totalReturn": total_ret,
            "annualReturn": 0.0,
            "annualVolatility": 0.0,
            "sharpeRatio": 0.0,
            "maximumDrawdown": min(r["drawdown"] for r in backtest),
        }

    buy_hold_summary = summarize_metrics(buy_hold)

    adj_open_by_date = {r["date"]: float(r["adjOpen"]) for r in rows}
    trades = []
    for row in backtest[1:]:
        if row["turnover"] > 0:
            exec_date = row["executionDate"]
            trades.append(
                {
                    "signalDate": row["signalDate"],
                    "executionDate": exec_date,
                    "returnDate": row["date"],
                    "action": "BUY" if row["position"] == 1 else "EXIT",
                    "position": row["position"],
                    "executionAdjOpen": adj_open_by_date.get(exec_date),
                    "transactionCost": row["transactionCost"],
                }
            )

    buys = sum(1 for t in trades if t["action"] == "BUY")
    sells = sum(1 for t in trades if t["action"] == "EXIT")
    days_in_market = sum(1 for r in backtest[1:] if r["position"] == 1)
    total_active_days = max(len(backtest) - 1, 1)

    equity_series = []
    for strat_pt, hold_pt in zip(backtest, buy_hold):
        equity_series.append(
            {
                "date": strat_pt["date"],
                "position": strat_pt["position"],
                "turnover": strat_pt["turnover"],
                "strategyWealth": strat_pt["wealthIndex"],
                "strategyDrawdown": strat_pt["drawdown"],
                "strategyReturn": strat_pt["simpleReturn"],
                "buyHoldWealth": hold_pt["wealthIndex"],
                "buyHoldDrawdown": hold_pt["drawdown"],
                "buyHoldReturn": hold_pt["simpleReturn"],
            }
        )

    return {
        "ticker": ticker,
        "shortWindow": short_window,
        "longWindow": long_window,
        "costBps": cost_bps,
        "comparisonStart": backtest[0]["date"],
        "comparisonEnd": backtest[-1]["date"],
        "totalObservations": len(rows),
        "backtestObservations": len(backtest),
        "strategySummary": strategy_summary,
        "buyHoldSummary": buy_hold_summary,
        "tradeStats": {
            "totalTrades": len(trades),
            "buyTrades": buys,
            "sellTrades": sells,
            "exposureRatio": days_in_market / total_active_days,
            "totalCostDrag": sum(r["transactionCost"] for r in backtest[1:]),
        },
        "priceSignalSeries": signals,
        "equitySeries": equity_series,
        "monthlyReturns": compute_monthly_returns(equity_series, "strategyWealth"),
        "trades": trades,
    }


def _compare_window_pairs_safe(
    rows: list[dict],
    pairs: list[tuple[int, int]],
    cost_rate: float,
) -> tuple[list[dict], str, str]:
    """Wraps compare_window_pairs while gracefully handling zero-trade parameter pairs."""
    try:
        return compare_window_pairs(rows, pairs, cost_rate)
    except ValueError as err:
        if "zero volatility" not in str(err):
            raise
        comparison_start = max(lw for _, lw in pairs)
        if len(rows) < comparison_start + 3:
            raise ValueError("Not enough trading days for the longest window.") from err
        results = []
        for sw, lw in pairs:
            signals = calculate_signals(rows, sw, lw)
            bt = calculate_backtest(rows, signals, comparison_start, cost_rate)
            try:
                summary = summarize_metrics(bt)
            except ValueError:
                summary = {
                    "totalReturn": bt[-1]["wealthIndex"] - 1,
                    "annualReturn": 0.0,
                    "annualVolatility": 0.0,
                    "sharpeRatio": 0.0,
                    "maximumDrawdown": min(r["drawdown"] for r in bt),
                }
            trades_cnt = sum(r["turnover"] > 0 for r in bt[1:])
            results.append(
                {
                    "shortWindow": sw,
                    "longWindow": lw,
                    **summary,
                    "totalTrades": trades_cnt,
                }
            )
        return results, rows[comparison_start]["date"], rows[-1]["date"]


def run_ma_grid_and_validation(
    ticker: str,
    raw_rows: list[dict],
    short_windows: list[int],
    long_windows: list[int],
    cost_bps: float,
    train_ratio: float,
) -> dict:
    if not math.isfinite(cost_bps) or not 0 <= cost_bps < 10000:
        raise ValueError("Transaction cost must be between 0 and 10,000 bps.")

    rows = _validate_ma_rows(raw_rows)
    pairs = build_window_pairs(short_windows, long_windows)
    cost_rate = cost_bps / 10000.0

    grid_results, grid_start, grid_end = _compare_window_pairs_safe(
        rows, pairs, cost_rate
    )
    best_sharpe = max(grid_results, key=lambda r: r["sharpeRatio"])
    lowest_vol = min(grid_results, key=lambda r: r["annualVolatility"])
    smallest_dd = max(grid_results, key=lambda r: r["maximumDrawdown"])

    # Out-of-sample chronological train/test validation
    training_rows, testing_rows, split_index = split_data(rows, train_ratio)
    train_results, train_comp_start, train_comp_end = _compare_window_pairs_safe(
        training_rows, pairs, cost_rate
    )
    best_train = max(train_results, key=lambda r: r["sharpeRatio"])
    sel_short = best_train["shortWindow"]
    sel_long = best_train["longWindow"]

    try:
        oos = evaluate_out_of_sample(
            rows, split_index, sel_short, sel_long, cost_rate
        )
    except ValueError as err:
        if "zero volatility" not in str(err):
            raise
        signals = calculate_signals(rows, sel_short, sel_long)
        strat = calculate_backtest(rows, signals, split_index, cost_rate)
        bh = calculate_buy_and_hold(strat, cost_rate)
        oos = {
            "strategy": strat,
            "buyAndHold": bh,
            "strategySummary": {
                "totalReturn": strat[-1]["wealthIndex"] - 1,
                "annualReturn": 0.0,
                "annualVolatility": 0.0,
                "sharpeRatio": 0.0,
                "maximumDrawdown": min(r["drawdown"] for r in strat),
            },
            "buyHoldSummary": summarize_metrics(bh),
            "totalTrades": sum(r["turnover"] > 0 for r in strat[1:]),
        }

    oos_series = [
        {
            "date": s["date"],
            "strategyWealth": s["wealthIndex"],
            "strategyDrawdown": s["drawdown"],
            "buyHoldWealth": h["wealthIndex"],
            "buyHoldDrawdown": h["drawdown"],
            "position": s["position"],
        }
        for s, h in zip(oos["strategy"], oos["buyAndHold"])
    ]

    return {
        "ticker": ticker,
        "costBps": cost_bps,
        "parameterComparison": {
            "comparisonStart": grid_start,
            "comparisonEnd": grid_end,
            "combinationsCount": len(grid_results),
            "results": sorted(
                grid_results, key=lambda r: r["sharpeRatio"], reverse=True
            ),
            "bestSharpe": best_sharpe,
            "lowestVolatility": lowest_vol,
            "smallestDrawdown": smallest_dd,
        },
        "outOfSampleValidation": {
            "trainRatio": train_ratio,
            "splitIndex": split_index,
            "trainingStart": training_rows[0]["date"],
            "trainingEnd": training_rows[-1]["date"],
            "trainingComparisonStart": train_comp_start,
            "trainingComparisonEnd": train_comp_end,
            "testingStart": oos["strategy"][0]["date"],
            "testingEnd": oos["strategy"][-1]["date"],
            "trainingObservations": len(training_rows),
            "testingObservations": len(testing_rows),
            "selectedShortWindow": sel_short,
            "selectedLongWindow": sel_long,
            "bestTrainingResult": best_train,
            "testingStrategySummary": oos["strategySummary"],
            "testingBuyHoldSummary": oos["buyHoldSummary"],
            "testingTrades": oos["totalTrades"],
            "testingSeries": oos_series,
        },
    }
