import argparse
import math
import csv
from calculate_metrics import DATA_FOLDER, load_data, summarize
from calculate_portfolio import find_file

def calculate_signals(rows, short_window, long_window):
    prices = [float(row["adjClose"]) for row in rows]
    results = []

    for index, row in enumerate(rows):
        short_average = None
        long_average = None
        signal = None

        if index + 1 >= short_window:
            short_average = (
                sum(prices[index - short_window + 1:index + 1])
                / short_window
            )

        if index + 1 >= long_window:
            long_average = (
                sum(prices[index - long_window + 1:index + 1])
                / long_window
            )
            signal = 1 if short_average > long_average else 0

        results.append({
            "date": row["date"],
            "adjClose": prices[index],
            "shortAverage": short_average,
            "longAverage": long_average,
            "signal": signal,
        })

    return results

def calculate_backtest(rows, signals, long_window, cost_rate=0.0):
    start = long_window
    wealth = 1.0
    peak = 1.0

    results = [{
        "date": rows[start]["date"],
        "signalDate": signals[start - 1]["date"],
        "position": 0,
        "assetReturn": None,
        "simpleReturn": None,
        "logReturn": None,
        "wealthIndex": wealth,
        "drawdown": 0.0,
        "turnover": 0,
        "transactionCost": 0.0,
        "executionDate": None,
        "grossReturn": None,
    }]

    previous_position = 0
    for index in range(start, len(rows) - 1):
        position = signals[index - 1]["signal"]
        turnover = abs(position - previous_position)

        current_open = float(rows[index]["adjOpen"])
        next_open = float(rows[index + 1]["adjOpen"])
        asset_return = next_open / current_open - 1

        gross_return = asset_return if position == 1 else 0.0
        transaction_cost = cost_rate * turnover
        strategy_return = (
            (1 - transaction_cost) * (1 + gross_return) - 1
        )
        wealth *= 1 + strategy_return
        peak = max(peak, wealth)

        results.append({
            "date": rows[index + 1]["date"],
            "signalDate": signals[index - 1]["date"],
            "position": position,
            "assetReturn": asset_return,
            "simpleReturn": strategy_return,
            "logReturn": math.log1p(strategy_return),
            "wealthIndex": wealth,
            "drawdown": wealth / peak - 1,
            "turnover": turnover,
            "grossReturn": gross_return,
            "transactionCost": transaction_cost,
            "executionDate": rows[index]["date"],
        })
        previous_position = position

    return results

def calculate_buy_and_hold(backtest, cost_rate=0.0):
    wealth = 1.0
    peak = 1.0

    results = [{
        "date": backtest[0]["date"],
        "simpleReturn": None,
        "wealthIndex": wealth,
        "drawdown": 0.0,
    }]

    for index, row in enumerate(backtest[1:]):
        asset_return = row["assetReturn"]

        # Buy once at the beginning; no further trades.
        transaction_cost = cost_rate if index == 0 else 0.0
        net_return = (
            (1 - transaction_cost) * (1 + asset_return) - 1
        )

        wealth *= 1 + net_return
        peak = max(peak, wealth)

        results.append({
            "date": row["date"],
            "simpleReturn": net_return,
            "wealthIndex": wealth,
            "drawdown": wealth / peak - 1,
        })

    return results

def save_backtest_results(input_file, backtest, buy_and_hold,
                          short_window, long_window, cost_bps):
    if len(backtest) != len(buy_and_hold):
        raise ValueError("Strategy and buy-and-hold dates do not match.")

    output_file = DATA_FOLDER / (
        f"{input_file.stem}_ma_{short_window}_{long_window}"
        f"_cost_{cost_bps:g}bps.csv"
    )

    columns = [
        "date", "signalDate", "executionDate", "position", "turnover",
        "assetReturn", "grossReturn", "transactionCost",
        "strategyReturn", "strategyWealthIndex", "strategyDrawdown",
        "buyHoldReturn", "buyHoldWealthIndex", "buyHoldDrawdown",
    ]

    with output_file.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()

        for strategy, hold in zip(backtest, buy_and_hold):
            if strategy["date"] != hold["date"]:
                raise ValueError("Strategy and buy-and-hold dates do not match.")

            writer.writerow({
                "date": strategy["date"],
                "signalDate": strategy["signalDate"],
                "executionDate": strategy["executionDate"],
                "position": strategy["position"],
                "turnover": strategy["turnover"],
                "assetReturn": strategy["assetReturn"],
                "grossReturn": strategy["grossReturn"],
                "transactionCost": strategy["transactionCost"],
                "strategyReturn": strategy["simpleReturn"],
                "strategyWealthIndex": strategy["wealthIndex"],
                "strategyDrawdown": strategy["drawdown"],
                "buyHoldReturn": hold["simpleReturn"],
                "buyHoldWealthIndex": hold["wealthIndex"],
                "buyHoldDrawdown": hold["drawdown"],
            })

    return output_file

def main():
    parser = argparse.ArgumentParser(
        description="Backtest a moving-average strategy."
    )
    parser.add_argument("input_file")
    parser.add_argument("--short", type=int, default=20)
    parser.add_argument("--long", type=int, default=50)
    parser.add_argument("--cost-bps", type=float, default=0.0)
    args = parser.parse_args()
    if not math.isfinite(args.cost_bps) or not 0 <= args.cost_bps < 10000:
        raise ValueError("Cost must be between 0 and 10000 basis points.")

    cost_rate = args.cost_bps / 10000

    if args.short <= 0 or args.long <= 0:
        raise ValueError("Moving-average windows must be positive.")
    if args.short >= args.long:
        raise ValueError("The short window must be smaller than the long window.")

    input_file = find_file(args.input_file)
    rows = load_data(input_file)

    if "adjOpen" not in rows[0]:
        raise ValueError("The CSV must contain adjOpen.")

    if len(rows) < args.long + 3:
        raise ValueError("Not enough trading days for this backtest.")

    for row in rows:
        for column in ("adjClose", "adjOpen"):
            price = float(row[column])
            if not math.isfinite(price) or price <= 0:
                raise ValueError(
                    f"Invalid {column} on {row['date']}."
                )
    signals = calculate_signals(rows, args.short, args.long)
    backtest = calculate_backtest(rows, signals, args.long, cost_rate)
    buy_and_hold = calculate_buy_and_hold(backtest, cost_rate)

    strategy_summary = summarize(backtest)
    buy_hold_summary = summarize(buy_and_hold)
    

    print(f"Cost per trade: {args.cost_bps:g} bps")
    print(
        f"\nComparison period: "
        f"{backtest[0]['date']} to {backtest[-1]['date']}"
    )
    print(f"{'Metric':<24}{'Strategy':>14}{'Buy & hold':>14}")
    print("-" * 52)

    for label, key in [
        ("Total return", "totalReturn"),
        ("Annualized return", "annualReturn"),
        ("Annualized volatility", "annualVolatility"),
        ("Maximum drawdown", "maximumDrawdown"),
    ]:
        print(
            f"{label:<24}"
            f"{strategy_summary[key]:>14.4%}"
            f"{buy_hold_summary[key]:>14.4%}"
        )

    print(
        f"{'Sharpe ratio':<24}"
        f"{strategy_summary['sharpeRatio']:>14.4f}"
        f"{buy_hold_summary['sharpeRatio']:>14.4f}"
    )
    first_return = backtest[1]

    print(f"First return date: {first_return['date']}")
    print(f"Position: {first_return['position']}")
    print(f"Asset return: {first_return['assetReturn']:.4%}")
    print(f"Strategy return: {first_return['simpleReturn']:.4%}")
    first_signal = signals[args.long - 1]
    print(f"First signal date: {first_signal['date']}")
    print(f"Short average: {first_signal['shortAverage']:.4f}")
    print(f"Long average: {first_signal['longAverage']:.4f}")
    print(f"Signal: {first_signal['signal']}")
    print("Data check successful.")
    print(f"Trading days: {len(rows)}")
    print(f"Short window: {args.short}")
    print(f"Long window: {args.long}")
    print(f"First date: {rows[0]['date']}")
    print(f"Last date: {rows[-1]['date']}")
    trades = [
        row for row in backtest[1:]
        if row["turnover"] > 0
    ]
    buys = sum(row["position"] == 1 for row in trades)
    sells = sum(row["position"] == 0 for row in trades)

    print(f"Buy trades: {buys}")
    print(f"Sell trades: {sells}")
    print(f"Total trades: {len(trades)}")
    output_file = save_backtest_results(
        input_file, backtest, buy_and_hold,
        args.short, args.long, args.cost_bps
    )
    print(f"Saved to: {output_file}")

if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as error:
        print(f"Backtest failed: {error}")