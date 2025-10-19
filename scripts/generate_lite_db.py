"""Generate filtered GeoNames lite databases from the global bundle."""

from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import sqlite3
from typing import Iterable, List, Sequence, Tuple

FEATURE_COLUMNS: Sequence[str] = (
    "geoname_id",
    "name",
    "name_ascii",
    "feature_class",
    "feature_code",
    "latitude",
    "longitude",
    "country",
    "admin1",
    "admin2",
    "population",
    "elevation",
    "timezone",
    "modification_date",
    "search_tokens",
    "grid_lat",
    "grid_lng",
)

ALT_COLUMNS: Sequence[str] = (
    "geoname_id",
    "name",
    "name_ascii",
    "is_preferred",
)


def parse_args(argv: List[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a filtered GeoNames lite SQLite database from the master dataset.",
    )
    parser.add_argument("--source", required=True, type=pathlib.Path, help="Path to geonames_all_countries_latest.db")
    parser.add_argument("--output", required=True, type=pathlib.Path, help="Path for the filtered output DB")
    parser.add_argument("--overwrite", action="store_true", help="Allow replacing the output if it exists")

    parser.add_argument("--countries", help="Comma-separated ISO country codes to include")
    parser.add_argument("--feature-codes", help="Comma-separated feature codes (e.g., H.LK,T.TRL)")
    parser.add_argument("--feature-classes", help="Comma-separated feature classes (e.g., H,T,P)")
    parser.add_argument("--grid-lat-min", type=int, help="Minimum integer grid latitude (floor(latitude))")
    parser.add_argument("--grid-lat-max", type=int, help="Maximum integer grid latitude")
    parser.add_argument("--grid-lng-min", type=int, help="Minimum integer grid longitude (floor(longitude))")
    parser.add_argument("--grid-lng-max", type=int, help="Maximum integer grid longitude")
    parser.add_argument("--where", help="Additional SQL WHERE clause applied to the features table")
    parser.add_argument("--limit", type=int, help="Optional row limit (sampling)")
    return parser.parse_args(argv)


def split_csv(value: str | None) -> List[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def build_filters(args: argparse.Namespace) -> Tuple[str, List[object], str]:
    clauses: List[str] = []
    params: List[object] = []
    descriptors: List[str] = []

    countries = split_csv(args.countries)
    if countries:
        placeholders = ",".join("?" for _ in countries)
        clauses.append(f"country IN ({placeholders})")
        params.extend(countries)
        descriptors.append(f"countries={','.join(countries)}")

    feature_codes = split_csv(args.feature_codes)
    if feature_codes:
        placeholders = ",".join("?" for _ in feature_codes)
        clauses.append(f"(feature_class || '.' || feature_code) IN ({placeholders})")
        params.extend(feature_codes)
        descriptors.append(f"feature_codes={','.join(feature_codes)}")

    feature_classes = split_csv(args.feature_classes)
    if feature_classes:
        placeholders = ",".join("?" for _ in feature_classes)
        clauses.append(f"feature_class IN ({placeholders})")
        params.extend(feature_classes)
        descriptors.append(f"feature_classes={','.join(feature_classes)}")

    if args.grid_lat_min is not None:
        clauses.append("grid_lat >= ?")
        params.append(args.grid_lat_min)
        descriptors.append(f"grid_lat_min={args.grid_lat_min}")
    if args.grid_lat_max is not None:
        clauses.append("grid_lat <= ?")
        params.append(args.grid_lat_max)
        descriptors.append(f"grid_lat_max={args.grid_lat_max}")

    if args.grid_lng_min is not None:
        clauses.append("grid_lng >= ?")
        params.append(args.grid_lng_min)
        descriptors.append(f"grid_lng_min={args.grid_lng_min}")
    if args.grid_lng_max is not None:
        clauses.append("grid_lng <= ?")
        params.append(args.grid_lng_max)
        descriptors.append(f"grid_lng_max={args.grid_lng_max}")

    if args.where:
        clauses.append(f"({args.where})")
        descriptors.append(f"where={args.where}")

    filter_sql = " AND ".join(clauses) if clauses else "1=1"
    description = "; ".join(descriptors) if descriptors else "all"
    return filter_sql, params, description


def ensure_output(path: pathlib.Path, overwrite: bool) -> None:
    if path.exists():
        if not overwrite:
            raise FileExistsError(f"Output already exists: {path}")
        path.unlink()
    path.parent.mkdir(parents=True, exist_ok=True)


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS features (
            geoname_id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            name_ascii TEXT,
            feature_class TEXT,
            feature_code TEXT,
            latitude REAL,
            longitude REAL,
            country TEXT,
            admin1 TEXT,
            admin2 TEXT,
            population INTEGER,
            elevation REAL,
            timezone TEXT,
            modification_date TEXT,
            search_tokens TEXT,
            grid_lat INTEGER,
            grid_lng INTEGER
        );

        CREATE TABLE IF NOT EXISTS alternate_names (
            geoname_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            name_ascii TEXT,
            is_preferred INTEGER DEFAULT 0,
            FOREIGN KEY(geoname_id) REFERENCES features(geoname_id)
        );

        CREATE INDEX IF NOT EXISTS idx_features_grid ON features(grid_lat, grid_lng);
        CREATE INDEX IF NOT EXISTS idx_features_feature ON features(feature_code);
        CREATE INDEX IF NOT EXISTS idx_features_country ON features(country);
        CREATE INDEX IF NOT EXISTS idx_alt_names_geoname ON alternate_names(geoname_id);
        """
    )


def copy_features(
    src: sqlite3.Connection,
    dest: sqlite3.Connection,
    filter_sql: str,
    params: Sequence[object],
    limit: int | None,
) -> list[int]:
    placeholders = ", ".join(FEATURE_COLUMNS)
    query = f"SELECT {placeholders} FROM features WHERE {filter_sql}"
    bind_params: list[object] = list(params)
    if limit is not None and limit > 0:
        query += " LIMIT ?"
        bind_params.append(limit)

    insert_sql = (
        "INSERT INTO features ("
        + ", ".join(FEATURE_COLUMNS)
        + ") VALUES ("
        + ", ".join("?" for _ in FEATURE_COLUMNS)
        + ")"
    )

    selected_ids: list[int] = []
    cur_src = src.cursor()
    cur_dest = dest.cursor()
    for row in cur_src.execute(query, bind_params):
        cur_dest.execute(insert_sql, row)
        selected_ids.append(row[0])
    dest.commit()
    cur_src.close()
    cur_dest.close()
    return selected_ids


def copy_alternate_names(src: sqlite3.Connection, dest: sqlite3.Connection, geoname_ids: Iterable[int]) -> None:
    ids = list(geoname_ids)
    if not ids:
        return
    chunk_size = 800
    insert_sql = "INSERT INTO alternate_names (geoname_id, name, name_ascii, is_preferred) VALUES (?, ?, ?, ?)"
    cur_src = src.cursor()
    cur_dest = dest.cursor()
    for start in range(0, len(ids), chunk_size):
        chunk = ids[start : start + chunk_size]
        placeholders = ",".join("?" for _ in chunk)
        query = f"SELECT {', '.join(ALT_COLUMNS)} FROM alternate_names WHERE geoname_id IN ({placeholders})"
        for row in cur_src.execute(query, chunk):
            cur_dest.execute(insert_sql, row)
    dest.commit()
    cur_src.close()
    cur_dest.close()


def copy_metadata(src: sqlite3.Connection, dest: sqlite3.Connection, filter_description: str, source_path: pathlib.Path) -> None:
    src_rows = dict(src.execute("SELECT key, value FROM metadata"))
    additions = {
        "lite_generated_at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "lite_filter": filter_description,
        "lite_source_db": str(source_path),
    }
    src_rows.update(additions)
    dest.executemany("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", src_rows.items())
    dest.commit()


def main(argv: List[str] | None = None) -> int:
    args = parse_args(argv)

    if not args.source.exists():
        raise FileNotFoundError(f"Source database not found: {args.source}")
    ensure_output(args.output, args.overwrite)

    filter_sql, params, description = build_filters(args)

    with sqlite3.connect(args.source) as src_conn, sqlite3.connect(args.output) as dest_conn:
        create_schema(dest_conn)
        ids = copy_features(src_conn, dest_conn, filter_sql, params, args.limit)
        copy_alternate_names(src_conn, dest_conn, ids)
        copy_metadata(src_conn, dest_conn, description, args.source)

    print(f"Generated lite database with {len(ids)} features at {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
