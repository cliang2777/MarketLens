import os

os.environ.setdefault("MARKETLENS_SQLITE_PATH", ":memory:")

from datetime import date, timedelta
from fastapi.testclient import TestClient

from backend.app.db import init_db
from backend.app.main import app
from backend.app.services.cache_store import clear_cache, store_price_rows


def _make_synthetic_bars(
    start: date,
    days: int,
    base_price: float,
    drift: float,
    wave: float,
) -> list[dict]:
    rows = []
    px = base_price
    cur = start
    for i in range(days):
        while cur.weekday() >= 5:
            cur += timedelta(days=1)
        ret = drift + (wave if i % 5 < 3 else -wave * 0.85)
        open_px = px
        close_px = max(1.0, px * (1.0 + ret))
        rows.append(
            {
                "date": cur.isoformat(),
                "open": round(open_px, 4),
                "high": round(max(open_px, close_px) * 1.005, 4),
                "low": round(min(open_px, close_px) * 0.995, 4),
                "close": round(close_px, 4),
                "volume": 1_500_000 + i * 1000,
                "adjOpen": round(open_px, 4),
                "adjHigh": round(max(open_px, close_px) * 1.005, 4),
                "adjLow": round(min(open_px, close_px) * 0.995, 4),
                "adjClose": round(close_px, 4),
                "adjVolume": 1_500_000 + i * 1000,
                "divCash": 0.0,
                "splitFactor": 1.0,
            }
        )
        px = close_px
        cur += timedelta(days=1)
    return rows


def setup_module():
    init_db()
    clear_cache()
    aapl = _make_synthetic_bars(date(2023, 1, 2), 160, 130.0, 0.0012, 0.014)
    msft = _make_synthetic_bars(date(2023, 1, 2), 160, 240.0, 0.0010, 0.011)
    spy = _make_synthetic_bars(date(2023, 1, 2), 160, 380.0, 0.0007, 0.008)

    store_price_rows("TESTA", aapl, "2023-01-01", "2023-09-01")
    store_price_rows("TESTB", msft, "2023-01-01", "2023-09-01")
    store_price_rows("TESTSPY", spy, "2023-01-01", "2023-09-01")


client = TestClient(app)


def test_health_and_spa_index():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}

    api_h = client.get("/api/health")
    assert api_h.status_code == 200
    body = api_h.json()
    assert body["status"] == "ok"
    assert body["cache"]["tickerCount"] >= 3

    spa = client.get("/")
    assert spa.status_code == 200
    assert "MarketLens" in spa.text


def test_single_asset_analysis_uses_cache():
    res = client.post(
        "/api/assets/analyze",
        json={
            "ticker": "TESTA",
            "benchmark": "TESTSPY",
            "startDate": "2023-01-01",
            "endDate": "2023-08-15",
        },
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["ticker"] == "TESTA"
    assert payload["telemetry"]["cacheHits"] == 2
    assert payload["telemetry"]["liveFetches"] == 0
    assert "sharpeRatio" in payload["summary"]
    assert payload["benchmarkComparison"]["benchmarkTicker"] == "TESTSPY"
    assert len(payload["series"]) > 100


def test_multi_asset_comparison_and_correlation():
    res = client.post(
        "/api/assets/compare",
        json={
            "tickers": ["TESTA", "TESTB"],
            "benchmark": "TESTSPY",
            "startDate": "2023-01-01",
            "endDate": "2023-08-15",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data["assets"]) == 2
    assert len(data["correlationMatrix"]) == 3
    assert data["correlationMatrix"][0]["values"][0] == 1.0


def test_portfolio_analysis_and_validation():
    bad = client.post(
        "/api/portfolio/analyze",
        json={
            "allocations": [
                {"ticker": "TESTA", "weight": 60},
                {"ticker": "TESTB", "weight": 20},
            ],
            "benchmark": "TESTSPY",
            "startDate": "2023-01-01",
            "endDate": "2023-08-15",
        },
    )
    assert bad.status_code == 422

    ok = client.post(
        "/api/portfolio/analyze",
        json={
            "allocations": [
                {"ticker": "TESTA", "weight": 60},
                {"ticker": "TESTB", "weight": 40},
            ],
            "benchmark": "TESTSPY",
            "startDate": "2023-01-01",
            "endDate": "2023-08-15",
            "frontierStep": 10,
        },
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["frontier"]["isTwoAssetCurve"] is True
    assert len(body["frontier"]["points"]) == 11
    assert "highestSharpe" in body["frontier"]


def test_strategy_backtest_and_oos_optimization():
    bt = client.post(
        "/api/strategy/backtest",
        json={
            "ticker": "TESTA",
            "startDate": "2023-01-01",
            "endDate": "2023-08-15",
            "shortWindow": 10,
            "longWindow": 30,
            "costBps": 10,
        },
    )
    assert bt.status_code == 200
    bt_data = bt.json()
    assert "strategySummary" in bt_data
    assert "buyHoldSummary" in bt_data
    assert len(bt_data["equitySeries"]) > 50

    opt = client.post(
        "/api/strategy/optimize",
        json={
            "ticker": "TESTA",
            "startDate": "2023-01-01",
            "endDate": "2023-08-15",
            "shortWindows": [5, 10],
            "longWindows": [20, 30],
            "costBps": 10,
            "trainRatio": 0.7,
        },
    )
    assert opt.status_code == 200
    opt_data = opt.json()
    assert opt_data["parameterComparison"]["combinationsCount"] == 4
    assert "testingStrategySummary" in opt_data["outOfSampleValidation"]
