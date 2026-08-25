import argparse
import csv
import math
from pathlib import Path

DATA_FOLDER = Path(__file__).parent / "data"

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
    first_price = float(rows[0]["adjClose"])
    previous_price = None
    peak = 1.0
    results = []

    for row in rows:
        price = float(row["adjClose"])
        if price <= 0:
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
    total_return = results[-1]["wealthIndex"] - 1
    max_drawdown = min(row["drawdown"] for row in results)

    print("Calculation successful.")
    print(f"Observations: {len(results)}")
    print(f"Total return: {total_return:.4%}")
    print(f"Maximum drawdown: {max_drawdown:.4%}")
    print(f"Saved to: {output_file}")

if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as error:
        print(f"Calculation failed: {error}")