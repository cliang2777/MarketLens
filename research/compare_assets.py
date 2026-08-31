import argparse
import statistics
from pathlib import Path

from calculate_metrics import (
    DATA_FOLDER,
    calculate,
    load_data,
    summarize,
)

def find_file(file_name):
    file_path = Path(file_name)

    if not file_path.exists():
        file_path = DATA_FOLDER / file_path

    if not file_path.exists():
        raise FileNotFoundError(f"Cannot find {file_path}")

    return file_path

def analyze(file_path):
    rows = load_data(file_path)
    results = calculate(rows)
    summary = summarize(results)

    return rows, results, summary

def show_comparison(asset_file, benchmark_file):
    asset_rows, asset_results, asset = analyze(asset_file)
    benchmark_rows, benchmark_results, benchmark = analyze(benchmark_file)

    asset_dates = [row["date"] for row in asset_rows]
    benchmark_dates = [row["date"] for row in benchmark_rows]

    if asset_dates != benchmark_dates:
        raise ValueError(
            "Asset and benchmark must contain the same dates."
        )

    asset_returns = [
        row["simpleReturn"]
        for row in asset_results
        if row["simpleReturn"] is not None
    ]

    benchmark_returns = [
        row["simpleReturn"]
        for row in benchmark_results
        if row["simpleReturn"] is not None
    ]

    correlation = statistics.correlation(
        asset_returns,
        benchmark_returns,
    )

    benchmark_variance = statistics.variance(
        benchmark_returns
    )

    if benchmark_variance == 0:
        raise ValueError(
            "Cannot calculate beta because benchmark variance is zero."
        )

    beta = (
        statistics.covariance(
            asset_returns,
            benchmark_returns,
        )
        / benchmark_variance
    )
    asset_name = asset_file.stem.split("_")[0]
    benchmark_name = benchmark_file.stem.split("_")[0]

    print()
    print(f"{'Metric':<25}{asset_name:>15}{benchmark_name:>15}")
    print("-" * 55)

    print(
        f"{'Total return':<25}"
        f"{asset['totalReturn']:>14.4%}"
        f"{benchmark['totalReturn']:>15.4%}"
    )

    print(
        f"{'Annualized return':<25}"
        f"{asset['annualReturn']:>14.4%}"
        f"{benchmark['annualReturn']:>15.4%}"
    )

    print(
        f"{'Annualized volatility':<25}"
        f"{asset['annualVolatility']:>14.4%}"
        f"{benchmark['annualVolatility']:>15.4%}"
    )

    print(
        f"{'Sharpe ratio':<25}"
        f"{asset['sharpeRatio']:>14.4f}"
        f"{benchmark['sharpeRatio']:>15.4f}"
    )

    print(
        f"{'Maximum drawdown':<25}"
        f"{asset['maximumDrawdown']:>14.4%}"
        f"{benchmark['maximumDrawdown']:>15.4%}"
    )

    return_difference = (
        asset["annualReturn"] - benchmark["annualReturn"]
    )

    print()
    print(
        f"Annualized return difference: "
        f"{return_difference:.4%}"
    )

    print(f"Return correlation: {correlation:.4f}")
    print(f"Beta: {beta:.4f}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("asset_file")
    parser.add_argument("benchmark_file")
    args = parser.parse_args()

    asset_file = find_file(args.asset_file)
    benchmark_file = find_file(args.benchmark_file)

    show_comparison(asset_file, benchmark_file)

if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as error:
        print(f"Comparison failed: {error}")