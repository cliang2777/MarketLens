from concurrent.futures import ThreadPoolExecutor
import time
from fastapi import APIRouter, HTTPException

from backend.app.config import get_tiingo_token
from backend.app.schemas import (
    MultiAssetCompareRequest,
    PortfolioAnalyzeRequest,
    SingleAssetRequest,
    StrategyBacktestRequest,
    StrategyOptimizeRequest,
)
from backend.app.services.cache_store import (
    clear_cache,
    get_cache_stats,
    seed_from_research_csvs,
)
from backend.app.services.market_data import (
    MarketDataError,
    fetch_asset_profile,
    fetch_price_series,
)
from backend.app.services.ticker_directory import (
    get_chinese_name,
    search_us_tickers,
)
from backend.app.services.quant_engine import (
    analyze_portfolio_and_frontier,
    analyze_single_asset,
    compare_multiple_assets,
    run_ma_backtest,
    run_ma_grid_and_validation,
)

router = APIRouter(prefix="/api", tags=["AlphaMetric Quantitative API"])


def _build_telemetry(t0: float, metas: list[dict]) -> dict:
    cache_hits = sum(1 for m in metas if m["source"] == "cache")
    live_fetches = sum(1 for m in metas if m["source"] == "tiingo")
    return {
        "totalElapsedMs": round((time.perf_counter() - t0) * 1000, 2),
        "cacheHits": cache_hits,
        "liveFetches": live_fetches,
        "sources": metas,
    }


@router.get("/health")
def health_status():
    stats = get_cache_stats()
    return {
        "status": "ok",
        "tiingoConfigured": get_tiingo_token() is not None,
        "cache": stats,
    }


@router.get("/tickers/search")
def search_tickers_endpoint(q: str = "", limit: int = 8):
    capped = max(1, min(limit, 15))
    return {
        "query": q,
        "results": search_us_tickers(q, limit=capped),
    }


@router.get("/cache/stats")
def cache_stats_endpoint():
    return get_cache_stats()


@router.delete("/cache")
def clear_cache_endpoint(reseed: bool = True):
    cleared = clear_cache()
    seeded = seed_from_research_csvs() if reseed else 0
    return {
        **cleared,
        "reseededTickers": seeded,
        "cache": get_cache_stats(),
    }


def _fetch_many(tickers: list[str], start_date, end_date, force_refresh: bool) -> tuple[dict[str, list[dict]], list[dict]]:
    unique = list(dict.fromkeys(tickers))
    if len(unique) <= 1:
        series_map: dict[str, list[dict]] = {}
        metas: list[dict] = []
        for sym in unique:
            rows, meta = fetch_price_series(sym, start_date, end_date, force_refresh)
            series_map[sym] = rows
            metas.append(meta)
        return series_map, metas

    series_map = {}
    meta_by_sym: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=min(5, len(unique))) as pool:
        future_map = {
            pool.submit(fetch_price_series, sym, start_date, end_date, force_refresh): sym
            for sym in unique
        }
        for fut, sym in future_map.items():
            rows, meta = fut.result()
            series_map[sym] = rows
            meta_by_sym[sym] = meta

    return series_map, [meta_by_sym[sym] for sym in unique]


@router.post("/assets/analyze")
def api_analyze_asset(req: SingleAssetRequest):
    t0 = time.perf_counter()
    try:
        needed = [req.ticker]
        if req.benchmark and req.benchmark != req.ticker:
            needed.append(req.benchmark)

        with ThreadPoolExecutor(max_workers=3) as pool:
            prof_future = pool.submit(
                fetch_asset_profile, req.ticker, req.forceRefresh
            )
            series_map, metas = _fetch_many(
                needed, req.startDate, req.endDate, req.forceRefresh
            )
            profile = prof_future.result()

        result = analyze_single_asset(
            ticker=req.ticker,
            asset_rows=series_map[req.ticker],
            benchmark_ticker=req.benchmark,
            benchmark_rows=series_map.get(req.benchmark) if req.benchmark else None,
        )
        if profile is not None:
            profile = {**profile, "nameZh": get_chinese_name(req.ticker) or ""}
        result["profile"] = profile
        result["telemetry"] = _build_telemetry(t0, metas)
        return result
    except (MarketDataError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/assets/compare")
def api_compare_assets(req: MultiAssetCompareRequest):
    t0 = time.perf_counter()
    try:
        needed = list(dict.fromkeys([*req.tickers, req.benchmark]))
        series_map, metas = _fetch_many(
            needed, req.startDate, req.endDate, req.forceRefresh
        )
        result = compare_multiple_assets(req.tickers, req.benchmark, series_map)
        result["telemetry"] = _build_telemetry(t0, metas)
        return result
    except (MarketDataError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/portfolio/analyze")
def api_analyze_portfolio(req: PortfolioAnalyzeRequest):
    t0 = time.perf_counter()
    try:
        tickers = [item.ticker for item in req.allocations]
        weights_pct = [item.weight for item in req.allocations]
        needed = list(tickers)
        if req.benchmark and req.benchmark not in needed:
            needed.append(req.benchmark)

        series_map, metas = _fetch_many(
            needed, req.startDate, req.endDate, req.forceRefresh
        )
        result = analyze_portfolio_and_frontier(
            tickers=tickers,
            weights_pct=weights_pct,
            raw_series_map=series_map,
            benchmark=req.benchmark,
            frontier_step=req.frontierStep,
        )
        result["telemetry"] = _build_telemetry(t0, metas)
        return result
    except (MarketDataError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/strategy/backtest")
def api_strategy_backtest(req: StrategyBacktestRequest):
    t0 = time.perf_counter()
    try:
        rows, meta = fetch_price_series(
            req.ticker, req.startDate, req.endDate, req.forceRefresh
        )
        result = run_ma_backtest(
            ticker=req.ticker,
            raw_rows=rows,
            short_window=req.shortWindow,
            long_window=req.longWindow,
            cost_bps=req.costBps,
        )
        result["telemetry"] = _build_telemetry(t0, [meta])
        return result
    except (MarketDataError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/strategy/optimize")
def api_strategy_optimize(req: StrategyOptimizeRequest):
    t0 = time.perf_counter()
    try:
        rows, meta = fetch_price_series(
            req.ticker, req.startDate, req.endDate, req.forceRefresh
        )
        result = run_ma_grid_and_validation(
            ticker=req.ticker,
            raw_rows=rows,
            short_windows=req.shortWindows,
            long_windows=req.longWindows,
            cost_bps=req.costBps,
            train_ratio=req.trainRatio,
        )
        result["telemetry"] = _build_telemetry(t0, [meta])
        return result
    except (MarketDataError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
