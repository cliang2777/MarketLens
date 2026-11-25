#!/usr/bin/env python3
"""One-command launcher for MarketLens Quantitative Terminal."""
import os
import uvicorn


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload_flag = os.getenv("RELOAD", "0") == "1"
    print(f"\n  MarketLens Metallic Terminal -> http://{host}:{port}")
    print(f"  Interactive OpenAPI Docs     -> http://{host}:{port}/docs\n")
    uvicorn.run("backend.app.main:app", host=host, port=port, reload=reload_flag)


if __name__ == "__main__":
    main()
