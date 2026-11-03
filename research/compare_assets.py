import argparse
import statistics
import math
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

def prepare_comparison_rows(rows):
    if len(rows) < 3:
        raise ValueError("At least three price observations are required.")

    for row in rows:
        if (
            not isinstance(row, dict)
            or "date" not in row
            or "adjClose" not in row
        ):
            raise ValueError("Each row must contain date and adjClose.")

        if not isinstance(row["date"], str) or not row["date"].strip():
            raise ValueError("Each date must be a non-empty string.")

        try:
            price = float(row["adjClose"])
        except (TypeError, ValueError):
            raise ValueError(
                f"Invalid price on {row['date']}."
            ) from None

        if not math.isfinite(price) or price <= 0:
            raise ValueError(f"Invalid price on {row['date']}.")

    ordered_rows = sorted(rows, key=lambda row: row["date"])
    dates = [row["date"] for row in ordered_rows]

    if len(dates) != len(set(dates)):
        raise ValueError("Duplicate dates were found.")

    return ordered_rows

def calculate_comparison_from_rows(
        asset_rows, benchmark_rows, asset_name, benchmark_name):
    asset_rows = prepare_comparison_rows(asset_rows)
    benchmark_rows = prepare_comparison_rows(benchmark_rows)

    asset_dates = [row["date"] for row in asset_rows]
    benchmark_dates = [row["date"] for row in benchmark_rows]

    if asset_dates != benchmark_dates:
        raise ValueError(
            "Asset and benchmark must contain the same dates."
        )

    asset_results = calculate(asset_rows)
    benchmark_results = calculate(benchmark_rows)

    asset_summary = summarize(asset_results)
    benchmark_summary = summarize(benchmark_results)
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

    return {
        "assetName": asset_name,
        "benchmarkName": benchmark_name,
        "assetSummary": asset_summary,
        "benchmarkSummary": benchmark_summary,
        "annualReturnDifference": (
            asset_summary["annualReturn"]
            - benchmark_summary["annualReturn"]
        ),
        "returnCorrelation": correlation,
        "beta": beta,
    }

def calculate_comparison(asset_file, benchmark_file):
    asset_rows = load_data(asset_file)
    benchmark_rows = load_data(benchmark_file)

    return calculate_comparison_from_rows(
        asset_rows,
        benchmark_rows,
        asset_file.stem.split("_")[0],
        benchmark_file.stem.split("_")[0],
    )

def show_comparison(asset_file, benchmark_file):
    comparison = calculate_comparison(
        asset_file,
        benchmark_file,
    )

    asset = comparison["assetSummary"]
    benchmark = comparison["benchmarkSummary"]
    asset_name = comparison["assetName"]
    benchmark_name = comparison["benchmarkName"]
    correlation = comparison["returnCorrelation"]
    beta = comparison["beta"]

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

    return_difference = comparison["annualReturnDifference"]

    print()
    print(
        f"Annualized return difference: "
        f"{return_difference:.4%}"
    )

    print(f"Return correlation: {correlation:.4f}")
    print(f"Beta: {beta:.4f}")
    return comparison

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