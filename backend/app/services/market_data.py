import json
import ssl
import time
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import certifi

from backend.app.config import get_tiingo_token
from backend.app.services.cache_store import (
    get_cached_rows,
    is_range_covered,
    normalize_date_str,
    store_price_rows,
)


class MarketDataError(ValueError):
    """Raised when market data cannot be retrieved or validated."""


def _fetch_from_tiingo(ticker: str, start_str: str, end_str: str) -> list[dict]:
    token = get_tiingo_token()
    if not token:
        raise MarketDataError(
            f"No cached data for {ticker} ({start_str} to {end_str}) and "
            "TIINGO_API_TOKEN is not configured in .env."
        )

    parameters = {
        "startDate": start_str,
        "endDate": end_str,
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
            "User-Agent": "MarketLens Quantitative Terminal",
        },
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())

    try:
        with urlopen(request, timeout=25, context=ssl_context) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code == 404:
            raise MarketDataError(f"Ticker '{ticker}' was not found on Tiingo.") from error
        if error.code in (401, 403):
            raise MarketDataError(
                "Tiingo API rejected the token (HTTP 401/403). Check TIINGO_API_TOKEN in .env."
            ) from error
        if error.code == 429:
            raise MarketDataError(
                "Tiingo API rate limit reached (HTTP 429). Cached tickers remain available."
            ) from error
        raise MarketDataError(f"Tiingo API error (HTTP {error.code}) for {ticker}.") from error
    except URLError as error:
        raise MarketDataError(f"Network error connecting to Tiingo: {error.reason}") from error

    if not isinstance(payload, list) or not payload:
        raise MarketDataError(
            f"Tiingo returned no historical prices for {ticker} between {start_str} and {end_str}."
        )

    cleaned: list[dict] = []
    for row in payload:
        if "date" not in row or "adjClose" not in row:
            raise MarketDataError(f"Tiingo data for {ticker} is missing date or adjClose.")
        normalized = dict(row)
        normalized["date"] = normalize_date_str(row["date"])
        cleaned.append(normalized)

    cleaned.sort(key=lambda r: r["date"])
    return cleaned


def fetch_price_series(
    ticker: str,
    start_date: date,
    end_date: date,
    force_refresh: bool = False,
) -> tuple[list[dict], dict]:
    """
    Fetch historical daily prices with transparent persistent cache lookup.
    Returns (rows, meta_telemetry).
    """
    t0 = time.perf_counter()
    clean_ticker = ticker.strip().upper()
    if not clean_ticker:
        raise MarketDataError("Ticker symbol cannot be empty.")
    if start_date >= end_date:
        raise MarketDataError("Start date must be strictly before end date.")

    start_str = start_date.isoformat()
    end_str = end_date.isoformat()

    if not force_refresh and is_range_covered(clean_ticker, start_str, end_str):
        rows = get_cached_rows(clean_ticker, start_str, end_str)
        if rows:
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
            return rows, {
                "ticker": clean_ticker,
                "source": "cache",
                "elapsedMs": elapsed_ms,
                "bars": len(rows),
            }

    live_rows = _fetch_from_tiingo(clean_ticker, start_str, end_str)
    store_price_rows(clean_ticker, live_rows, start_str, end_str)
    rows = get_cached_rows(clean_ticker, start_str, end_str)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    return rows, {
        "ticker": clean_ticker,
        "source": "tiingo",
        "elapsedMs": elapsed_ms,
        "bars": len(rows),
    }
