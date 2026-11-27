# AlphaMetric (`αM`)

**AlphaMetric** is a full-stack quantitative financial analysis, portfolio optimization, and strategy backtesting terminal built on corporate-action-adjusted US market data.

## Key Capabilities

1. **Asset Terminal**
   - Total & annualized return (252 trading days/year), annualized volatility, Sharpe ratio (`Rf = 0%`), underwater drawdown, benchmark Beta & return correlation.
   - Interactive normalized wealth curves (`LIN | LOG` scale), split/dividend-adjusted OHLCV candlestick & volume charts, monthly returns calendar heatmap, and live company profile metadata.
   - Smart US equity & ETF autocomplete with fuzzy English/Chinese matching and typo suggestions.
2. **Asset Comparison**
   - Automatic common-trading-calendar alignment across multiple US securities, normalized wealth curves, drawdown overlays, quantitative comparison ledger, and pairwise daily return correlation heatmap.
3. **Portfolio Lab**
   - Interactive 2–5 asset allocation builder with proportional auto-balancing (`SUM = 100%`) and Risk-Return Efficient Frontier grid sweep identifying **Highest Sharpe**, **Minimum Volatility**, and **Smallest Drawdown** allocations.
4. **Strategy Lab**
   - **Zero look-ahead bias**: moving-average crossover signals generated on daily `adjClose`, executed on the next session's `adjOpen` net of turnover transaction costs (`bps`).
   - Parameter grid comparison across shared periods and chronological Train/Test **Out-of-Sample (OOS)** validation.
5. **Dual Workspace Modes & Exports**
   - Instant **PRO** (institutional quantitative readout) and **GUIDE** (plain-language insights, `$10,000` capital simulations, and inline chart explainers) toggle, full **EN / 中文** localization, mobile/iOS Home Screen web app support, and one-click **PNG / CSV / Print PDF Tear Sheet** exports.
6. **Dual-Mode Persistent Market Cache**
   - Powered by SQLAlchemy 2.0: connects automatically to **PostgreSQL** when configured and reachable, or seamlessly persists daily OHLCV bars and asset profiles to a local **SQLite** database (`backend/data/alphametric_cache.sqlite3`) for millisecond-latency repeat queries and Tiingo rate-limit protection.

---

## Project Structure

```text
AlphaMetric/
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
    │   │   ├── ticker_directory.py
    │   │   └── quant_engine.py
    │   └── static/             # Brushed Gunmetal Quantitative Terminal UI & PWA icons
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

---

## Cloud Deployment

### Option A: Google Cloud Run (Recommended — Fast ~2–4s Cold Start)

This repository includes a lean production [Dockerfile](./Dockerfile) (`requirements-prod.txt`) tuned for Cloud Run's Always Free tier:

1. Open [Google Cloud Run](https://console.cloud.google.com/run) and click **Deploy container** -> **Service**.
2. Select **Continuously deploy from a repository** and connect `cliang2777/AlphaMetric` (branch `main`, Build type: **Dockerfile**).
3. Configure **Authentication**: `Allow unauthenticated invocations`, **Min instances**: `0`, **Max instances**: `2`, **Memory**: `512 MiB`, **Port**: `8080`.
4. Under **Variables & Secrets**, add `TIINGO_API_TOKEN`.
5. Click **Create** to deploy with automatic GitHub CI/CD and a public `https://*.run.app` URL.

### Option B: Render Blueprint

This repository also includes a one-click Render Blueprint ([render.yaml](./render.yaml)):

1. Sign in to [Render](https://render.com) with GitHub.
2. Click **New +** -> **Blueprint** (or **Web Service**) and select `cliang2777/AlphaMetric`.
3. Provide your `TIINGO_API_TOKEN` when prompted in Environment Variables.
4. Click **Apply / Deploy** to obtain a public `https://*.onrender.com` URL.
