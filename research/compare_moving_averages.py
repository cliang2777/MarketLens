import argparse
import csv
import math
from backtest_moving_average import (
    calculate_backtest,
    calculate_signals,
)
from calculate_metrics import DATA_FOLDER, load_data, summarize
from calculate_portfolio import find_file

def build_window_pairs(short_windows, long_windows):
    all_windows = short_windows + long_windows

    if any(window <= 0 for window in all_windows):
        raise ValueError("Moving-average windows must be positive.")

    pairs = [
        (short_window, long_window)
        for short_window in sorted(set(short_windows))
        for long_window in sorted(set(long_windows))
        if short_window < long_window
    ]

    if not pairs:
        raise ValueError(
            "At least one short window must be smaller than a long window."
        )

    return pairs

def compare_window_pairs(rows, pairs, cost_rate):
    comparison_start = max(
        long_window for _, long_window in pairs
    )

    if len(rows) < comparison_start + 3:
        raise ValueError(
            "Not enough trading days for the longest window."
        )

    results = []

    for short_window, long_window in pairs:
        signals = calculate_signals(
            rows,
            short_window,
            long_window,
        )

        # Every combination starts on the same date.
        backtest = calculate_backtest(
            rows,
            signals,
            comparison_start,
            cost_rate,
        )
        summary = summarize(backtest)

        total_trades = sum(
            row["turnover"] > 0
            for row in backtest[1:]
        )

        results.append({
            "shortWindow": short_window,
            "longWindow": long_window,
            "totalReturn": summary["totalReturn"],
            "annualReturn": summary["annualReturn"],
            "annualVolatility": summary["annualVolatility"],
            "sharpeRatio": summary["sharpeRatio"],
            "maximumDrawdown": summary["maximumDrawdown"],
            "totalTrades": total_trades,
        })

    return (
        results,
        rows[comparison_start]["date"],
        rows[-1]["date"],
    )

def save_comparison_results(
        input_file, results, start_date, end_date, cost_bps):
    output_file = DATA_FOLDER / (
        f"moving_average_comparison_{input_file.stem}"
        f"_cost_{cost_bps:g}bps.csv"
    )

    columns = [
        "comparisonStart",
        "comparisonEnd",
        "shortWindow",
        "longWindow",
        "totalReturn",
        "annualReturn",
        "annualVolatility",
        "sharpeRatio",
        "maximumDrawdown",
        "totalTrades",
    ]

    with output_file.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()

        for result in results:
            writer.writerow({
                "comparisonStart": start_date,
                "comparisonEnd": end_date,
                **result,
            })

    return output_file

def main():
    parser = argparse.ArgumentParser(
        description="Compare moving-average parameter combinations."
    )
    parser.add_argument("input_file")
    parser.add_argument(
        "--short-windows",
        nargs="+",
        type=int,
        default=[10, 20, 50],
    )
    parser.add_argument(
        "--long-windows",
        nargs="+",
        type=int,
        default=[50, 100, 200],
    )
    parser.add_argument(
        "--cost-bps",
        type=float,
        default=0.0,
    )
    args = parser.parse_args()

    if not math.isfinite(args.cost_bps) or not 0 <= args.cost_bps < 10000:
        raise ValueError(
            "Cost must be between 0 and 10000 basis points."
        )

    pairs = build_window_pairs(
        args.short_windows,
        args.long_windows,
    )

    input_file = find_file(args.input_file)
    rows = load_data(input_file)

    if "adjOpen" not in rows[0]:
        raise ValueError("The CSV must contain adjOpen.")

    for row in rows:
        for column in ("adjClose", "adjOpen"):
            price = float(row[column])
            if not math.isfinite(price) or price <= 0:
                raise ValueError(
                    f"Invalid {column} on {row['date']}."
                )

    cost_rate = args.cost_bps / 10000

    results, start_date, end_date = compare_window_pairs(
        rows,
        pairs,
        cost_rate,
    )

    print(f"Input file: {input_file.name}")
    print(f"Cost per trade: {args.cost_bps:g} bps")
    print(f"Comparison period: {start_date} to {end_date}")
    print(f"Valid combinations: {len(results)}\n")

    print(
        f"{'Short':>7}"
        f"{'Long':>7}"
        f"{'Return':>12}"
        f"{'Annual':>12}"
        f"{'Volatility':>13}"
        f"{'Sharpe':>10}"
        f"{'Max DD':>12}"
        f"{'Trades':>9}"
    )
    print("-" * 82)

    for result in results:
        print(
            f"{result['shortWindow']:>7}"
            f"{result['longWindow']:>7}"
            f"{result['totalReturn']:>12.4%}"
            f"{result['annualReturn']:>12.4%}"
            f"{result['annualVolatility']:>13.4%}"
            f"{result['sharpeRatio']:>10.4f}"
            f"{result['maximumDrawdown']:>12.4%}"
            f"{result['totalTrades']:>9}"
        )

    best_sharpe = max(
        results,
        key=lambda result: result["sharpeRatio"],
    )
    lowest_volatility = min(
        results,
        key=lambda result: result["annualVolatility"],
    )
    smallest_drawdown = max(
        results,
        key=lambda result: result["maximumDrawdown"],
    )

    print("\nBest results in this sample:")
    print(
        "Highest Sharpe ratio: "
        f"{best_sharpe['shortWindow']}/"
        f"{best_sharpe['longWindow']}"
    )
    print(
        "Lowest volatility: "
        f"{lowest_volatility['shortWindow']}/"
        f"{lowest_volatility['longWindow']}"
    )
    print(
        "Smallest maximum drawdown: "
        f"{smallest_drawdown['shortWindow']}/"
        f"{smallest_drawdown['longWindow']}"
    )
    output_file = save_comparison_results(
        input_file,
        results,
        start_date,
        end_date,
        args.cost_bps,
    )
    print(f"\nSaved to: {output_file}")

if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as error:
        print(f"Comparison failed: {error}")