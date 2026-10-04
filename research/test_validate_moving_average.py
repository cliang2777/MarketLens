import csv
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from validate_moving_average import (
    evaluate_out_of_sample,
    save_validation_summary,
    split_data,
)


class MovingAverageValidationTests(unittest.TestCase):
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

    def test_split_data_is_chronological(self):
        rows = self.make_rows()

        training, testing, split_index = split_data(
            rows,
            0.5,
        )

        self.assertEqual(split_index, 6)
        self.assertEqual(training[0]["date"], "day-0")
        self.assertEqual(training[-1]["date"], "day-5")
        self.assertEqual(testing[0]["date"], "day-6")
        self.assertEqual(testing[-1]["date"], "day-11")

        with self.assertRaises(ValueError):
            split_data(rows, 0)

        with self.assertRaises(ValueError):
            split_data(rows, 1)

    def test_out_of_sample_uses_previous_signal(self):
        rows = self.make_rows()

        result = evaluate_out_of_sample(
            rows,
            split_index=6,
            short_window=1,
            long_window=2,
            cost_rate=0.001,
        )

        strategy = result["strategy"]
        first_return = strategy[1]

        self.assertEqual(strategy[0]["date"], "day-6")
        self.assertEqual(first_return["signalDate"], "day-5")
        self.assertEqual(first_return["executionDate"], "day-6")
        self.assertEqual(first_return["date"], "day-7")
        self.assertEqual(
            len(result["buyAndHold"]),
            len(strategy),
        )

    def test_save_validation_summary(self):
        rows = self.make_rows()
        test_result = evaluate_out_of_sample(
            rows,
            split_index=6,
            short_window=1,
            long_window=2,
            cost_rate=0.001,
        )

        training_result = {
            "shortWindow": 1,
            "longWindow": 2,
            "totalReturn": 0.2,
            "sharpeRatio": 0.5,
        }

        with TemporaryDirectory() as temp_dir:
            with patch(
                "validate_moving_average.DATA_FOLDER",
                Path(temp_dir),
            ):
                output_file = save_validation_summary(
                    Path("sample.csv"),
                    0.5,
                    10,
                    training_result,
                    "day-2",
                    "day-5",
                    test_result,
                )

                with output_file.open(
                    newline="",
                    encoding="utf-8",
                ) as file:
                    saved_rows = list(csv.DictReader(file))

                self.assertEqual(
                    output_file.name,
                    "moving_average_validation_sample"
                    "_train_50_cost_10bps.csv",
                )
                self.assertEqual(len(saved_rows), 1)
                self.assertEqual(
                    saved_rows[0]["trainingEnd"],
                    "day-5",
                )
                self.assertEqual(
                    saved_rows[0]["testingStart"],
                    "day-6",
                )
                self.assertEqual(
                    saved_rows[0]["shortWindow"],
                    "1",
                )


if __name__ == "__main__":
    unittest.main()