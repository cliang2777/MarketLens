from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.api.routes import router as api_router
from backend.app.config import STATIC_DIR
from backend.app.db import init_db
from backend.app.services.cache_store import seed_from_research_csvs


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    seed_from_research_csvs()
    yield


app = FastAPI(
    title="MarketLens Quantitative Terminal",
    version="1.0.0",
    description="Financial market analysis, portfolio optimization, and out-of-sample strategy backtesting.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
def root_health():
    return {"status": "ok"}


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/{full_path:path}", include_in_schema=False)
def serve_spa(full_path: str):
    candidate = (STATIC_DIR / full_path).resolve()
    if (
        full_path
        and candidate.is_file()
        and str(candidate).startswith(str(STATIC_DIR.resolve()))
    ):
        return FileResponse(candidate)
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "MarketLens UI assets not found."}
