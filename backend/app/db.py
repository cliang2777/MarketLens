import logging
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.config import BACKEND_DATA_DIR

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def _build_engine():
    explicit_sqlite = os.getenv("ALPHAMETRIC_SQLITE_PATH") or os.getenv("MARKETLENS_SQLITE_PATH")
    if explicit_sqlite:
        if explicit_sqlite == ":memory:":
            return create_engine(
                "sqlite+pysqlite:///:memory:",
                connect_args={"check_same_thread": False},
                poolclass=StaticPool,
            ), "sqlite-memory"
        return create_engine(
            f"sqlite+pysqlite:///{explicit_sqlite}",
            connect_args={"check_same_thread": False},
        ), "sqlite"

    db_url = os.getenv("DATABASE_URL", "").strip()
    if db_url.startswith("postgresql"):
        try:
            pg_engine = create_engine(
                db_url,
                pool_pre_ping=True,
                connect_args={"connect_timeout": 2},
            )
            with pg_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Connected to PostgreSQL cache backend.")
            return pg_engine, "postgresql"
        except Exception as exc:
            logger.info(
                "PostgreSQL unavailable (%s); falling back to local SQLite cache.",
                exc,
            )

    BACKEND_DATA_DIR.mkdir(parents=True, exist_ok=True)
    sqlite_path = BACKEND_DATA_DIR / "alphametric_cache.sqlite3"
    sqlite_engine = create_engine(
        f"sqlite+pysqlite:///{sqlite_path}",
        connect_args={"check_same_thread": False},
    )
    return sqlite_engine, "sqlite"


engine, CACHE_BACKEND = _build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    from backend.app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
