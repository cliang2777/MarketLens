import argparse
import statistics
import csv
import math
from pathlib import Path

DATA_FOLDER = Path(__file__).parent / "data"
TRADING_DAYS = 252
RISK_FREE_RATE = 0.0

def load_data(file_path):
    with file_path.open("r", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        rows = list(reader)

    if not rows:
        raise ValueError("The CSV file is empty.")
    if "date" not in rows[0] or "adjClose" not in rows[0]:
        raise ValueError("The CSV must contain date and adjClose.")

    rows.sort(key=lambda row: row["date"])
    dates = [row["date"] for row in rows]
    if len(dates) != len(set(dates)):
        raise ValueError("Duplicate dates were found.")

    return rows

def calculate(rows):
    if not rows:
        raise ValueError("No rows to calculate.")

    first_price = float(rows[0]["adjClose"])
    previous_price = None
    peak = 1.0
    results = []

    for row in rows:
        price = float(row["adjClose"])

        if not math.isfinite(price) or price <= 0:
            raise ValueError(f"Invalid price on {row['date']}.")

        wealth = price / first_price
        peak = max(peak, wealth)
        drawdown = wealth / peak - 1

        if previous_price is None:
            daily_return = None
            log_return = None
        else:
            daily_return = price / previous_price - 1
            log_return = math.log(price / previous_price)
        results.append(
            {
                "date": row["date"],
                "adjClose": price,
                "simpleReturn": daily_return,
                "logReturn": log_return,
                "wealthIndex": wealth,
                "drawdown": drawdown,
            }
        )
        previous_price = price
    return results

def summarize(results):
    daily_returns = [
        row["simpleReturn"]
        for row in results
        if row["simpleReturn"] is not None
    ]

    if len(daily_returns) < 2:
        raise ValueError("Not enough data to calculate annual metrics.")

    total_return = results[-1]["wealthIndex"] - 1

    annual_return = (
        (1 + total_return)
        ** (TRADING_DAYS / len(daily_returns))
        - 1
    )

    daily_volatility = statistics.stdev(daily_returns)
    annual_volatility = daily_volatility * math.sqrt(TRADING_DAYS)

    if daily_volatility == 0:
        raise ValueError("Cannot calculate Sharpe ratio with zero volatility.")

    daily_risk_free_rate = (
        (1 + RISK_FREE_RATE) ** (1 / TRADING_DAYS) - 1
    )

    sharpe_ratio = (
        statistics.mean(daily_returns) - daily_risk_free_rate
    ) / daily_volatility * math.sqrt(TRADING_DAYS)

    max_drawdown = min(
        row["drawdown"] for row in results
    )

    return {
        "totalReturn": total_return,
        "annualReturn": annual_return,
        "annualVolatility": annual_volatility,
        "sharpeRatio": sharpe_ratio,
        "maximumDrawdown": max_drawdown,
    }

def save_data(input_file, results):
    output_file = input_file.with_name(
        input_file.stem + "_metrics.csv"
    )
    columns = [
        "date",
        "adjClose",
        "simpleReturn",
        "logReturn",
        "wealthIndex",
        "drawdown",
    ]
    with output_file.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        writer.writerows(results)
    return output_file

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_file")
    args = parser.parse_args()

    input_file = Path(args.input_file)

    if not input_file.exists():
        input_file = DATA_FOLDER / input_file
    if not input_file.exists():
        raise FileNotFoundError(f"Cannot find {input_file}")

    rows = load_data(input_file)
    results = calculate(rows)
    output_file = save_data(input_file, results)
    summary = summarize(results)

    print("Calculation successful.")
    print(f"Observations: {len(results)}")
    print(f"Total return: {summary['totalReturn']:.4%}")
    print(f"Annualized return: {summary['annualReturn']:.4%}")
    print(f"Annualized volatility: {summary['annualVolatility']:.4%}")
    print(f"Sharpe ratio: {summary['sharpeRatio']:.4f}")
    print(f"Maximum drawdown: {summary['maximumDrawdown']:.4%}")
    print(f"Saved to: {output_file}")

if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as error:
        print(f"Calculation failed: {error}")