from datetime import datetime, timezone
from sqlalchemy import DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PriceBar(Base):
    """Cached daily historical OHLCV + adjusted price bar from Tiingo."""

    __tablename__ = "price_bars"

    ticker: Mapped[str] = mapped_column(String(24), primary_key=True)
    trade_date: Mapped[str] = mapped_column(String(10), primary_key=True)

    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    adj_open: Mapped[float] = mapped_column(Float, nullable=False)
    adj_high: Mapped[float] = mapped_column(Float, nullable=False)
    adj_low: Mapped[float] = mapped_column(Float, nullable=False)
    adj_close: Mapped[float] = mapped_column(Float, nullable=False)
    adj_volume: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    div_cash: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    split_factor: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_price_bars_ticker_date", "ticker", "trade_date"),
    )

    def to_research_row(self) -> dict:
        return {
            "date": self.trade_date,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
            "adjOpen": self.adj_open,
            "adjHigh": self.adj_high,
            "adjLow": self.adj_low,
            "adjClose": self.adj_close,
            "adjVolume": self.adj_volume,
            "divCash": self.div_cash,
            "splitFactor": self.split_factor,
        }


class FetchCoverage(Base):
    """Tracks requested [start_date, end_date] intervals already fetched per ticker."""

    __tablename__ = "fetch_coverage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(24), index=True, nullable=False)
    covered_start: Mapped[str] = mapped_column(String(10), nullable=False)
    covered_end: Mapped[str] = mapped_column(String(10), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class AssetProfile(Base):
    """Cached US security metadata & company description from Tiingo."""

    __tablename__ = "asset_profiles"

    ticker: Mapped[str] = mapped_column(String(24), primary_key=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False, default="")
    exchange_code: Mapped[str] = mapped_column(String(32), nullable=False, default="US")
    start_date: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    end_date: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "name": self.name,
            "exchangeCode": self.exchange_code,
            "startDate": self.start_date,
            "endDate": self.end_date,
            "description": self.description,
        }
