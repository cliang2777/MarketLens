# MarketLens

MarketLens is a full-stack quantitative market analysis, portfolio optimization, and strategy backtesting platform built on corporate-action-adjusted historical market data.

## Key Capabilities

1. **Single-Asset Terminal (`Asset Terminal`)**
   - Total & annualized return (252 trading days/year), annualized volatility, Sharpe ratio, underwater drawdown, and benchmark Beta & return correlation.
2. **Cross-Asset Matrix (`Asset Comparison`)**
   - Automatic common-trading-calendar alignment across multiple securities, normalized wealth curves, drawdown overlays, and pairwise return correlation heatmaps.
3. **Portfolio & Efficient Frontier Lab (`Portfolio Frontier`)**
   - Multi-asset custom weight backtesting and grid-swept Risk-Return Efficient Frontier identifying **Highest Sharpe**, **Minimum Volatility**, and **Smallest Drawdown** allocations.
4. **Moving-Average Strategy & Out-of-Sample Validation (`Strategy & OOS Lab`)**
   - **Zero look-ahead bias**: signals computed on daily `adjClose`, executed on the next session's `adjOpen` net of turnover transaction costs (`bps`).
   - Parameter grid comparison across shared periods and chronological Train/Test Out-of-Sample (OOS) validation.
5. **Dual-Mode Persistent Market Cache**
   - Powered by SQLAlchemy 2.0: connects automatically to **PostgreSQL** when configured and reachable, or seamlessly persists daily OHLCV bars to a local **SQLite** database (`backend/data/marketlens_cache.sqlite3`) for millisecond-latency repeat queries and Tiingo rate-limit protection.

---

## Project Structure

```text
MarketLens/
├── run.py                      # One-command server launcher
├── requirements.txt            # Python dependencies
├── research/                   # Core quantitative models & unit tests
│   ├── download_tiingo.py
│   ├── calculate_metrics.py
│   ├── compare_assets.py
│   ├── calculate_portfolio.py
│   ├── compare_portfolios.py
│   ├── plot_portfolios.py
│   ├── backtest_moving_average.py
│   ├── compare_moving_averages.py
│   ├── validate_moving_average.py
│   └── test_*.py
└── backend/                    # FastAPI application, cache layer & Metallic SPA UI
    ├── app/
    │   ├── main.py
    │   ├── db.py
    │   ├── models.py
    │   ├── schemas.py
    │   ├── api/routes.py
    │   ├── services/
    │   │   ├── cache_store.py
    │   │   ├── market_data.py
    │   │   └── quant_engine.py
    │   └── static/             # Brushed Gunmetal Quantitative Terminal UI
    └── tests/
        └── test_api.py
```

---

## Quick Start

### 1. Configure Environment

Copy `.env.example` to `.env` and add your Tiingo API token:

```bash
cp .env.example .env
```

```env
TIINGO_API_TOKEN=your_tiingo_api_token
```

*(Optional)* Set `DATABASE_URL=postgresql+psycopg://...` to use PostgreSQL instead of the default local SQLite cache.

### 2. Install Dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Launch the Terminal

```bash
python run.py
```

Open **http://127.0.0.1:8000** in your browser (OpenAPI documentation is available at **http://127.0.0.1:8000/docs**).

---

## Running Tests

Run the full research and backend API test suite:

```bash
python -m pytest -v
```
