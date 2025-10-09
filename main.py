import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).parent.resolve()

app = FastAPI(title="DaliTrail Static Server")

app.mount(
    "/assets",
    StaticFiles(directory=BASE_DIR / "assets", html=False),
    name="assets",
)


@app.get("/", response_class=FileResponse)
async def read_index():
    index_path = BASE_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(index_path)


@app.get("/manifest.webmanifest", response_class=FileResponse)
async def read_manifest():
    manifest = BASE_DIR / "manifest.webmanifest"
    if not manifest.exists():
        raise HTTPException(status_code=404, detail="manifest not found")
    return FileResponse(manifest)


@app.get("/service-worker.js", response_class=FileResponse)
async def read_service_worker():
    sw = BASE_DIR / "service-worker.js"
    if not sw.exists():
        raise HTTPException(status_code=404, detail="service worker not found")
    return FileResponse(sw)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run the DaliTrail FastAPI app.")
    parser.add_argument("--host", default=os.getenv("DALITRAIL_HOST", "0.0.0.0"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("DALITRAIL_PORT", "8000")),
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        default=os.getenv("DALITRAIL_RELOAD", "true").lower() in {"1", "true", "yes"},
        help="Enable autoreload (default: enabled unless DALITRAIL_RELOAD=0).",
    )
    parser.add_argument(
        "--no-reload",
        dest="reload",
        action="store_false",
        help="Disable autoreload regardless of environment defaults.",
    )
    args = parser.parse_args()

    certfile = os.getenv("DALITRAIL_SSL_CERT")
    keyfile = os.getenv("DALITRAIL_SSL_KEY")

    ssl_kwargs = {}
    if certfile or keyfile:
        if not (certfile and keyfile):
            raise RuntimeError("Both DALITRAIL_SSL_CERT and DALITRAIL_SSL_KEY must be set for HTTPS.")
        ssl_kwargs = {
            "ssl_certfile": certfile,
            "ssl_keyfile": keyfile,
        }

    import uvicorn

    uvicorn.run(
        "main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        **ssl_kwargs,
    )
