# /assets/js/main.py  (server main)
# MAIN FastAPI app with dynamic GeoNames lite builder + nearby API.

import os
import tempfile
import logging
import traceback
from pathlib import Path
from typing import Optional, List, Any

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from geodata import (
    GeoNamesDatasetNotFound,
    dataset_metadata,
    fetch_nearby_features,
    load_geonames_dataset_catalog,
    resolve_dataset_path,
    build_lite_dataset,   # must exist in geodata.py
)

# ---------- Logging ----------
LOGGER = logging.getLogger("dalitrail")
if not LOGGER.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

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


@app.get("/index.html", response_class=FileResponse)
async def read_index_html():
    return await read_index()


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


def _icon_response(filename: str) -> FileResponse:
    icon_path = BASE_DIR / "assets" / "icons" / filename
    if not icon_path.exists():
        raise HTTPException(status_code=404, detail=f"{filename} not found")
    return FileResponse(icon_path)


@app.get("/apple-touch-icon.png", response_class=FileResponse)
async def apple_touch_icon():
    return _icon_response("icon-180.png")


@app.get("/apple-touch-icon-120x120.png", response_class=FileResponse)
async def apple_touch_icon_120():
    return _icon_response("icon-192.png")


@app.get("/apple-touch-icon-120x120-precomposed.png", response_class=FileResponse)
async def apple_touch_icon_precomposed():
    return _icon_response("icon-192.png")


@app.get("/favicon.ico", response_class=FileResponse)
async def favicon():
    return _icon_response("icon-192.png")


# ---------- Models ----------
class FeatureModel(BaseModel):
    geoname_id: int
    name: str
    latitude: float
    longitude: float
    feature_class: str | None = None
    feature_code: str | None = None
    country: str | None = None
    admin1: str | None = None
    admin2: str | None = None
    population: int | None = None
    elevation: float | None = None
    timezone: str | None = None
    distance_km: float = Field(..., description="Distance from the query point in kilometers.")


class NearbyResponse(BaseModel):
    dataset: str
    metadata: dict[str, str]
    features: list[FeatureModel]


class GeoNamesDatasetModel(BaseModel):
    id: str
    label: str
    url: str
    description: str | None = None
    file_name: str | None = None
    source: str | None = None
    approx_size: str | None = None
    size_bytes: int | None = None
    available: bool | None = None
    error: str | None = None


class GeoNamesDatasetList(BaseModel):
    datasets: list[GeoNamesDatasetModel]


# ---------- Helpers ----------
def _get_dataset_path() -> Path:
    try:
        return resolve_dataset_path()
    except GeoNamesDatasetNotFound as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _split_codes(raw: Optional[str]) -> Optional[List[str]]:
    if not raw:
        return None
    codes = [c.strip() for c in raw.split(",")]
    codes = [c for c in codes if c]
    return codes or None


def _tempfile_path(suffix: str = ".db") -> Path:
    fd, name = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    return Path(name)


def _fmt_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    units = ["KB", "MB", "GB", "TB"]
    v = n / 1024.0
    i = 0
    while v >= 1024 and i < len(units) - 1:
        v /= 1024.0
        i += 1
    return f"{v:.1f} {units[i]}"


# ---- Keep old static route for compatibility ----
@app.get("/datasets/geonames-lite-us-wa.db", response_class=FileResponse)
async def download_default_dataset():
    dataset_path = _get_dataset_path()
    if not dataset_path.exists():
        raise HTTPException(status_code=404, detail="Dataset not found on disk.")
    return FileResponse(
        dataset_path,
        media_type="application/octet-stream",
        filename=dataset_path.name,
    )


# ---- New: build & stream a lite dataset for a region / feature set ----
@app.get("/api/geonames/lite", response_class=FileResponse)
async def build_geonames_lite(
    background_tasks: BackgroundTasks,
    country: str = Query(..., min_length=2, max_length=3, description="ISO country code, e.g. US"),
    admin1: str | None = Query(None, min_length=1, max_length=32, description="Admin1 code, e.g. WA"),
    admin2: str | None = Query(None, min_length=1, max_length=64, description="Admin2 name/code"),
    feature_codes: str | None = Query(
        None,
        description="Comma-separated feature codes (e.g., H.LK,T.TRL). If omitted, include all.",
    ),
    label: str | None = Query(None, max_length=120, description="Optional metadata label"),
):
    """
    Build and stream a lite GeoNames SQLite DB filtered by country/admin codes.

    Examples:
      /api/geonames/lite?country=US&admin1=WA
      /api/geonames/lite?country=US&admin1=WA&admin2=King
      /api/geonames/lite?country=US&feature_codes=H.LK,T.TRL
    """
    ctry = country.strip().upper()
    a1 = admin1.strip().upper() if admin1 else None
    a2 = admin2.strip() if admin2 else None
    codes = _split_codes(feature_codes)

    # Build a friendly filename
    parts = [ctry]
    if a1:
        parts.append(a1)
    if a2:
        parts.append(a2.replace(" ", "_"))
    region = "-".join(parts) or "custom"
    filename = f"geonames-lite-{region}.db"

    # For debug: which master DB will builder use? (geodata.py should look at DALITRAIL_GEONAMES_DB)
    env_db = os.getenv("DALITRAIL_GEONAMES_DB", "").strip()
    LOGGER.info(
        "build-lite requested: country=%s admin1=%s admin2=%s codes=%s label=%s env.DALITRAIL_GEONAMES_DB=%s",
        ctry, a1, a2, ",".join(codes or []) if codes else None, label or "", env_db or "(not set)"
    )

    tmp_path = _tempfile_path(".db")
    try:
        # Let the builder return an info dict if available; if not, accept None.
        # Suggested keys: {"rows": int, "source": Path, "elapsed_sec": float, ...}
        info: Optional[dict[str, Any]] = build_lite_dataset(
            tmp_path,
            country=ctry,
            admin1=a1,
            admin2=a2,
            feature_codes=codes,
            label=label or "",
        )

        # Log builder summary
        try:
            size = tmp_path.stat().st_size if tmp_path.exists() else 0
            rows = (info or {}).get("rows")
            LOGGER.info(
                "build-lite success -> file=%s size=%s rows=%s",
                tmp_path.name, _fmt_bytes(size), rows if rows is not None else "(n/a)"
            )
        except Exception:
            LOGGER.debug("build-lite: unable to stat temp file for logging", exc_info=True)

        # Schedule deletion after response is sent
        background_tasks.add_task(lambda p=tmp_path: p.unlink(missing_ok=True))

        return FileResponse(
            tmp_path,
            media_type="application/octet-stream",
            filename=filename,
        )

    except GeoNamesDatasetNotFound as exc:
        # Most common cause of 500s: master DB not set; surface as 503 + log detail.
        LOGGER.error("build-lite failed: master dataset not found: %s", exc)
        if not env_db:
            LOGGER.error(
                "DALITRAIL_GEONAMES_DB is not set. Set it to the FULL GeoNames DB (e.g., geonames-all_countries_latest.db)."
            )
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    except Exception as exc:
        # Log full traceback for diagnosis
        LOGGER.error("build-lite unexpected error: %s", exc)
        LOGGER.error("traceback:\n%s", traceback.format_exc())
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Lite dataset build failed: {exc}") from exc


# ---- Nearby search API (uses the active/lite DB) ----
@app.get("/api/places/nearby", response_model=NearbyResponse)
async def nearby_places(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees."),
    lng: float = Query(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees."),
    radius_km: float = Query(10.0, gt=0.0, le=100.0, description="Search radius in kilometers."),
    limit: int = Query(25, ge=1, le=100, description="Maximum number of features to return."),
    feature_codes: str | None = Query(
        None,
        description="Optional comma-separated feature codes (e.g., H.LK,T.TRL).",
    ),
):
    dataset_path = _get_dataset_path()
    codes: list[str] | None = None
    if feature_codes:
        codes = [item.strip() for item in feature_codes.split(",") if item.strip()]

    LOGGER.info(
        "nearby: lat=%.6f lng=%.6f radius_km=%.2f limit=%d codes=%s dataset=%s",
        lat, lng, radius_km, limit, ",".join(codes or []) if codes else None, dataset_path.name
    )

    features = fetch_nearby_features(
        lat,
        lng,
        radius_km=radius_km,
        limit=limit,
        feature_codes=codes,
        db_path=dataset_path,
    )

    response_features = [
        FeatureModel(
            geoname_id=feature.geoname_id,
            name=feature.name,
            latitude=feature.latitude,
            longitude=feature.longitude,
            feature_class=feature.feature_class,
            feature_code=feature.feature_code,
            country=feature.country,
            admin1=feature.admin1,
            admin2=feature.admin2,
            population=feature.population,
            elevation=feature.elevation,
            timezone=feature.timezone,
            distance_km=round(feature.distance_km, 3),
        )
        for feature in features
    ]

    metadata = dataset_metadata(dataset_path)
    return NearbyResponse(
        dataset=dataset_path.name,
        metadata=metadata,
        features=response_features,
    )


@app.get("/api/geonames/datasets", response_model=GeoNamesDatasetList)
async def geonames_datasets():
    try:
        datasets = load_geonames_dataset_catalog()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return GeoNamesDatasetList(datasets=[GeoNamesDatasetModel(**item) for item in datasets])


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="Run the DaliTrail FastAPI app.")
    parser.add_argument("--host", default=os.getenv("DALITRAIL_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("DALITRAIL_PORT", "8000")))
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

    uvicorn.run(
        "main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        **ssl_kwargs,
    )
