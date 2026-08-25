import argparse
import csv
import json
import os
import ssl
from datetime import date
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import certifi


PROJECT_FOLDER = Path(__file__).resolve().parents[1]
DATA_FOLDER = PROJECT_FOLDER / "research" / "data"
ENV_FILE = PROJECT_FOLDER / ".env"


def load_token():
    token = os.getenv("TIINGO_API_TOKEN")
    if token:
        return token
    if not ENV_FILE.exists():
        raise FileNotFoundError("Cannot find the .env file.")
    for line in ENV_FILE.read_text().splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == "TIINGO_API_TOKEN":
            token = value.strip().strip('"').strip("'")
            if token:
                return token
    raise ValueError("TIINGO_API_TOKEN is missing from .env.")


def check_dates(start_date, end_date):
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError as error:
        raise ValueError("Dates must use YYYY-MM-DD format.") from error
    if start > end:
        raise ValueError("The start date must be before the end date.")


def download_data(ticker, start_date, end_date):
    ticker = ticker.strip().upper()
    check_dates(start_date, end_date)
    token = load_token()
    parameters = {
        "startDate": start_date,
        "endDate": end_date,
        "resampleFreq": "daily",
    }
    url = (
        "https://api.tiingo.com/tiingo/daily/"
        + quote(ticker, safe=".-")
        + "/prices?"
        + urlencode(parameters)
    )

    request = Request(
        url,
        headers={
            "Authorization": f"Token {token}",
            "User-Agent": "MarketLens research",
        },
    )

    ssl_context = ssl.create_default_context(
        cafile=certifi.where()
    )

    with urlopen(
        request,
        timeout=30,
        context=ssl_context,
    ) as response:
        data = json.loads(response.read().decode("utf-8"))

    if not isinstance(data, list) or not data:
        raise ValueError("Tiingo returned no price data.")

    data.sort(key=lambda row: row["date"])
    DATA_FOLDER.mkdir(parents=True, exist_ok=True)

    output_file = DATA_FOLDER / (
        f"{ticker}_{start_date}_{end_date}.csv"
    )

    with output_file.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=data[0].keys(),
        )
        writer.writeheader()
        writer.writerows(data)

    print("Tiingo download successful.")
    print(f"Ticker: {ticker}")
    print(f"Rows downloaded: {len(data)}")
    print(f"First date: {data[0]['date']}")
    print(f"Last date: {data[-1]['date']}")
    print(f"Saved to: {output_file}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("ticker")
    parser.add_argument("start_date")
    parser.add_argument("end_date")
    args = parser.parse_args()

    download_data(
        ticker=args.ticker,
        start_date=args.start_date,
        end_date=args.end_date,
    )


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        print(f"Tiingo request failed: HTTP {error.code}")
    except URLError as error:
        print(f"Network connection failed: {error.reason}")
    except (FileNotFoundError, ValueError) as error:
        print(f"Download failed: {error}")