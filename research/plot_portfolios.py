import argparse
import csv
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter

from calculate_metrics import DATA_FOLDER


def find_file(file_name):
    file_path = Path(file_name)

    if not file_path.exists():
        file_path = DATA_FOLDER / file_path

    if not file_path.exists():
        raise FileNotFoundError(
            f"Cannot find {file_path}"
        )

    return file_path


def load_results(file_path):
    required_columns = {
        "firstWeight",
        "secondWeight",
        "annualReturn",
        "annualVolatility",
        "sharpeRatio",
    }

    with file_path.open(
        "r",
        encoding="utf-8",
    ) as file:
        reader = csv.DictReader(file)

        if not required_columns.issubset(
            reader.fieldnames or []
        ):
            raise ValueError(
                "The comparison CSV is missing required columns."
            )

        results = []

        for row in reader:
            results.append(
                {
                    column: float(row[column])
                    for column in required_columns
                }
            )

    if not results:
        raise ValueError(
            "The comparison CSV is empty."
        )

    return results


def create_plot(results, labels, input_file):
    volatility = [
        row["annualVolatility"]
        for row in results
    ]
    returns = [
        row["annualReturn"]
        for row in results
    ]
    first_weights = [
        row["firstWeight"] * 100
        for row in results
    ]

    highest_sharpe = max(
        results,
        key=lambda row: row["sharpeRatio"],
    )
    lowest_volatility = min(
        results,
        key=lambda row: row["annualVolatility"],
    )

    figure, axis = plt.subplots(
        figsize=(9, 6)
    )

    axis.plot(
        volatility,
        returns,
        color="gray",
        linewidth=1,
        alpha=0.6,
    )

    points = axis.scatter(
        volatility,
        returns,
        c=first_weights,
        cmap="viridis",
        s=60,
    )

    axis.scatter(
        highest_sharpe["annualVolatility"],
        highest_sharpe["annualReturn"],
        marker="*",
        color="red",
        s=180,
        label="Highest Sharpe",
    )

    axis.scatter(
        lowest_volatility["annualVolatility"],
        lowest_volatility["annualReturn"],
        marker="D",
        color="orange",
        s=80,
        label="Lowest volatility",
    )

    axis.annotate(
        f"Max Sharpe\n"
        f"{labels[0]} "
        f"{highest_sharpe['firstWeight']:.0%}",
        (
            highest_sharpe["annualVolatility"],
            highest_sharpe["annualReturn"],
        ),
        xytext=(8, 10),
        textcoords="offset points",
    )

    axis.annotate(
        f"Min volatility\n"
        f"{labels[0]} "
        f"{lowest_volatility['firstWeight']:.0%}",
        (
            lowest_volatility["annualVolatility"],
            lowest_volatility["annualReturn"],
        ),
        xytext=(8, -28),
        textcoords="offset points",
    )

    axis.set_title(
        f"{labels[0]}–{labels[1]} Portfolio Risk and Return"
    )
    axis.set_xlabel("Annualized volatility")
    axis.set_ylabel("Annualized return")

    axis.xaxis.set_major_formatter(
        PercentFormatter(1)
    )
    axis.yaxis.set_major_formatter(
        PercentFormatter(1)
    )

    axis.grid(alpha=0.25)
    axis.legend()

    color_bar = figure.colorbar(
        points,
        ax=axis,
    )
    color_bar.set_label(
        f"{labels[0]} weight (%)"
    )

    figure.tight_layout()

    output_file = input_file.with_suffix(
        ".png"
    )
    figure.savefig(
        output_file,
        dpi=160,
    )
    plt.close(figure)

    return output_file


def main():
    parser = argparse.ArgumentParser(
        description="Plot portfolio risk and return."
    )

    parser.add_argument("input_file")

    parser.add_argument(
        "--labels",
        nargs=2,
        required=True,
    )

    args = parser.parse_args()

    input_file = find_file(args.input_file)
    results = load_results(input_file)

    output_file = create_plot(
        results,
        args.labels,
        input_file,
    )

    print("Portfolio plot created successfully.")
    print(f"Saved to: {output_file}")


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as error:
        print(f"Plot creation failed: {error}")