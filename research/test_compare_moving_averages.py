import csv
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from compare_moving_averages import (
    build_window_pairs,
    compare_window_pairs,
    save_comparison_results,
)


class MovingAverageComparisonTests(unittest.TestCase):
    def make_rows(self):
        closes = [
            10, 11, 12, 13, 12, 11,
            10, 9, 10, 11, 12, 13,
        ]
        opens = [
            10, 10.5, 11, 12, 11.5, 11,
            10.5, 10, 10.2, 10.8, 11.5, 12.5,
        ]

        return [
            {
                "date": f"day-{index}",
                "adjClose": str(close),
                "adjOpen": str(open_price),
            }
            for index, (close, open_price)
            in enumerate(zip(closes, opens))
        ]

    def test_build_window_pairs(self):
        pairs = build_window_pairs(
            [20, 10, 20, 50],
            [50, 100],
        )

        self.assertEqual(
            pairs,
            [
                (10, 50),
                (10, 100),
                (20, 50),
                (20, 100),
                (50, 100),
            ],
        )

        with self.assertRaises(ValueError):
            build_window_pairs([50], [20])

        with self.assertRaises(ValueError):
            build_window_pairs([-10], [50])

    def test_combinations_share_comparison_period(self):
        rows = self.make_rows()
        pairs = [(1, 2), (2, 4)]

        results, start_date, end_date = compare_window_pairs(
            rows,
            pairs,
            0.001,
        )

        self.assertEqual(len(results), 2)
        self.assertEqual(start_date, "day-4")
        self.assertEqual(end_date, "day-11")

        self.assertEqual(
            [
                (result["shortWindow"], result["longWindow"])
                for result in results
            ],
            pairs,
        )

        for result in results:
            self.assertIn("totalReturn", result)
            self.assertIn("sharpeRatio", result)
            self.assertIsInstance(result["totalTrades"], int)

    def test_save_comparison_results(self):
        rows = self.make_rows()
        results, start_date, end_date = compare_window_pairs(
            rows,
            [(1, 2), (2, 4)],
            0.001,
        )

        with TemporaryDirectory() as temp_dir:
            with patch(
                "compare_moving_averages.DATA_FOLDER",
                Path(temp_dir),
            ):
                output_file = save_comparison_results(
                    Path("sample.csv"),
                    results,
                    start_date,
                    end_date,
                    10,
                )

                with output_file.open(
                    newline="",
                    encoding="utf-8",
                ) as file:
                    saved_rows = list(csv.DictReader(file))

                self.assertEqual(
                    output_file.name,
                    "moving_average_comparison_sample_cost_10bps.csv",
                )
                self.assertEqual(len(saved_rows), 2)
                self.assertEqual(
                    saved_rows[0]["comparisonStart"],
                    "day-4",
                )
                self.assertEqual(
                    saved_rows[0]["comparisonEnd"],
                    "day-11",
                )
                self.assertEqual(
                    saved_rows[0]["shortWindow"],
                    "1",
                )


if __name__ == "__main__":
    unittest.main()