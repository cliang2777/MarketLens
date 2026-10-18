import csv
import io
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

from compare_assets import (
    calculate_comparison,
    show_comparison,
)


class CompareAssetsTests(unittest.TestCase):
    def write_prices(self, file_path, dates, prices):
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

            for date, price in zip(dates, prices):
                writer.writerow({
                    "date": date,
                    "adjClose": price,
                })

    def create_files(self, folder):
        dates = ["day-0", "day-1", "day-2", "day-3"]
        asset_file = folder / "AAPL_sample.csv"
        benchmark_file = folder / "SPY_sample.csv"

        self.write_prices(
            asset_file,
            dates,
            [50, 60, 54, 64.8],
        )
        self.write_prices(
            benchmark_file,
            dates,
            [100, 110, 99, 108.9],
        )

        return asset_file, benchmark_file

    def test_calculate_correlation_and_beta(self):
        with TemporaryDirectory() as temp_dir:
            asset_file, benchmark_file = self.create_files(
                Path(temp_dir)
            )

            result = calculate_comparison(
                asset_file,
                benchmark_file,
            )

            self.assertEqual(result["assetName"], "AAPL")
            self.assertEqual(
                result["benchmarkName"],
                "SPY",
            )
            self.assertAlmostEqual(
                result["returnCorrelation"],
                1.0,
            )
            self.assertAlmostEqual(
                result["beta"],
                1.5,
            )
            self.assertGreater(
                result["annualReturnDifference"],
                0,
            )

    def test_show_comparison_returns_result(self):
        with TemporaryDirectory() as temp_dir:
            asset_file, benchmark_file = self.create_files(
                Path(temp_dir)
            )

            output = io.StringIO()

            with redirect_stdout(output):
                result = show_comparison(
                    asset_file,
                    benchmark_file,
                )

            self.assertAlmostEqual(result["beta"], 1.5)
            self.assertIn("Return correlation: 1.0000", output.getvalue())
            self.assertIn("Beta: 1.5000", output.getvalue())

    def test_rejects_mismatched_dates(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            asset_file = folder / "AAPL_sample.csv"
            benchmark_file = folder / "SPY_sample.csv"

            self.write_prices(
                asset_file,
                ["day-0", "day-1", "day-2", "day-3"],
                [50, 60, 54, 64.8],
            )
            self.write_prices(
                benchmark_file,
                ["day-0", "day-1", "day-X", "day-3"],
                [100, 110, 99, 108.9],
            )

            with self.assertRaises(ValueError):
                calculate_comparison(
                    asset_file,
                    benchmark_file,
                )


if __name__ == "__main__":
    unittest.main()