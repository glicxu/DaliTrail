"""Entry point for the DaliTrail GeoNames ingestion pipeline.

This script downloads the raw GeoNames datasets, filters them to the feature
codes we care about, and writes the curated SQLite bundle consumed by the
DaliTrail PWA. The initial scaffold only defines the command-line interface;
fill in the TODOs when implementing the actual pipeline.
"""

from __future__ import annotations

import argparse
import pathlib
import sys


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the DaliTrail GeoNames SQLite bundle.",
    )
    parser.add_argument(
        "--config",
        type=pathlib.Path,
        default=pathlib.Path("configs/feature-whitelist.yml"),
        help="Path to the feature whitelist configuration.",
    )
    parser.add_argument(
        "--workdir",
        type=pathlib.Path,
        default=pathlib.Path("data"),
        help="Directory used for temporary staging (default: data/).",
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        default=pathlib.Path("data/geonames_all_countries_latest.db"),
        help="Where to write the final SQLite file.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow the script to overwrite existing artefacts.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    print("🔧 DaliTrail GeoNames ingestion (scaffold)")
    print(f" • config:  {args.config}")
    print(f" • workdir: {args.workdir}")
    print(f" • output:  {args.output}")
    if not args.overwrite and args.output.exists():
        print("Output already exists. Re-run with --overwrite to rebuild.", file=sys.stderr)
        return 1

    print("TODO: implement download, filtering, SQLite generation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
