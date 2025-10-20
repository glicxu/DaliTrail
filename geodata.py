"""Utilities for working with the GeoNames lite dataset used by the API."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, List

import sqlite3

BASE_DIR = Path(__file__).parent.resolve()

DEFAULT_DATASET_NAME = "geonames-lite-us-wa.db"
DEFAULT_DATASET_PATHS: tuple[Path, ...] = (
    BASE_DIR / "data" / DEFAULT_DATASET_NAME,
    BASE_DIR / "assets" / "data" / DEFAULT_DATASET_NAME,
    BASE_DIR.parent / "DaliTrailData" / "data" / DEFAULT_DATASET_NAME,
)
DATASET_CATALOG_PATH = BASE_DIR / "configs" / "geonames-datasets.json"


class GeoNamesDatasetNotFound(RuntimeError):
    """Raised when the configured GeoNames dataset cannot be located on disk."""


def resolve_dataset_path() -> Path:
    """Return the path to the GeoNames lite dataset.

    The lookup order is:
    1. `DALITRAIL_GEONAMES_DB` environment variable (highest priority).
    2. Common relative paths (inside this repo or the sibling DaliTrailData repo).

    Raises:
        GeoNamesDatasetNotFound: if no candidate path exists.
    """

    env_value = os.getenv("DALITRAIL_GEONAMES_DB")
    if env_value:
        candidate = Path(env_value).expanduser().resolve()
        if candidate.exists():
            return candidate
        raise GeoNamesDatasetNotFound(
            f"Dataset specified by DALITRAIL_GEONAMES_DB not found: {candidate}"
        )

    for candidate in DEFAULT_DATASET_PATHS:
        if candidate.exists():
            return candidate

    raise GeoNamesDatasetNotFound(
        f"Unable to locate {DEFAULT_DATASET_NAME}. "
        "Set DALITRAIL_GEONAMES_DB to the absolute dataset path."
    )


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


@dataclass
class NearbyFeature:
    geoname_id: int
    name: str
    latitude: float
    longitude: float
    feature_class: str | None
    feature_code: str | None
    country: str | None
    admin1: str | None
    admin2: str | None
    population: int | None
    elevation: float | None
    timezone: str | None
    distance_km: float


def _bounding_box(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    lat_radius_deg = radius_km / 111.0
    # Clamp cosine to avoid division by zero near the poles.
    cos_lat = max(math.cos(math.radians(lat)), 1e-6)
    lng_radius_deg = radius_km / (111.0 * cos_lat)
    return (
        lat - lat_radius_deg,
        lat + lat_radius_deg,
        lng - lng_radius_deg,
        lng + lng_radius_deg,
    )


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_earth_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_earth_km * c


def fetch_nearby_features(
    lat: float,
    lng: float,
    *,
    radius_km: float,
    limit: int,
    feature_codes: Iterable[str] | None = None,
    db_path: Path | None = None,
) -> List[NearbyFeature]:
    """Return the closest features within the requested radius."""

    if radius_km <= 0:
        raise ValueError("radius_km must be positive")
    if not (1 <= limit <= 200):
        raise ValueError("limit must be within [1, 200]")

    dataset_path = db_path or resolve_dataset_path()
    lat_min, lat_max, lng_min, lng_max = _bounding_box(lat, lng, radius_km)

    filters = ["latitude BETWEEN ? AND ?", "longitude BETWEEN ? AND ?"]
    params: list[object] = [lat_min, lat_max, lng_min, lng_max]
    if feature_codes:
        codes = list(feature_codes)
        if codes:
            placeholders = ",".join("?" for _ in codes)
            filters.append("(feature_class || '.' || feature_code) IN (" + placeholders + ")")
            params.extend(codes)

    query = (
        "SELECT geoname_id, name, latitude, longitude, feature_class, feature_code, "
        "country, admin1, admin2, population, elevation, timezone "
        "FROM features WHERE "
        + " AND ".join(filters)
    )

    with _connect(dataset_path) as conn:
        rows = conn.execute(query, params).fetchall()

    features: list[NearbyFeature] = []
    for row in rows:
        distance = _haversine_km(lat, lng, row["latitude"], row["longitude"])
        if distance <= radius_km:
            features.append(
                NearbyFeature(
                    geoname_id=row["geoname_id"],
                    name=row["name"],
                    latitude=row["latitude"],
                    longitude=row["longitude"],
                    feature_class=row["feature_class"],
                    feature_code=row["feature_code"],
                    country=row["country"],
                    admin1=row["admin1"],
                    admin2=row["admin2"],
                    population=row["population"],
                    elevation=row["elevation"],
                    timezone=row["timezone"],
                    distance_km=distance,
                )
            )

    features.sort(key=lambda feature: feature.distance_km)
    return features[:limit]


def dataset_metadata(db_path: Path | None = None) -> dict[str, str]:
    """Return metadata key/value pairs stored in the dataset."""
    dataset_path = db_path or resolve_dataset_path()
    with _connect(dataset_path) as conn:
        try:
            rows = conn.execute("SELECT key, value FROM metadata").fetchall()
        except sqlite3.OperationalError:
            return {}
    return {row["key"]: row["value"] for row in rows}


def _default_dataset_catalog() -> list[dict[str, Any]]:
    return [
        {
            "id": "us-wa",
            "label": "United States - Washington State",
            "description": "Cities, trails, and outdoor features for Washington.",
            "source": "active",
            "url": "/datasets/geonames-lite-us-wa.db",
        },
        {
            "id": "sample",
            "label": "Sample Dataset (Tiny)",
            "description": "Mini dataset for testing search locally.",
            "source": "static",
            "path": "assets/data/geonames-sample.db",
            "file_name": "geonames-sample.db",
            "url": "/assets/data/geonames-sample.db",
        },
    ]


def _format_size_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    units = ["KB", "MB", "GB", "TB"]
    value = size / 1024.0
    index = 0
    while value >= 1024 and index < len(units) - 1:
        value /= 1024.0
        index += 1
    precision = 1 if value < 10 else 0
    return f"{value:.{precision}f} {units[index]}"


def _load_dataset_config() -> list[dict[str, Any]]:
    if not DATASET_CATALOG_PATH.exists():
        return _default_dataset_catalog()
    try:
        raw = json.loads(DATASET_CATALOG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid GeoNames dataset catalog JSON: {exc}") from exc

    if isinstance(raw, dict):
        entries = raw.get("datasets", [])
    else:
        entries = raw

    if not isinstance(entries, list):
        raise RuntimeError("GeoNames dataset catalog must be a list or contain a 'datasets' list.")

    datasets: list[dict[str, Any]] = []
    for entry in entries:
        if isinstance(entry, dict):
            datasets.append(entry)
    if not datasets:
        return _default_dataset_catalog()
    return datasets


def _resolve_catalog_entry(entry: dict[str, Any]) -> dict[str, Any]:
    dataset = dict(entry)
    dataset_id = dataset.get("id")
    if not dataset_id:
        raise ValueError("GeoNames dataset entry is missing required 'id'.")

    source = dataset.get("source", "static")
    file_path: Path | None = None
    available = True
    size_bytes: int | None = None
    error_message: str | None = None

    if source == "active":
        try:
            file_path = resolve_dataset_path()
        except GeoNamesDatasetNotFound as exc:
            available = False
            error_message = str(exc)
        else:
            if not dataset.get("file_name"):
                dataset["file_name"] = file_path.name
    else:
        raw_path = dataset.get("path")
        if raw_path:
            candidate = Path(raw_path)
            if not candidate.is_absolute():
                candidate = BASE_DIR / candidate
            if candidate.exists():
                file_path = candidate
                if not dataset.get("file_name"):
                    dataset["file_name"] = candidate.name
            else:
                available = False
                error_message = f"Dataset file not found: {candidate}"

    if file_path and file_path.exists():
        try:
            size_bytes = file_path.stat().st_size
        except OSError as exc:
            error_message = str(exc)
            available = False

    if size_bytes is not None:
        dataset["size_bytes"] = size_bytes
        dataset.setdefault("approx_size", _format_size_bytes(size_bytes))

    if "url" not in dataset and dataset.get("file_name"):
        dataset["url"] = f"/datasets/{dataset['file_name']}"

    dataset["available"] = available
    if error_message:
        dataset["error"] = error_message

    return dataset


def load_geonames_dataset_catalog() -> list[dict[str, Any]]:
    """Return the list of GeoNames datasets available for download."""
    resolved: list[dict[str, Any]] = []
    for entry in _load_dataset_config():
        try:
            resolved.append(_resolve_catalog_entry(entry))
        except Exception as exc:
            resolved.append(
                {
                    "id": entry.get("id", "unknown"),
                    "label": entry.get("label", "GeoNames Dataset"),
                    "description": entry.get("description", ""),
                    "source": entry.get("source", "static"),
                    "available": False,
                    "error": str(exc),
                }
            )
    return resolved
