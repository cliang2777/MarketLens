import os
import sys
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RESEARCH_DIR = PROJECT_ROOT / "research"
RESEARCH_DATA_DIR = RESEARCH_DIR / "data"
BACKEND_DATA_DIR = PROJECT_ROOT / "backend" / "data"
STATIC_DIR = Path(__file__).resolve().parent / "static"
ENV_FILE = PROJECT_ROOT / ".env"

if str(RESEARCH_DIR) not in sys.path:
    sys.path.insert(0, str(RESEARCH_DIR))

if ENV_FILE.exists():
    load_dotenv(ENV_FILE, override=False)


def get_tiingo_token() -> str | None:
    token = os.getenv("TIINGO_API_TOKEN", "").strip().strip('"').strip("'")
    if not token or token == "change_me":
        return None
    return token
