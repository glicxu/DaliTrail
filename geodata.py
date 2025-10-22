"""Utilities for working with the GeoNames lite dataset used by the API."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, List, Optional

import sqlite3
from datetime import datetime, timezone

BASE_DIR = Path(__file__).parent.resolve()

# --- Existing lite dataset (kept for compatibility) --------------------------
DEFAULT_DATASET_NAME = "geonames-lite-us-wa.db"
DEFAULT_DATASET_PATHS: tuple[Path, ...] = (
    BASE_DIR / "data" / DEFAULT_DATASET_NAME,
    BASE_DIR / "assets" / "data" / DEFAULT_DATASET_NAME,
    BASE_DIR.parent / "DaliTrailData" / "data" / DEFAULT_DATASET_NAME,
)

# NEW: default master (all-countries) dataset candidates
DEFAULT_MASTER_CANDIDATES: tuple[Path, ...] = (
    BASE_DIR / "data" / "geonames-all_countries_latest.db",
    BASE_DIR.parent / "DaliTrailData" / "data" / "geonames-all_countries_latest.db",
)

DATASET_CATALOG_PATH = BASE_DIR / "configs" / "geonames-datasets.json"

# Directory to write generated lite DBs, if you ever want to persist them
GENERATED_DIR = BASE_DIR / "assets" / "data" / "generated"


class GeoNamesDatasetNotFound(RuntimeError):
    """Raised when the configured GeoNames dataset cannot be located on disk."""


# ---------------------------------------------------------------------------
# Existing lite dataset resolver (used by /datasets/geonames-lite-us-wa.db etc)
# ---------------------------------------------------------------------------
def resolve_dataset_path() -> Path:
    """Return the path to the GeoNames *lite* dataset."""
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


# ---------------------------------------------------------------------------
# NEW: master (all-countries) dataset resolver (for scanning / building)
# ---------------------------------------------------------------------------
def resolve_master_dataset_path() -> Path:
    """Resolve the *master* GeoNames database (all countries)."""
    env_value = os.getenv("DALITRAIL_GEONAMES_MASTER_DB")
    if env_value:
        candidate = Path(env_value).expanduser().resolve()
        if candidate.exists():
            return candidate
        raise GeoNamesDatasetNotFound(
            f"Master dataset specified by DALITRAIL_GEONAMES_MASTER_DB not found: {candidate}"
        )

    for candidate in DEFAULT_MASTER_CANDIDATES:
        if candidate.exists():
            return candidate

    raise GeoNamesDatasetNotFound(
        "Unable to locate geonames-all_countries_latest.db. "
        "Set DALITRAIL_GEONAMES_MASTER_DB to the absolute path."
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
    """Return the closest features within the requested radius (from a lite DB)."""

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


# ----------------------- Catalog (existing) -----------------------------------
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


# ---------------------------------------------------------------------------
# NEW: dynamic scanning + lite dataset building
# ---------------------------------------------------------------------------
def scan_regions(
    *,
    level: str = "admin1",        # "admin1" | "admin2"
    country: Optional[str] = None,
    min_count: int = 200,
    limit: int = 500,
    master_db: Optional[Path] = None,
) -> list[dict]:
    """
    Scan the master GeoNames DB for regions and return entries with counts and bboxes.
    """
    if level not in {"admin1", "admin2"}:
        raise ValueError("level must be 'admin1' or 'admin2'")

    db_path = master_db or resolve_master_dataset_path()

    group_cols = ["country", "admin1"]
    if level == "admin2":
        group_cols.append("admin2")

    where = []
    params: list[Any] = []
    if country:
        where.append("country = ?")
        params.append(country)

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    group_sql = ", ".join(group_cols)

    sql = f"""
      SELECT
        country,
        admin1,
        { 'admin2,' if level=='admin2' else '' }
        COUNT(*) AS n,
        MIN(latitude) AS min_lat, MAX(latitude) AS max_lat,
        MIN(longitude) AS min_lng, MAX(longitude) AS max_lng
      FROM features
      {where_sql}
      GROUP BY {group_sql}
      HAVING n >= ?
      ORDER BY n DESC
      LIMIT ?
    """
    params.extend([min_count, limit])

    out: list[dict] = []
    with _connect(db_path) as con:
        for row in con.execute(sql, params):
            item = dict(row)
            item["level"] = level
            # Nice label for UI/catalog
            parts = [p for p in [item.get("country"), item.get("admin1"), item.get("admin2")] if p]
            item["label"] = " • ".join(parts) + f" ({item['n']})"
            out.append(item)
    return out


# --- NOTE ---
# The following functions (_connect, resolve_master_dataset_path, build_filter_label)
# are assumed to be defined elsewhere in your module.
# You will need to ensure they are available when running the code.
# For simplicity, they are not redefined here.
# --------------------------------------------------------------------------
# def _connect(path: Path) -> sqlite3.Connection: ...
# def resolve_master_dataset_path() -> Path: ...
# def build_filter_label(...) -> str: ...
# --------------------------------------------------------------------------

def build_lite_dataset(
    out_path: Path,
    *,
    country: Optional[str] = None,
    admin1: Optional[str] = None,
    admin2: Optional[str] = None,
    feature_codes: Optional[Iterable[str]] = None,
    label: str = "",
    master_db: Optional[Path] = None,
) -> int:
    """
    Create a subset (lite) SQLite db with the schema expected by the client:
      - features (columns used by /assets/js/search.js)
      - metadata (lite_filter, lite_generated_at)
      
    FIXED: Resolves 'cannot VACUUM from within a transaction' error by using 
           isolation_level=None (autocommit mode) for the 'lite' connection.
           
    Returns the file size in bytes.
    """
    src_path = master_db or resolve_master_dataset_path()
    print(f"Master DB Path (src_path): {src_path}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()

    # --- 1. Build WHERE clause filters ---
    filters = []
    params: list[Any] = []
    
    if country:
        filters.append("country = ?")
        params.append(country)
    if admin1:
        filters.append("admin1 = ?")
        params.append(admin1)
    if admin2:
        filters.append("admin2 = ?")
        params.append(admin2)
        
    if feature_codes:
        codes = list(feature_codes)
        if codes:
            # Safely create a list of placeholders (?, ?, ?)
            placeholders = ",".join("?" for _ in codes)
            filters.append(f"(feature_class || '.' || feature_code) IN ({placeholders})")
            params.extend(codes)

    where_sql = " WHERE " + " AND ".join(filters) if filters else ""

    # --- 2. Create and populate the 'lite' database (using autocommit for VACUUM) ---
    # Setting isolation_level=None enables autocommit mode, which is required for VACUUM.
    with sqlite3.connect(str(out_path), isolation_level=None) as lite, _connect(src_path) as src:
        
        # Performance PRAGMAs (already in autocommit, so these are executed immediately)
        lite.execute("PRAGMA journal_mode=OFF;")
        lite.execute("PRAGMA synchronous=OFF;")
        lite.execute("PRAGMA temp_store=MEMORY;")

        # Create tables
        lite.executescript("""
            CREATE TABLE features (
              geoname_id INTEGER PRIMARY KEY,
              name TEXT,
              latitude REAL,
              longitude REAL,
              feature_class TEXT,
              feature_code TEXT,
              country TEXT,
              admin1 TEXT,
              admin2 TEXT,
              population INTEGER,
              elevation REAL,
              timezone TEXT
            );
            CREATE TABLE metadata (
              key TEXT PRIMARY KEY,
              value TEXT
            );
        """)

        # Stream rows from master DB into the lite DB
        src.row_factory = sqlite3.Row
        cur = src.execute(f"""
             SELECT geoname_id, name, latitude, longitude, feature_class, feature_code,
                    country, admin1, admin2, population, elevation, timezone
             FROM features
             {where_sql}
        """, params)

        lite.executemany("""
            INSERT INTO features
              (geoname_id, name, latitude, longitude, feature_class, feature_code,
               country, admin1, admin2, population, elevation, timezone)
            VALUES
              (:geoname_id, :name, :latitude, :longitude, :feature_class, :feature_code,
               :country, :admin1, :admin2, :population, :elevation, :timezone)
        """, cur)

        # Helpful indexes for local sql.js queries
        lite.executescript("""
            CREATE INDEX IF NOT EXISTS idx_features_lat_lng ON features(latitude, longitude);
            CREATE INDEX IF NOT EXISTS idx_features_class_code ON features(feature_class, feature_code);
        """)

        # Insert metadata
        meta = {
            "lite_filter": label or build_filter_label(country, admin1, admin2, feature_codes),
            "lite_generated_at": datetime.now(timezone.utc).isoformat(),
        }
        lite.executemany("INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)", meta.items())
        
        # This will now succeed because isolation_level=None (autocommit) is set.
        lite.execute("VACUUM;") 

    # --- 3. Return size ---
    return out_path.stat().st_size

# def build_lite_dataset(
#     out_path: Path,
#     *,
#     country: Optional[str] = None,
#     admin1: Optional[str] = None,
#     admin2: Optional[str] = None,
#     feature_codes: Optional[Iterable[str]] = None,
#     label: str = "",
#     master_db: Optional[Path] = None,
# ) -> int:
#     """
#     Create a subset (lite) SQLite db with the schema expected by the client:
#       - features (columns used by /assets/js/search.js)
#       - metadata (lite_filter, lite_generated_at)
#     Returns the file size in bytes.
#     """
#     src_path = master_db or resolve_master_dataset_path()
#     out_path.parent.mkdir(parents=True, exist_ok=True)
#     if out_path.exists():
#         out_path.unlink()

#     filters = []
#     params: list[Any] = []
#     if country:
#         filters.append("country = ?")
#         params.append(country)
#     if admin1:
#         filters.append("admin1 = ?")
#         params.append(admin1)
#     if admin2:
#         filters.append("admin2 = ?")
#         params.append(admin2)
#     if feature_codes:
#         codes = list(feature_codes)
#         if codes:
#             placeholders = ",".join("?" for _ in codes)
#             filters.append("(feature_class || '.' || feature_code) IN (" + placeholders + ")")
#             params.extend(codes)

#     where_sql = " WHERE " + " AND ".join(filters) if filters else ""

#     with sqlite3.connect(str(out_path)) as lite, _connect(src_path) as src:
#         lite.execute("PRAGMA journal_mode=OFF;")
#         lite.execute("PRAGMA synchronous=OFF;")
#         lite.execute("PRAGMA temp_store=MEMORY;")

#         lite.executescript("""
#           CREATE TABLE features (
#             geoname_id INTEGER PRIMARY KEY,
#             name TEXT,
#             latitude REAL,
#             longitude REAL,
#             feature_class TEXT,
#             feature_code TEXT,
#             country TEXT,
#             admin1 TEXT,
#             admin2 TEXT,
#             population INTEGER,
#             elevation REAL,
#             timezone TEXT
#           );
#           CREATE TABLE metadata (
#             key TEXT PRIMARY KEY,
#             value TEXT
#           );
#         """)

#         # Stream rows into the lite DB
#         src.row_factory = sqlite3.Row
#         cur = src.execute(f"""
#           SELECT geoname_id, name, latitude, longitude, feature_class, feature_code,
#                  country, admin1, admin2, population, elevation, timezone
#           FROM features
#           {where_sql}
#         """, params)

#         lite.executemany("""
#           INSERT INTO features
#             (geoname_id, name, latitude, longitude, feature_class, feature_code,
#              country, admin1, admin2, population, elevation, timezone)
#           VALUES
#             (:geoname_id, :name, :latitude, :longitude, :feature_class, :feature_code,
#              :country, :admin1, :admin2, :population, :elevation, :timezone)
#         """, cur)

#         # Helpful indexes for local sql.js queries
#         lite.executescript("""
#           CREATE INDEX IF NOT EXISTS idx_features_lat_lng ON features(latitude, longitude);
#           CREATE INDEX IF NOT EXISTS idx_features_class_code ON features(feature_class, feature_code);
#         """)

#         meta = {
#             "lite_filter": label or build_filter_label(country, admin1, admin2, feature_codes),
#             "lite_generated_at": datetime.now(timezone.utc).isoformat(),
#         }
#         lite.executemany("INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)", meta.items())
#         lite.execute("VACUUM;")

#     return out_path.stat().st_size


def build_filter_label(
    country: Optional[str],
    admin1: Optional[str],
    admin2: Optional[str],
    feature_codes: Optional[Iterable[str]],
) -> str:
    bits = []
    if country: bits.append(f"country={country}")
    if admin1:  bits.append(f"admin1={admin1}")
    if admin2:  bits.append(f"admin2={admin2}")
    if feature_codes:
        codes = ",".join(feature_codes)
        bits.append(f"codes={codes}")
    return ";".join(bits) or "all"


# ---------------------------------------------------------------------------
# NEW: one-shot catalog generator (scan & write geonames-datasets.json)
# ---------------------------------------------------------------------------
from typing import Any, Optional
from pathlib import Path

def generate_dynamic_catalog(
    *,
    level: str = "admin1",
    country: Optional[str] = None,
    min_count: int = 200,
    limit: int = 500,
    master_db: Optional[Path] = None,
    include_sample: bool = True,
) -> list[dict[str, Any]]:
    """
    Scan regions and emit a static dataset catalog JSON that the client already reads.
    Each entry points at the dynamic build endpoint, so downloading triggers a fresh build.
    The generated (admin-level) entries are sorted by country, then admin1, then admin2, then label.
    """
    regions = scan_regions(
        level=level,
        country=country,
        min_count=min_count,
        limit=limit,
        master_db=master_db,
    )

    # ---- sort by country/admin1/admin2/label (case-insensitive) ----
    def _norm(v: Any) -> str:
        return str(v or "").casefold()

    regions_sorted = sorted(
        regions,
        key=lambda r: (_norm(r.get("country")),
                       _norm(r.get("admin1")),
                       _norm(r.get("admin2")),
                       _norm(r.get("label")))
    )

    datasets: list[dict[str, Any]] = []

    # Pinned entries first
    datasets.append({
        "id": "active-lite",
        "label": "Current Lite Dataset",
        "description": "The server’s active lite DB (for compatibility).",
        "source": "active",
        "url": "/datasets/geonames-lite-us-wa.db",
    })
    if include_sample:
        datasets.append({
            "id": "sample",
            "label": "Sample Dataset (Tiny)",
            "description": "Mini dataset for testing search locally.",
            "source": "static",
            "path": "assets/data/geonames-sample.db",
            "file_name": "geonames-sample.db",
            "url": "/assets/data/geonames-sample.db",
        })

    # Generated region entries (admin1/admin2), sorted by country
    for r in regions_sorted:
        # id like: US-WA or US-WA-King (lowercased for stability in URLs/ids)
        id_parts = [r.get("country"), r.get("admin1"), r.get("admin2")]
        id_str_raw = "-".join([p for p in id_parts if p])
        id_str = id_str_raw.lower()

        # Build query string for dynamic endpoint
        qs = []
        if r.get("country"): qs.append(f"country={r['country']}")
        if r.get("admin1"):  qs.append(f"admin1={r['admin1']}")
        if r.get("admin2"):  qs.append(f"admin2={r['admin2']}")
        query = "&".join(qs)

        datasets.append({
            "id": id_str,
            "label": r.get("label") or id_str_raw,
            "description": f"~{r.get('n', 0)} features",
            "source": "generated",
            # Use the clean builder endpoint you added in FastAPI:
            "url": f"/api/geonames/lite?{query}",
            "file_name": f"geonames-lite-{id_str_raw}.db",
        })

    # Persist to configs/geonames-datasets.json
    DATASET_CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATASET_CATALOG_PATH.write_text(json.dumps({"datasets": datasets}, indent=2), encoding="utf-8")

    return datasets
