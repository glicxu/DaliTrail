"""Utilities for working with the GeoNames lite dataset used by the API."""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List

import sqlite3

BASE_DIR = Path(__file__).parent.resolve()

DEFAULT_DATASET_NAME = "geonames-lite-us-wa.db"
DEFAULT_DATASET_PATHS: tuple[Path, ...] = (
    BASE_DIR / "data" / DEFAULT_DATASET_NAME,
    BASE_DIR.parent / "DaliTrailData" / "data" / DEFAULT_DATASET_NAME,
)


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
