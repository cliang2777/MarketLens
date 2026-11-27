import csv
import re
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from sqlalchemy import delete, func, select

from backend.app.config import RESEARCH_DATA_DIR
from backend.app.db import CACHE_BACKEND, SessionLocal
from backend.app.models import AssetProfile, FetchCoverage, PriceBar

_CACHE_WRITE_LOCK = threading.Lock()

RAW_CSV_PATTERN = re.compile(
    r"^([A-Z0-9.\-]+)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.csv$"
)


def normalize_date_str(raw_date: str) -> str:
    clean = str(raw_date).strip()
    if len(clean) >= 10:
        clean = clean[:10]
    date.fromisoformat(clean)
    return clean


def _safe_float(val, default: float = 0.0) -> float:
    if val is None or val == "":
        return default
    return float(val)


def is_range_covered(ticker: str, start_str: str, end_str: str) -> bool:
    ticker = ticker.upper().strip()
    with SessionLocal() as session:
        stmt = select(FetchCoverage).where(
            FetchCoverage.ticker == ticker,
            FetchCoverage.covered_start <= start_str,
            FetchCoverage.covered_end >= end_str,
        )
        return session.scalars(stmt).first() is not None


def get_cached_rows(ticker: str, start_str: str, end_str: str) -> list[dict]:
    ticker = ticker.upper().strip()
    with SessionLocal() as session:
        stmt = (
            select(PriceBar)
            .where(
                PriceBar.ticker == ticker,
                PriceBar.trade_date >= start_str,
                PriceBar.trade_date <= end_str,
            )
            .order_by(PriceBar.trade_date.asc())
        )
        bars = session.scalars(stmt).all()
        return [bar.to_research_row() for bar in bars]


def _merge_intervals(intervals: list[tuple[str, str]]) -> list[tuple[str, str]]:
    if not intervals:
        return []
    ordered = sorted(intervals, key=lambda x: (x[0], x[1]))
    merged = [ordered[0]]
    for cur_start, cur_end in ordered[1:]:
        prev_start, prev_end = merged[-1]
        prev_end_dt = date.fromisoformat(prev_end)
        cur_start_dt = date.fromisoformat(cur_start)
        if cur_start_dt <= prev_end_dt + timedelta(days=3):
            new_end = max(prev_end, cur_end)
            merged[-1] = (prev_start, new_end)
        else:
            merged.append((cur_start, cur_end))
    return merged


def store_price_rows(
    ticker: str,
    rows: list[dict],
    covered_start: str,
    covered_end: str,
) -> int:
    ticker = ticker.upper().strip()
    if not rows:
        return 0

    now = datetime.now(timezone.utc)
    normalized_by_date: dict[str, dict] = {}
    for row in rows:
        d = normalize_date_str(row["date"])
        adj_close = _safe_float(row.get("adjClose"))
        close_px = _safe_float(row.get("close"), adj_close)
        adj_open = _safe_float(row.get("adjOpen"), adj_close)
        adj_high = _safe_float(row.get("adjHigh"), max(adj_open, adj_close))
        adj_low = _safe_float(row.get("adjLow"), min(adj_open, adj_close))

        normalized_by_date[d] = {
            "trade_date": d,
            "open": _safe_float(row.get("open"), close_px),
            "high": _safe_float(row.get("high"), close_px),
            "low": _safe_float(row.get("low"), close_px),
            "close": close_px,
            "volume": _safe_float(row.get("volume"), 0.0),
            "adj_open": adj_open,
            "adj_high": adj_high,
            "adj_low": adj_low,
            "adj_close": adj_close,
            "adj_volume": _safe_float(row.get("adjVolume"), 0.0),
            "div_cash": _safe_float(row.get("divCash"), 0.0),
            "split_factor": _safe_float(row.get("splitFactor"), 1.0),
        }

    min_date = min(normalized_by_date)
    max_date = max(normalized_by_date)

    with _CACHE_WRITE_LOCK, SessionLocal() as session:
        existing_bars = {
            b.trade_date: b
            for b in session.scalars(
                select(PriceBar).where(
                    PriceBar.ticker == ticker,
                    PriceBar.trade_date >= min_date,
                    PriceBar.trade_date <= max_date,
                )
            ).all()
        }

        for d, payload in normalized_by_date.items():
            if d in existing_bars:
                bar = existing_bars[d]
                for key, value in payload.items():
                    setattr(bar, key, value)
                bar.updated_at = now
            else:
                session.add(
                    PriceBar(
                        ticker=ticker,
                        updated_at=now,
                        **payload,
                    )
                )

        existing_cov = session.scalars(
            select(FetchCoverage).where(FetchCoverage.ticker == ticker)
        ).all()
        intervals = [(c.covered_start, c.covered_end) for c in existing_cov]
        intervals.append((min(covered_start, min_date), max(covered_end, max_date)))
        merged = _merge_intervals(intervals)

        session.execute(
            delete(FetchCoverage).where(FetchCoverage.ticker == ticker)
        )
        for s, e in merged:
            session.add(
                FetchCoverage(
                    ticker=ticker,
                    covered_start=s,
                    covered_end=e,
                    fetched_at=now,
                )
            )

        session.commit()

    return len(normalized_by_date)


def seed_from_research_csvs(data_dir: Path = RESEARCH_DATA_DIR) -> int:
    """Pre-warm cache from existing valid Tiingo CSV files in research/data/."""
    if not data_dir.exists():
        return 0

    seeded_tickers = 0
    for csv_file in sorted(data_dir.glob("*.csv")):
        match = RAW_CSV_PATTERN.match(csv_file.name)
        if not match:
            continue
        ticker, start_str, end_str = match.groups()
        if is_range_covered(ticker, start_str, end_str):
            continue
        try:
            with csv_file.open("r", encoding="utf-8") as handle:
                reader = csv.DictReader(handle)
                rows = list(reader)
            if rows and "date" in rows[0] and "adjClose" in rows[0]:
                # Cap end_str at today if CSV filename used a future end date like 2025-12-31 in 2025
                last_row_date = normalize_date_str(rows[-1]["date"])
                effective_end = end_str
                today_iso = date.today().isoformat()
                if end_str > today_iso:
                    effective_end = today_iso
                # Only mark up to last_row_date + 4 days if CSV was downloaded earlier than end_str
                last_dt = date.fromisoformat(last_row_date)
                req_end_dt = date.fromisoformat(effective_end)
                if (req_end_dt - last_dt).days > 5:
                    effective_end = last_row_date
                store_price_rows(ticker, rows, start_str, effective_end)
                seeded_tickers += 1
        except Exception:
            continue

    return seeded_tickers


def get_cache_stats() -> dict:
    with SessionLocal() as session:
        total_rows = session.scalar(select(func.count()).select_from(PriceBar)) or 0
        grouped = session.execute(
            select(
                PriceBar.ticker,
                func.min(PriceBar.trade_date),
                func.max(PriceBar.trade_date),
                func.count(PriceBar.trade_date),
            )
            .group_by(PriceBar.ticker)
            .order_by(PriceBar.ticker.asc())
        ).all()

    tickers = [
        {
            "ticker": t,
            "firstDate": first_d,
            "lastDate": last_d,
            "bars": int(cnt),
        }
        for t, first_d, last_d, cnt in grouped
    ]
    return {
        "backend": CACHE_BACKEND,
        "totalBars": int(total_rows),
        "tickerCount": len(tickers),
        "tickers": tickers,
    }


def get_cached_profile(ticker: str) -> dict | None:
    clean = ticker.upper().strip()
    with SessionLocal() as session:
        prof = session.get(AssetProfile, clean)
        return prof.to_dict() if prof else None


def store_asset_profile(profile: dict) -> dict:
    clean = str(profile["ticker"]).upper().strip()
    now = datetime.now(timezone.utc)
    with _CACHE_WRITE_LOCK, SessionLocal() as session:
        existing = session.get(AssetProfile, clean)
        if existing:
            existing.name = profile.get("name") or ""
            existing.exchange_code = profile.get("exchangeCode") or "US"
            existing.start_date = (profile.get("startDate") or "")[:10]
            existing.end_date = (profile.get("endDate") or "")[:10]
            existing.description = profile.get("description") or ""
            existing.updated_at = now
        else:
            session.add(
                AssetProfile(
                    ticker=clean,
                    name=profile.get("name") or "",
                    exchange_code=profile.get("exchangeCode") or "US",
                    start_date=(profile.get("startDate") or "")[:10],
                    end_date=(profile.get("endDate") or "")[:10],
                    description=profile.get("description") or "",
                    updated_at=now,
                )
            )
        session.commit()
    return {
        "ticker": clean,
        "name": profile.get("name") or "",
        "exchangeCode": profile.get("exchangeCode") or "US",
        "startDate": (profile.get("startDate") or "")[:10],
        "endDate": (profile.get("endDate") or "")[:10],
        "description": profile.get("description") or "",
    }


def clear_cache() -> dict:
    with _CACHE_WRITE_LOCK, SessionLocal() as session:
        session.execute(delete(FetchCoverage))
        session.execute(delete(AssetProfile))
        deleted = session.execute(delete(PriceBar)).rowcount or 0
        session.commit()
    return {"clearedBars": int(deleted)}
