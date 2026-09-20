import unittest
import csv
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from backtest_moving_average import (
    calculate_backtest,
    calculate_buy_and_hold,
    calculate_signals,
    save_backtest_results,
)

class MovingAverageBacktestTests(unittest.TestCase):
    def test_next_open_execution_and_costs(self):
        closes = [10, 12, 8, 9, 9]
        opens = [10, 11, 12, 13, 14]

        rows = [
            {
                "date": f"day-{index}",
                "adjClose": str(close),
                "adjOpen": str(open_price),
            }
            for index, (close, open_price)
            in enumerate(zip(closes, opens))
        ]

        signals = calculate_signals(rows, 1, 2)
        strategy = calculate_backtest(rows, signals, 2, 0.001)
        buy_and_hold = calculate_buy_and_hold(strategy, 0.001)

        self.assertEqual(
            [row["position"] for row in strategy],
            [0, 1, 0],
        )
        self.assertEqual(
            [row["turnover"] for row in strategy[1:]],
            [1, 1],
        )

        # day-1 close signal -> day-2 open buy.
        self.assertEqual(strategy[1]["signalDate"], "day-1")
        self.assertEqual(strategy[1]["executionDate"], "day-2")
        self.assertEqual(strategy[1]["date"], "day-3")
        self.assertAlmostEqual(
            strategy[1]["simpleReturn"],
            (1 - 0.001) * (13 / 12) - 1,
        )

        # day-3 open sell; cash earns 0, but pays the selling cost.
        self.assertAlmostEqual(
            strategy[2]["simpleReturn"],
            -0.001,
        )

        # Buy-and-hold pays once, on its initial purchase.
        self.assertAlmostEqual(
            buy_and_hold[1]["simpleReturn"],
            (1 - 0.001) * (13 / 12) - 1,
        )
        self.assertAlmostEqual(
            buy_and_hold[2]["simpleReturn"],
            14 / 13 - 1,
        )

    def test_save_backtest_results(self):
        closes = [10, 12, 8, 9, 9]
        opens = [10, 11, 12, 13, 14]
        rows = [
            {
                "date": f"day-{index}",
                "adjClose": str(close),
                "adjOpen": str(open_price),
            }
            for index, (close, open_price)
            in enumerate(zip(closes, opens))
        ]

        signals = calculate_signals(rows, 1, 2)
        strategy = calculate_backtest(rows, signals, 2, 0.001)
        buy_and_hold = calculate_buy_and_hold(strategy, 0.001)

        with TemporaryDirectory() as temp_dir:
            with patch("backtest_moving_average.DATA_FOLDER", Path(temp_dir)):
                output_file = save_backtest_results(
                    Path("sample.csv"), strategy, buy_and_hold,
                    1, 2, 10
                )

                self.assertEqual(
                    output_file.name,
                    "sample_ma_1_2_cost_10bps.csv",
                )

                with output_file.open(newline="", encoding="utf-8") as file:
                    reader = csv.DictReader(file)
                    saved_rows = list(reader)

                self.assertEqual(len(saved_rows), len(strategy))
                self.assertEqual(
                    [row["date"] for row in saved_rows],
                    [row["date"] for row in strategy],
                )
                self.assertEqual(saved_rows[0]["strategyReturn"], "")
                self.assertEqual(saved_rows[1]["signalDate"], "day-1")
                self.assertEqual(saved_rows[1]["executionDate"], "day-2")
                self.assertEqual(saved_rows[1]["position"], "1")
                self.assertAlmostEqual(
                    float(saved_rows[1]["strategyReturn"]),
                    strategy[1]["simpleReturn"],
                )
                self.assertAlmostEqual(
                    float(saved_rows[1]["buyHoldReturn"]),
                    buy_and_hold[1]["simpleReturn"],
                )

                with self.assertRaises(ValueError):
                    save_backtest_results(
                        Path("sample.csv"), strategy, buy_and_hold[:-1],
                        1, 2, 10
                    )


if __name__ == "__main__":
    unittest.main()