import argparse
import csv

from calculate_metrics import DATA_FOLDER, summarize
from calculate_portfolio import build_portfolio, find_file


def compare_weights(files, step):
    comparisons = []

    for first_percent in range(0, 101, step):
        first_weight = round(first_percent / 100, 10)
        second_weight = round(1 - first_weight, 10)
        weights = [first_weight, second_weight]

        portfolio = build_portfolio(files, weights)
        metrics = summarize(portfolio)

        comparisons.append(
            {
                "firstWeight": first_weight,
                "secondWeight": second_weight,
                **metrics,
            }
        )

    return comparisons

def save_results(files, comparisons, step):
    file_names = "_".join(
        file.stem for file in files
    )

    output_name = (
        f"portfolio_comparison_"
        f"{file_names}_step_{step}.csv"
    )

    output_file = DATA_FOLDER / output_name

    columns = [
        "firstWeight",
        "secondWeight",
        "totalReturn",
        "annualReturn",
        "annualVolatility",
        "sharpeRatio",
        "maximumDrawdown",
    ]

    with output_file.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=columns,
        )
        writer.writeheader()
        writer.writerows(comparisons)

    return output_file

def allocation_text(row, first_ticker, second_ticker):
    return (
        f"{first_ticker} {row['firstWeight']:.0%}, "
        f"{second_ticker} {row['secondWeight']:.0%}"
    )


def print_results(files, comparisons):
    first_ticker = files[0].stem.split("_")[0]
    second_ticker = files[1].stem.split("_")[0]

    print(
        f"\n{first_ticker:>8}"
        f"{second_ticker:>8}"
        f"{'Return':>12}"
        f"{'Volatility':>14}"
        f"{'Sharpe':>10}"
        f"{'Max DD':>12}"
    )

    print("-" * 64)

    for row in comparisons:
        print(
            f"{row['firstWeight']:>8.0%}"
            f"{row['secondWeight']:>8.0%}"
            f"{row['annualReturn']:>12.4%}"
            f"{row['annualVolatility']:>14.4%}"
            f"{row['sharpeRatio']:>10.4f}"
            f"{row['maximumDrawdown']:>12.4%}"
        )

    highest_sharpe = max(
        comparisons,
        key=lambda row: row["sharpeRatio"],
    )
    lowest_volatility = min(
        comparisons,
        key=lambda row: row["annualVolatility"],
    )
    smallest_drawdown = max(
        comparisons,
        key=lambda row: row["maximumDrawdown"],
    )

    print("\nBest results in this sample:")

    print(
        "Highest Sharpe ratio: "
        + allocation_text(
            highest_sharpe,
            first_ticker,
            second_ticker,
        )
    )

    print(
        "Lowest volatility: "
        + allocation_text(
            lowest_volatility,
            first_ticker,
            second_ticker,
        )
    )

    print(
        "Smallest maximum drawdown: "
        + allocation_text(
            smallest_drawdown,
            first_ticker,
            second_ticker,
        )
    )


def main():
    parser = argparse.ArgumentParser(
        description="Compare different weights for two assets."
    )

    parser.add_argument(
        "--files",
        nargs=2,
        required=True,
        help="Two historical price CSV files.",
    )

    parser.add_argument(
        "--step",
        type=int,
        default=5,
        help="Weight interval in percentage points.",
    )

    args = parser.parse_args()

    if (
        args.step <= 0
        or args.step > 100
        or 100 % args.step != 0
    ):
        raise ValueError(
            "Step must be a positive divisor of 100."
        )

    files = [
        find_file(file_name)
        for file_name in args.files
    ]

    comparisons = compare_weights(
        files,
        args.step,
    )

    print_results(files, comparisons)

    output_file = save_results(
        files,
        comparisons,
        args.step,
    )

    print(f"\nSaved to: {output_file}")

if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as error:
        print(f"Portfolio comparison failed: {error}")