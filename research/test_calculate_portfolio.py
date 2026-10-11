import csv
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from calculate_portfolio import (
    build_portfolio,
    check_inputs,
    save_portfolio,
)


class CalculatePortfolioTests(unittest.TestCase):
    def write_prices(self, file_path, prices):
        rows = [
            {
                "date": f"day-{index}",
                "adjClose": str(price),
            }
            for index, price in enumerate(prices)
        ]

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

    def test_check_inputs(self):
        check_inputs(["AAPL", "MSFT"], [0.6, 0.4])

        with self.assertRaises(ValueError):
            check_inputs(["AAPL"], [1.0])

        with self.assertRaises(ValueError):
            check_inputs(
                ["AAPL", "MSFT"],
                [1.0],
            )

        with self.assertRaises(ValueError):
            check_inputs(
                ["AAPL", "MSFT"],
                [1.1, -0.1],
            )

        with self.assertRaises(ValueError):
            check_inputs(
                ["AAPL", "MSFT"],
                [0.6, 0.3],
            )

    def test_build_portfolio(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            first_file = folder / "AAPL.csv"
            second_file = folder / "MSFT.csv"

            self.write_prices(
                first_file,
                [100, 110, 90],
            )
            self.write_prices(
                second_file,
                [200, 160, 180],
            )

            results = build_portfolio(
                [first_file, second_file],
                [0.5, 0.5],
            )

            self.assertEqual(len(results), 3)
            self.assertAlmostEqual(
                results[0]["portfolioValue"],
                1.0,
            )
            self.assertAlmostEqual(
                results[1]["portfolioValue"],
                0.95,
            )
            self.assertAlmostEqual(
                results[2]["portfolioValue"],
                0.9,
            )
            self.assertAlmostEqual(
                results[1]["simpleReturn"],
                -0.05,
            )
            self.assertAlmostEqual(
                results[2]["drawdown"],
                -0.1,
            )

    def test_rejects_mismatched_dates_and_invalid_prices(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            first_file = folder / "AAPL.csv"
            second_file = folder / "MSFT.csv"

            self.write_prices(first_file, [100, 110, 120])
            self.write_prices(second_file, [200, 210])

            with self.assertRaises(ValueError):
                build_portfolio(
                    [first_file, second_file],
                    [0.5, 0.5],
                )

            self.write_prices(
                second_file,
                [200, float("nan"), 220],
            )

            with self.assertRaises(ValueError):
                build_portfolio(
                    [first_file, second_file],
                    [0.5, 0.5],
                )

    def test_save_portfolio(self):
        results = [
            {
                "date": "day-0",
                "portfolioValue": 1.0,
                "simpleReturn": None,
                "logReturn": None,
                "wealthIndex": 1.0,
                "drawdown": 0.0,
            }
        ]

        with TemporaryDirectory() as temp_dir:
            with patch(
                "calculate_portfolio.DATA_FOLDER",
                Path(temp_dir),
            ):
                output_file = save_portfolio(
                    [
                        Path("AAPL.csv"),
                        Path("MSFT.csv"),
                    ],
                    [0.6, 0.4],
                    results,
                )

                with output_file.open(
                    newline="",
                    encoding="utf-8",
                ) as file:
                    saved_rows = list(csv.DictReader(file))

                self.assertEqual(
                    output_file.name,
                    "portfolio_AAPL_60_MSFT_40.csv",
                )
                self.assertEqual(len(saved_rows), 1)
                self.assertEqual(
                    saved_rows[0]["portfolioValue"],
                    "1.0",
                )


if __name__ == "__main__":
    unittest.main()