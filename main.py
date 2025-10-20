import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from geodata import (
    GeoNamesDatasetNotFound,
    dataset_metadata,
    fetch_nearby_features,
    load_geonames_dataset_catalog,
    resolve_dataset_path,
)

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


def _get_dataset_path() -> Path:
    try:
        return resolve_dataset_path()
    except GeoNamesDatasetNotFound as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/datasets/geonames-lite-us-wa.db", response_class=FileResponse)
async def download_dataset():
    dataset_path = _get_dataset_path()
    if not dataset_path.exists():
        raise HTTPException(status_code=404, detail="Dataset not found on disk.")
    return FileResponse(
        dataset_path,
        media_type="application/octet-stream",
        filename=dataset_path.name,
    )


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
