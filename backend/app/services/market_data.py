import difflib
import json
import re
import ssl
import time
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import certifi

from backend.app.config import get_tiingo_token
from backend.app.services.cache_store import (
    get_cached_profile,
    get_cached_rows,
    is_range_covered,
    normalize_date_str,
    store_asset_profile,
    store_price_rows,
)

COMMON_TYPOS = {
    "APPL": "AAPL",
    "APLE": "AAPL",
    "APPLE": "AAPL",
    "MSF": "MSFT",
    "MICROSOFT": "MSFT",
    "NVDIA": "NVDA",
    "NVIDIA": "NVDA",
    "GOOGE": "GOOGL",
    "GOOGLE": "GOOGL",
    "TELA": "TSLA",
    "TSAL": "TSLA",
    "TESLA": "TSLA",
    "AMAZN": "AMZN",
    "AMAZON": "AMZN",
    "FACEBOOK": "META",
    "SP500": "SPY",
    "SPX": "SPY",
    "S&P500": "SPY",
    "NASDAQ": "QQQ",
    "NDX": "QQQ",
    "GOLD": "GLD",
}

POPULAR_US_TICKERS = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA",
    "JPM", "BRK-B", "V", "MA", "UNH", "JNJ", "PG", "KO", "PEP", "COST",
    "WMT", "NFLX", "AMD", "INTC", "AVGO", "ORCL", "CRM", "DIS", "BA",
    "SPY", "QQQ", "DIA", "IWM", "VTI", "VOO", "TLT", "IEF", "GLD", "SLV", "VNQ", "XLF", "XLK",
]

NON_US_SUFFIX_RE = re.compile(r"\.(HK|SS|SZ|SH|L|T|TO|PA|DE|AS|SW|AX|KS|TW|SI)$", re.IGNORECASE)


class MarketDataError(ValueError):
    """Raised when market data cannot be retrieved or validated."""


def _suggest_us_ticker(ticker: str) -> str | None:
    if ticker in COMMON_TYPOS:
        return COMMON_TYPOS[ticker]
    matches = difflib.get_close_matches(ticker, POPULAR_US_TICKERS, n=1, cutoff=0.65)
    return matches[0] if matches else None


def validate_us_ticker_format(ticker: str) -> None:
    if not ticker:
        raise MarketDataError("US ticker symbol cannot be empty (e.g. AAPL, MSFT, SPY).")

    if ticker.isdigit() or NON_US_SUFFIX_RE.search(ticker):
        raise MarketDataError(
            f"'{ticker}' looks like a non-US security code. AlphaMetric uses Tiingo US market data — "
            "please enter a US-listed ticker symbol (NYSE / NASDAQ / ARCA), such as AAPL, MSFT, NVDA, or SPY."
        )

    if ticker in COMMON_TYPOS:
        suggestion = COMMON_TYPOS[ticker]
        raise MarketDataError(
            f"US ticker '{ticker}' is not a valid symbol. Did you mean {suggestion}?"
        )


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
            "User-Agent": "AlphaMetric Quantitative Terminal",
        },
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())

    try:
        with urlopen(request, timeout=25, context=ssl_context) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code == 404:
            suggestion = _suggest_us_ticker(ticker)
            hint = f" Did you mean {suggestion}?" if suggestion else ""
            raise MarketDataError(
                f"US ticker '{ticker}' was not found on Tiingo (NYSE / NASDAQ / ARCA).{hint}"
            ) from error
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
            f"Tiingo returned no historical prices for US ticker {ticker} between {start_str} and {end_str}."
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


def fetch_asset_profile(ticker: str, force_refresh: bool = False) -> dict | None:
    """Fetch and permanently cache US company/ETF metadata from Tiingo."""
    clean_ticker = ticker.strip().upper()
    if not clean_ticker:
        return None

    if not force_refresh:
        cached = get_cached_profile(clean_ticker)
        if cached:
            return cached

    token = get_tiingo_token()
    if not token:
        return None

    url = f"https://api.tiingo.com/tiingo/daily/{quote(clean_ticker, safe='.-')}"
    request = Request(
        url,
        headers={
            "Authorization": f"Token {token}",
            "User-Agent": "AlphaMetric Quantitative Terminal",
        },
    )
    ssl_context = ssl.create_default_context(cafile=certifi.where())

    try:
        with urlopen(request, timeout=15, context=ssl_context) as response:
            raw = json.loads(response.read().decode("utf-8"))
        if not isinstance(raw, dict) or not raw.get("ticker"):
            return None
        profile = {
            "ticker": str(raw.get("ticker", clean_ticker)).upper(),
            "name": str(raw.get("name") or "").strip(),
            "exchangeCode": str(raw.get("exchangeCode") or "US").strip(),
            "startDate": str(raw.get("startDate") or "")[:10],
            "endDate": str(raw.get("endDate") or "")[:10],
            "description": str(raw.get("description") or "").strip(),
        }
        return store_asset_profile(profile)
    except Exception:
        return None


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
    validate_us_ticker_format(clean_ticker)
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
