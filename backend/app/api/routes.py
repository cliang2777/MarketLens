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
from backend.app.services.market_data import MarketDataError, fetch_price_series
from backend.app.services.quant_engine import (
    analyze_portfolio_and_frontier,
    analyze_single_asset,
    compare_multiple_assets,
    run_ma_backtest,
    run_ma_grid_and_validation,
)

router = APIRouter(prefix="/api", tags=["MarketLens Quantitative API"])


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


@router.post("/assets/analyze")
def api_analyze_asset(req: SingleAssetRequest):
    t0 = time.perf_counter()
    metas = []
    try:
        asset_rows, m1 = fetch_price_series(
            req.ticker, req.startDate, req.endDate, req.forceRefresh
        )
        metas.append(m1)

        bench_rows = None
        if req.benchmark and req.benchmark != req.ticker:
            bench_rows, m2 = fetch_price_series(
                req.benchmark, req.startDate, req.endDate, req.forceRefresh
            )
            metas.append(m2)

        result = analyze_single_asset(
            ticker=req.ticker,
            asset_rows=asset_rows,
            benchmark_ticker=req.benchmark,
            benchmark_rows=bench_rows,
        )
        result["telemetry"] = _build_telemetry(t0, metas)
        return result
    except (MarketDataError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/assets/compare")
def api_compare_assets(req: MultiAssetCompareRequest):
    t0 = time.perf_counter()
    metas = []
    try:
        needed = list(dict.fromkeys([*req.tickers, req.benchmark]))
        series_map: dict[str, list[dict]] = {}
        for sym in needed:
            rows, meta = fetch_price_series(
                sym, req.startDate, req.endDate, req.forceRefresh
            )
            series_map[sym] = rows
            metas.append(meta)

        result = compare_multiple_assets(req.tickers, req.benchmark, series_map)
        result["telemetry"] = _build_telemetry(t0, metas)
        return result
    except (MarketDataError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/portfolio/analyze")
def api_analyze_portfolio(req: PortfolioAnalyzeRequest):
    t0 = time.perf_counter()
    metas = []
    try:
        tickers = [item.ticker for item in req.allocations]
        weights_pct = [item.weight for item in req.allocations]
        needed = list(tickers)
        if req.benchmark and req.benchmark not in needed:
            needed.append(req.benchmark)

        series_map: dict[str, list[dict]] = {}
        for sym in needed:
            rows, meta = fetch_price_series(
                sym, req.startDate, req.endDate, req.forceRefresh
            )
            series_map[sym] = rows
            metas.append(meta)

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
