import argparse
import math
import csv
from compare_moving_averages import (
    build_window_pairs,
    compare_window_pairs,
)
from backtest_moving_average import (
    calculate_backtest,
    calculate_buy_and_hold,
    calculate_signals,
)
from calculate_metrics import DATA_FOLDER, load_data, summarize
from calculate_portfolio import find_file


def split_data(rows, train_ratio):
    if not math.isfinite(train_ratio) or not 0 < train_ratio < 1:
        raise ValueError(
            "Train ratio must be greater than 0 and smaller than 1."
        )

    split_index = int(len(rows) * train_ratio)

    if split_index < 3 or len(rows) - split_index < 3:
        raise ValueError(
            "Training and testing periods must each contain "
            "at least three trading days."
        )

    training_rows = rows[:split_index]
    testing_rows = rows[split_index:]

    return training_rows, testing_rows, split_index

def evaluate_out_of_sample(
        rows, split_index, short_window, long_window, cost_rate):
    if split_index < long_window:
        raise ValueError(
            "Training period is shorter than the selected long window."
        )

    if len(rows) - split_index < 3:
        raise ValueError(
            "Not enough testing data to calculate annual metrics."
        )

    signals = calculate_signals(
        rows,
        short_window,
        long_window,
    )

    strategy = calculate_backtest(
        rows,
        signals,
        split_index,
        cost_rate,
    )
    buy_and_hold = calculate_buy_and_hold(
        strategy,
        cost_rate,
    )

    total_trades = sum(
        row["turnover"] > 0
        for row in strategy[1:]
    )

    return {
        "strategy": strategy,
        "buyAndHold": buy_and_hold,
        "strategySummary": summarize(strategy),
        "buyHoldSummary": summarize(buy_and_hold),
        "totalTrades": total_trades,
    }

def save_validation_summary(
        input_file, train_ratio, cost_bps,
        training_result, training_start, training_end,
        test_result):
    train_percent = train_ratio * 100
    strategy = test_result["strategy"]
    strategy_summary = test_result["strategySummary"]
    buy_hold_summary = test_result["buyHoldSummary"]

    output_file = DATA_FOLDER / (
        f"moving_average_validation_{input_file.stem}"
        f"_train_{train_percent:g}"
        f"_cost_{cost_bps:g}bps.csv"
    )

    record = {
        "trainingStart": training_start,
        "trainingEnd": training_end,
        "testingStart": strategy[0]["date"],
        "testingEnd": strategy[-1]["date"],
        "trainRatio": train_ratio,
        "shortWindow": training_result["shortWindow"],
        "longWindow": training_result["longWindow"],
        "costBps": cost_bps,
        "trainingTotalReturn": training_result["totalReturn"],
        "trainingSharpeRatio": training_result["sharpeRatio"],
        "testingStrategyTotalReturn":
            strategy_summary["totalReturn"],
        "testingStrategyAnnualReturn":
            strategy_summary["annualReturn"],
        "testingStrategyVolatility":
            strategy_summary["annualVolatility"],
        "testingStrategySharpeRatio":
            strategy_summary["sharpeRatio"],
        "testingStrategyMaximumDrawdown":
            strategy_summary["maximumDrawdown"],
        "testingBuyHoldTotalReturn":
            buy_hold_summary["totalReturn"],
        "testingBuyHoldAnnualReturn":
            buy_hold_summary["annualReturn"],
        "testingBuyHoldVolatility":
            buy_hold_summary["annualVolatility"],
        "testingBuyHoldSharpeRatio":
            buy_hold_summary["sharpeRatio"],
        "testingBuyHoldMaximumDrawdown":
            buy_hold_summary["maximumDrawdown"],
        "testingTrades": test_result["totalTrades"],
    }

    with output_file.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=record.keys(),
        )
        writer.writeheader()
        writer.writerow(record)

    return output_file

def main():
    parser = argparse.ArgumentParser(
        description="Validate moving-average parameters out of sample."
    )
    parser.add_argument("input_file")
    parser.add_argument(
        "--train-ratio",
        type=float,
        default=0.7,
    )
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

    input_file = find_file(args.input_file)
    rows = load_data(input_file)

    training_rows, testing_rows, split_index = split_data(
        rows,
        args.train_ratio,
    )
    pairs = build_window_pairs(
        args.short_windows,
        args.long_windows,
    )
    cost_rate = args.cost_bps / 10000

    training_results, comparison_start, comparison_end = (
        compare_window_pairs(
            training_rows,
            pairs,
            cost_rate,
        )
    )

    best_training_result = max(
        training_results,
        key=lambda result: result["sharpeRatio"],
    )

    selected_short = best_training_result["shortWindow"]
    selected_long = best_training_result["longWindow"]

    test_result = evaluate_out_of_sample(
        rows,
        split_index,
        selected_short,
        selected_long,
        cost_rate,
    )

    strategy_summary = test_result["strategySummary"]
    buy_hold_summary = test_result["buyHoldSummary"]
    test_strategy = test_result["strategy"]

    print(f"Input file: {input_file.name}")
    print(f"Total observations: {len(rows)}")
    print(f"Split index: {split_index}")
    print(f"Training observations: {len(training_rows)}")
    print(
        f"Training period: "
        f"{training_rows[0]['date']} to "
        f"{training_rows[-1]['date']}"
    )
    print(f"Testing observations: {len(testing_rows)}")
    print(
        f"Testing period: "
        f"{testing_rows[0]['date']} to "
        f"{testing_rows[-1]['date']}"
    )
    print(f"\nCandidate combinations: {len(pairs)}")
    print(f"Cost per trade: {args.cost_bps:g} bps")
    print(
        f"Training comparison period: "
        f"{comparison_start} to {comparison_end}"
    )

    print("\nBest training result:")
    print(
        f"Windows: "
        f"{best_training_result['shortWindow']}/"
        f"{best_training_result['longWindow']}"
    )
    print(
        f"Total return: "
        f"{best_training_result['totalReturn']:.4%}"
    )
    print(
        f"Annualized return: "
        f"{best_training_result['annualReturn']:.4%}"
    )
    print(
        f"Annualized volatility: "
        f"{best_training_result['annualVolatility']:.4%}"
    )
    print(
        f"Sharpe ratio: "
        f"{best_training_result['sharpeRatio']:.4f}"
    )
    print(
        f"Maximum drawdown: "
        f"{best_training_result['maximumDrawdown']:.4%}"
    )
    print(
        f"Total trades: "
        f"{best_training_result['totalTrades']}"
    )
    print("\nOut-of-sample result:")
    print(
        f"Selected windows: "
        f"{selected_short}/{selected_long}"
    )
    print(
        f"Comparison period: "
        f"{test_strategy[0]['date']} to "
        f"{test_strategy[-1]['date']}"
    )

    print(
        f"{'Metric':<24}"
        f"{'Strategy':>14}"
        f"{'Buy & hold':>14}"
    )
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
    print(
        f"Out-of-sample trades: "
        f"{test_result['totalTrades']}"
    )
    output_file = save_validation_summary(
        input_file,
        args.train_ratio,
        args.cost_bps,
        best_training_result,
        comparison_start,
        comparison_end,
        test_result,
    )
    print(f"Saved to: {output_file}")

if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as error:
        print(f"Validation failed: {error}")