import csv
import math
import statistics
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from calculate_metrics import (
    calculate,
    load_data,
    save_data,
    summarize,
)


class CalculateMetricsTests(unittest.TestCase):
    def make_rows(self):
        return [
            {"date": "day-0", "adjClose": "100"},
            {"date": "day-1", "adjClose": "110"},
            {"date": "day-2", "adjClose": "99"},
            {"date": "day-3", "adjClose": "108.9"},
        ]

    def write_rows(self, file_path, rows):
        with file_path.open(
            "w",
            newline="",
            encoding="utf-8",
        ) as file:
            writer = csv.DictWriter(
                file,
                fieldnames=["date", "adjClose"],
            )
            writer.writeheader()
            writer.writerows(rows)

    def test_calculate_returns_and_drawdown(self):
        results = calculate(self.make_rows())

        self.assertIsNone(results[0]["simpleReturn"])
        self.assertAlmostEqual(
            results[1]["simpleReturn"],
            0.1,
        )
        self.assertAlmostEqual(
            results[2]["simpleReturn"],
            -0.1,
        )
        self.assertAlmostEqual(
            results[3]["simpleReturn"],
            0.1,
        )

        self.assertAlmostEqual(
            results[-1]["wealthIndex"],
            1.089,
        )
        self.assertAlmostEqual(
            results[2]["drawdown"],
            -0.1,
        )

    def test_summarize_metrics(self):
        results = calculate(self.make_rows())
        summary = summarize(results)

        expected_volatility = statistics.stdev(
            [0.1, -0.1, 0.1]
        ) * math.sqrt(252)

        self.assertAlmostEqual(
            summary["totalReturn"],
            0.089,
        )
        self.assertAlmostEqual(
            summary["annualVolatility"],
            expected_volatility,
        )
        self.assertAlmostEqual(
            summary["maximumDrawdown"],
            -0.1,
        )

    def test_load_data_sorts_and_rejects_duplicates(self):
        with TemporaryDirectory() as temp_dir:
            input_file = Path(temp_dir) / "prices.csv"

            self.write_rows(
                input_file,
                [
                    {"date": "day-2", "adjClose": "102"},
                    {"date": "day-1", "adjClose": "100"},
                ],
            )

            loaded = load_data(input_file)

            self.assertEqual(
                [row["date"] for row in loaded],
                ["day-1", "day-2"],
            )

            self.write_rows(
                input_file,
                [
                    {"date": "day-1", "adjClose": "100"},
                    {"date": "day-1", "adjClose": "101"},
                ],
            )

            with self.assertRaises(ValueError):
                load_data(input_file)

    def test_invalid_prices_and_csv_output(self):
        with self.assertRaises(ValueError):
            calculate([
                {"date": "day-0", "adjClose": "0"},
            ])

        with self.assertRaises(ValueError):
            calculate([
                {"date": "day-0", "adjClose": "nan"},
            ])

        with TemporaryDirectory() as temp_dir:
            input_file = Path(temp_dir) / "prices.csv"
            results = calculate(self.make_rows())
            output_file = save_data(input_file, results)

            with output_file.open(
                newline="",
                encoding="utf-8",
            ) as file:
                saved_rows = list(csv.DictReader(file))

            self.assertEqual(len(saved_rows), 4)
            self.assertEqual(saved_rows[0]["date"], "day-0")
            self.assertEqual(
                saved_rows[-1]["wealthIndex"],
                str(results[-1]["wealthIndex"]),
            )


if __name__ == "__main__":
    unittest.main()