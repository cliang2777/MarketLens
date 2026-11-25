from datetime import date
from pydantic import BaseModel, Field, field_validator, model_validator


def _clean_ticker(val: str) -> str:
    cleaned = val.strip().upper()
    if not cleaned:
        raise ValueError("Ticker symbol cannot be empty.")
    return cleaned


class SingleAssetRequest(BaseModel):
    ticker: str = Field(..., examples=["AAPL"])
    benchmark: str | None = Field(default="SPY", examples=["SPY"])
    startDate: date = Field(default=date(2021, 1, 1))
    endDate: date = Field(default=date(2025, 12, 31))
    forceRefresh: bool = False

    @field_validator("ticker")
    @classmethod
    def validate_ticker(cls, v: str) -> str:
        return _clean_ticker(v)

    @field_validator("benchmark")
    @classmethod
    def validate_benchmark(cls, v: str | None) -> str | None:
        if v is None or not v.strip() or v.strip().upper() == "NONE":
            return None
        return _clean_ticker(v)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.startDate >= self.endDate:
            raise ValueError("Start date must be before end date.")
        return self


class MultiAssetCompareRequest(BaseModel):
    tickers: list[str] = Field(..., min_length=1, max_length=6)
    benchmark: str = Field(default="SPY")
    startDate: date = Field(default=date(2021, 1, 1))
    endDate: date = Field(default=date(2025, 12, 31))
    forceRefresh: bool = False

    @field_validator("tickers")
    @classmethod
    def validate_tickers(cls, tickers: list[str]) -> list[str]:
        cleaned = [_clean_ticker(t) for t in tickers]
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("Duplicate ticker symbols are not allowed.")
        return cleaned

    @field_validator("benchmark")
    @classmethod
    def validate_benchmark(cls, v: str) -> str:
        return _clean_ticker(v)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.startDate >= self.endDate:
            raise ValueError("Start date must be before end date.")
        return self


class AllocationItem(BaseModel):
    ticker: str
    weight: float = Field(..., gt=0, le=100)

    @field_validator("ticker")
    @classmethod
    def validate_ticker(cls, v: str) -> str:
        return _clean_ticker(v)


class PortfolioAnalyzeRequest(BaseModel):
    allocations: list[AllocationItem] = Field(..., min_length=2, max_length=5)
    benchmark: str | None = Field(default="SPY")
    startDate: date = Field(default=date(2021, 1, 1))
    endDate: date = Field(default=date(2025, 12, 31))
    frontierStep: int = Field(default=5, ge=1, le=50)
    forceRefresh: bool = False

    @field_validator("benchmark")
    @classmethod
    def validate_benchmark(cls, v: str | None) -> str | None:
        if v is None or not v.strip() or v.strip().upper() == "NONE":
            return None
        return _clean_ticker(v)

    @model_validator(mode="after")
    def validate_portfolio(self):
        if self.startDate >= self.endDate:
            raise ValueError("Start date must be before end date.")
        tickers = [item.ticker for item in self.allocations]
        if len(set(tickers)) != len(tickers):
            raise ValueError("Duplicate ticker symbols in portfolio allocations.")
        total = sum(item.weight for item in self.allocations)
        if abs(total - 100.0) > 0.05:
            raise ValueError(
                f"Portfolio weights must sum to 100% (currently {total:.2f}%)."
            )
        if 100 % self.frontierStep != 0:
            raise ValueError("Frontier step must be a positive divisor of 100 (e.g. 2, 5, 10).")
        return self


class StrategyBacktestRequest(BaseModel):
    ticker: str = Field(default="AAPL")
    startDate: date = Field(default=date(2021, 1, 1))
    endDate: date = Field(default=date(2025, 12, 31))
    shortWindow: int = Field(default=20, ge=2, le=250)
    longWindow: int = Field(default=50, ge=5, le=400)
    costBps: float = Field(default=10.0, ge=0.0, lt=1000.0)
    forceRefresh: bool = False

    @field_validator("ticker")
    @classmethod
    def validate_ticker(cls, v: str) -> str:
        return _clean_ticker(v)

    @model_validator(mode="after")
    def validate_params(self):
        if self.startDate >= self.endDate:
            raise ValueError("Start date must be before end date.")
        if self.shortWindow >= self.longWindow:
            raise ValueError("Short window must be smaller than long window.")
        return self


class StrategyOptimizeRequest(BaseModel):
    ticker: str = Field(default="AAPL")
    startDate: date = Field(default=date(2021, 1, 1))
    endDate: date = Field(default=date(2025, 12, 31))
    shortWindows: list[int] = Field(default=[10, 20, 50], min_length=1, max_length=8)
    longWindows: list[int] = Field(default=[50, 100, 200], min_length=1, max_length=8)
    costBps: float = Field(default=10.0, ge=0.0, lt=1000.0)
    trainRatio: float = Field(default=0.7, gt=0.2, lt=0.9)
    forceRefresh: bool = False

    @field_validator("ticker")
    @classmethod
    def validate_ticker(cls, v: str) -> str:
        return _clean_ticker(v)

    @model_validator(mode="after")
    def validate_params(self):
        if self.startDate >= self.endDate:
            raise ValueError("Start date must be before end date.")
        if any(w < 2 or w > 400 for w in self.shortWindows + self.longWindows):
            raise ValueError("Moving-average windows must be between 2 and 400 days.")
        if not any(sw < lw for sw in self.shortWindows for lw in self.longWindows):
            raise ValueError("At least one short window must be smaller than a long window.")
        return self
