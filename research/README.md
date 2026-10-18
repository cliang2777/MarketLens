# MarketLens Research

This folder contains the initial data and financial methodology research for MarketLens.

## 1. Current Workflow
Tiingo API
    -> Download daily market data
    -> Validate the data
    -> Calculate financial metrics
    -> Compare an asset with a benchmark

## 2. Files
- `download_tiingo.py`: downloads daily historical data from Tiingo.
- `calculate_metrics.py`: calculates return and risk metrics for one asset.
- `compare_assets.py`: compares an asset with a market benchmark.
- `calculate_portfolio.py`: calculates the return and risk metrics of a multi-asset portfolio.
- `compare_portfolios.py`: compares different weight combinations for two assets.
- `plot_portfolios.py`: creates a risk-return chart from portfolio comparison results.
- `requirements.txt`: lists the Python package required by the research scripts.
- `backtest_moving_average.py`: backtests a moving-average strategy against buy-and-hold.
- `test_backtest_moving_average.py`: tests execution timing, costs, and CSV export.
- `compare_moving_averages.py`: compares multiple moving-average parameter combinations.
- `test_compare_moving_averages.py`: tests parameter generation, shared comparison periods, and CSV export.
- `validate_moving_average.py`: selects parameters on training data and evaluates them on unseen testing data.
- `test_validate_moving_average.py`: tests chronological splitting, execution timing, and validation output.
- `test_calculate_metrics.py`: tests returns, risk metrics, validation, and CSV output.
- `test_calculate_portfolio.py`: tests weights, portfolio calculations, validation, and CSV output.
- `test_compare_assets.py`: tests correlation, beta, date validation, and structured comparison results.

Downloaded CSV files are stored in `research/data/`. This folder is included in .gitignore.

## 3. Setup
Create a local `.env` file in the project root and add:

```text
TIINGO_API_TOKEN=your_token
```

The real API token must not be committed to Git.

Install the research dependency:

```bash
python3 -m pip install -r research/requirements.txt
```

## 4. Download data

Example:

```bash
python3 research/download_tiingo.py AAPL 2021-01-01 2025-12-31
```

The downloaded data includes:

- Raw OHLC prices
- Adjusted OHLC prices
- Raw and adjusted volume
- Cash dividends
- Stock split factors

## 5. Data methodology

### Adjusted price

Return and risk calculations use `adjClose` rather than `close`.

Adjusted prices account for stock splits and cash dividends. This prevents corporate actions from being incorrectly treated as investment gains or losses.

Because `adjClose` already reflects dividends, `divCash` is not added separately to returns.

### Trading days

The current methodology assumes 252 trading days per year.

### Risk-free rate

The current default annual risk-free rate is 0%.

### Benchmark

SPY is currently used as the default benchmark.

## 6. Financial metrics

### Simple return

```text
simple return = adjusted price today / adjusted price yesterday - 1
```

### Log return

```text
log return = ln(adjusted price today / adjusted price yesterday)
```

### Wealth index

```text
wealth index = current adjusted price / initial adjusted price
```

The wealth index starts at 1.

### Total return

```text
total return = final wealth index - 1
```

### Annualized return

```text
annualized return =
(1 + total return)^(252 / number of daily returns) - 1
```

### Annualized volatility

Annualized volatility uses the sample standard deviation of daily simple returns:

```text
annualized volatility =
standard deviation of daily returns * sqrt(252)
```

### Sharpe ratio

```text
Sharpe ratio =
mean daily excess return / daily return standard deviation * sqrt(252)
```

The current risk-free rate assumption is 0%.

### Drawdown

```text
drawdown =
current wealth index / highest previous wealth index - 1
```

### Maximum drawdown

Maximum drawdown is the lowest drawdown observed during the selected period.

### Correlation

Correlation measures the strength of the linear relationship between the daily returns of the asset and benchmark and ranges from -1 to 1.

### Beta

```text
beta =
covariance(asset returns, benchmark returns)
/
variance(benchmark returns)
```

Beta measures the sensitivity of the asset to movements in the benchmark.

## 7. Data validation

The current scripts check that:

- The CSV is not empty.
- `date` and `adjClose` are present.
- Adjusted prices are greater than zero.
- Dates are sorted.
- Duplicate dates are rejected.
- The asset and benchmark contain the same dates.
- Benchmark variance is not zero before beta is calculated.

Apple's 2020 four-for-one stock split was used to confirm that adjusted prices prevent a stock split from creating a false return.

## 8. Example calculations

Calculate metrics for one asset:

```bash
python3 research/calculate_metrics.py AAPL_2021-01-01_2025-12-31.csv
```

Compare AAPL with SPY:

```bash
python3 research/compare_assets.py \
AAPL_2021-01-01_2025-12-31.csv \
SPY_2021-01-01_2025-12-31.csv
```

Calculate a 50/50 AAPL and MSFT portfolio:

```bash
python3 research/calculate_portfolio.py \
  --files AAPL_2021-01-01_2025-12-31.csv MSFT_2021-01-01_2025-12-31.csv \
  --weights 0.5 0.5
```

Compare portfolio weights for AAPL and MSFT:

```bash
python3 research/compare_portfolios.py \
  --files AAPL_2021-01-01_2025-12-31.csv MSFT_2021-01-01_2025-12-31.csv \
  --step 5
```

Create a portfolio risk-return chart:

```bash
python3 research/plot_portfolios.py \
  portfolio_comparison_AAPL_2021-01-01_2025-12-31_MSFT_2021-01-01_2025-12-31_step_5.csv \
  --labels AAPL MSFT
```

## 9. Moving-average backtest

This script compares a moving-average strategy with buy-and-hold over the same period. 
Signals use adjusted closing prices; trades execute at the next opening price.

```bash
python3 research/backtest_moving_average.py \
  AAPL_2021-01-01_2025-12-31.csv \
  --short 20 --long 50 --cost-bps 10
```

`--cost-bps 10` means a 0.1% transaction cost whenever the position changes. Daily results are saved in `research/data/`.

## 10. Moving-average parameter comparison

This script compares multiple short- and long-window combinations over the same period. Results are sample-specific and do not guarantee future performance.

```bash
python3 research/compare_moving_averages.py \
  AAPL_2021-01-01_2025-12-31.csv \
  --short-windows 10 20 50 \
  --long-windows 50 100 200 \
  --cost-bps 10
```

The comparison results are saved in `research/data/`.

## 11. Out-of-sample moving-average validation

This script splits the data chronologically into training and testing periods. The training period selects the parameter combination with the highest Sharpe ratio. The selected parameters are then evaluated on the unseen testing period.

```bash
python3 research/validate_moving_average.py \
  AAPL_2021-01-01_2025-12-31.csv \
  --train-ratio 0.7 \
  --short-windows 10 20 50 \
  --long-windows 50 100 200 \
  --cost-bps 10
```

Historical prices before the testing period are used only to calculate the initial moving averages. Testing returns begin at the first testing-period opening price.

The validation summary is saved in `research/data/`.