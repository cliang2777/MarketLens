import argparse
import csv
import math
from pathlib import Path

from calculate_metrics import DATA_FOLDER, load_data, summarize


def find_file(file_name):
    file_path = Path(file_name)

    if not file_path.exists():
        file_path = DATA_FOLDER / file_path

    if not file_path.exists():
        raise FileNotFoundError(f"Cannot find {file_path}")

    return file_path


def check_inputs(files, weights):
    if len(files) < 2:
        raise ValueError("A portfolio needs at least two assets.")

    if len(files) != len(weights):
        raise ValueError(
            "The number of files and weights must be the same."
        )

    if any(
        not math.isfinite(weight) or weight < 0
        for weight in weights
    ):
        raise ValueError("Portfolio weights cannot be negative.")

    if not math.isclose(sum(weights), 1.0, abs_tol=1e-8):
        raise ValueError("Portfolio weights must add up to 1.")


def build_portfolio(files, weights):
    datasets = [load_data(file) for file in files]
    portfolio_dates = [row["date"] for row in datasets[0]]

    for dataset in datasets[1:]:
        dates = [row["date"] for row in dataset]

        if dates != portfolio_dates:
            raise ValueError(
                "All assets must contain the same dates."
            )

    first_prices = [
        float(dataset[0]["adjClose"])
        for dataset in datasets
    ]

    previous_value = None
    peak = 1.0
    results = []

    for index, current_date in enumerate(portfolio_dates):
        portfolio_value = 0.0

        for dataset, first_price, weight in zip(
            datasets,
            first_prices,
            weights,
        ):
            price = float(dataset[index]["adjClose"])

            if not math.isfinite(price) or price <= 0:
                raise ValueError(
                    f"Invalid price on {current_date}."
                )

            asset_wealth = price / first_price
            portfolio_value += weight * asset_wealth

        peak = max(peak, portfolio_value)
        drawdown = portfolio_value / peak - 1

        if previous_value is None:
            daily_return = None
            log_return = None
        else:
            daily_return = portfolio_value / previous_value - 1
            log_return = math.log(
                portfolio_value / previous_value
            )

        results.append(
            {
                "date": current_date,
                "portfolioValue": portfolio_value,
                "simpleReturn": daily_return,
                "logReturn": log_return,
                "wealthIndex": portfolio_value,
                "drawdown": drawdown,
            }
        )

        previous_value = portfolio_value

    return results


def save_portfolio(files, weights, results):
    portfolio_parts = []

    for file, weight in zip(files, weights):
        ticker = file.stem.split("_")[0]
        weight_percent = weight * 100
        portfolio_parts.append(
            f"{ticker}_{weight_percent:g}"
        )

    output_name = (
        "portfolio_"
        + "_".join(portfolio_parts)
        + ".csv"
    )

    output_file = DATA_FOLDER / output_name
    columns = list(results[0].keys())

    with output_file.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        writer.writerows(results)

    return output_file


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--files", nargs="+", required=True)
    parser.add_argument(
        "--weights",
        nargs="+",
        type=float,
        required=True,
    )
    args = parser.parse_args()

    files = [find_file(name) for name in args.files]
    check_inputs(files, args.weights)

    results = build_portfolio(files, args.weights)
    summary = summarize(results)
    output_file = save_portfolio(
        files,
        args.weights,
        results,
    )

    print("Portfolio calculation successful.")

    for file, weight in zip(files, args.weights):
        ticker = file.stem.split("_")[0]
        print(f"{ticker} weight: {weight:.2%}")

    print(f"Observations: {len(results)}")
    print(f"Total return: {summary['totalReturn']:.4%}")
    print(f"Annualized return: {summary['annualReturn']:.4%}")
    print(
        f"Annualized volatility: "
        f"{summary['annualVolatility']:.4%}"
    )
    print(f"Sharpe ratio: {summary['sharpeRatio']:.4f}")
    print(
        f"Maximum drawdown: "
        f"{summary['maximumDrawdown']:.4%}"
    )
    print(f"Saved to: {output_file}")


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as error:
        print(f"Portfolio calculation failed: {error}")