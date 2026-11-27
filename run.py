#!/usr/bin/env python3
"""One-command launcher for AlphaMetric Quantitative Terminal."""
import os
import uvicorn


def main() -> None:
    default_host = "0.0.0.0" if ("RENDER" in os.environ or "PORT" in os.environ) else "127.0.0.1"
    host = os.getenv("HOST", default_host)
    port = int(os.getenv("PORT", "8000"))
    reload_flag = os.getenv("RELOAD", "0") == "1"
    print(f"\n  AlphaMetric Quantitative Terminal -> http://{host}:{port}")
    print(f"  Interactive OpenAPI Docs     -> http://{host}:{port}/docs\n")
    uvicorn.run("backend.app.main:app", host=host, port=port, reload=reload_flag)


if __name__ == "__main__":
    main()
