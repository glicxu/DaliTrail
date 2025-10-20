# DaliTrailData

Data ingestion and packaging pipeline for the DaliTrail PWA. This project downloads raw GeoNames datasets, filters and normalises them, and produces the compressed SQLite bundles that the app ships to end users.

## Goals

- Maintain a reproducible, automated build that turns GeoNames snapshots into a lightweight SQLite database optimised for on-device lookups.
- Track schema/versioning independently from the front-end app so data updates can ship on their own cadence.
- Provide validation and tooling to inspect generated datasets before publishing them.

## Repository Layout

```
.
|-- README.md                 # Project overview & usage
|-- scripts/
|   |-- ingest.py             # Builds the global all-countries SQLite bundle
|   `-- generate_lite_db.py   # Produces filtered lite bundles from the master DB
|-- configs/
|   `-- feature-whitelist.yml # Example feature code whitelist
|-- data/
|   |-- .gitkeep              # Staging/output directory (kept empty in git)
|   `-- downloads/            # Cached GeoNames archives (created at runtime)
|-- samples/
|   `-- allCountries-sample.txt # Tiny GeoNames slice for local testing
|-- requirements.txt          # Python dependencies
|-- Makefile                  # Convenience targets for build/test/publish
`-- .gitignore                # Exclude virtualenvs, dumps, local artefacts
```

> **Note**: The pipeline intentionally lives outside the `DaliTrail` web app repository so data tooling can evolve independently and include heavier dependencies.

## Build Overview

1. **Download sources**  
   Fetch the required GeoNames dumps (e.g., `allCountries.zip`, `featureCodes_en.txt`, optional `alternateNamesV2.zip`). Each run records checksums to ensure reproducibility.

2. **Filter & normalise**  
   - Retain only feature codes listed in `configs/feature-whitelist.yml` (e.g., lakes, trails, peaks, populated places).  
   - Parse TSV rows, extract required columns, normalise strings, and compute helper fields (search tokens, grid buckets).  
   - Optionally merge alternate names for richer search experiences.

3. **Load into SQLite**  
   Populate the target schema (`features`, `alternate_names`, `metadata`) using batched inserts. Build indexes for geospatial windows and name lookup.

4. **Validate & package**  
   Run assertions (row counts per feature code, random sanity checks, target size). Vacuum and optionally compress the final `geonames_all_countries_latest.db`. Generate checksums and a JSON manifest describing the build.

5. **Publish**  
   Upload the artefacts to the static hosting bucket/DaliTrail CDN. The app consumes the manifest to decide whether a new dataset is available.

## Getting Started

```bash
# create a virtual environment
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

# install dependencies
pip install -r requirements.txt

# run against the bundled sample dataset
python scripts/ingest.py --use-sample --overwrite --output data/geonames-lite-sample.db

# or ingest the full GeoNames dump (archive cached in data/downloads/)
python scripts/ingest.py --overwrite --output data/geonames_all_countries_latest.db

# generate a filtered lite bundle (e.g., US + CA only)
python scripts/generate_lite_db.py \
  --source data/geonames_all_countries_latest.db \
  --countries US,CA \
  --output data/geonames-us-ca.db
```

The initial implementation focuses on building a single global bundle. Use the sample dataset first to verify the flow, then point the script at the official GeoNames dump when you are ready. You can override `--download-dir` or `--workdir` if you want to relocate cached archives and staging files.

## Automation

Recommended CI steps (e.g., GitHub Actions):

1. Checkout repository and set up Python.
2. Cache downloaded GeoNames archives to minimise bandwidth (e.g., persist `data/downloads`).
3. Run the ingestion command to build the SQLite bundle.
4. Execute validation tests (e.g., `make test`).
5. Upload build artefacts (`geonames_all_countries_latest.db`, lite subsets, checksums, manifest) as release assets or to a storage bucket.

Document the produced manifest format so the DaliTrail app can track dataset versions.

## License Notes

DaliTrailData redistributes GeoNames data. Review GeoNames’ attribution requirements:  
<http://www.geonames.org/export/>

Include the necessary credits in both the dataset manifest and within the PWA when presenting GeoNames-derived content.

## Local API usage

When the DaliTrail FastAPI server runs from this repository it automatically looks for a lite GeoNames bundle named geonames-lite-us-wa.db. By default it resolves the dataset from:

- DALITRAIL_GEONAMES_DB environment variable, if set.
- ./data/geonames-lite-us-wa.db (inside this repo).
- ../DaliTrailData/data/geonames-lite-us-wa.db (sibling data repo).

Two helper endpoints are exposed:

- GET /datasets/geonames-lite-us-wa.db downloads the active SQLite file.
- GET /api/geonames/datasets returns the list of GeoNames bundles the server can provide.
- GET /api/places/nearby?lat=...&lng=...&radius_km=10&limit=25 returns nearby points of interest. Optional eature_codes=H.LK,T.TRL narrows results.

Example query for downtown Seattle:

`ash
curl "http://localhost:8000/api/places/nearby?lat=47.6062&lng=-122.3321&radius_km=5"
`

The response includes dataset metadata (if present) and an ordered list of features with their distance in kilometres from the supplied coordinates.

Inside the PWA, the Location view's Search button reads the downloaded GeoNames SQLite bundle directly in the browser (via sql.js) to surface nearby places of interest for the latest saved point. Use About -> GeoNames Data -> Download GeoNames to pick a state/region; the first time you run Search the app will fetch the sql.js runtime (cached afterwards), so make sure you are online once before relying on the feature offline.

## Backup & Restore

Use the About tab in the PWA and expand *Backup & Restore* to export a JSON snapshot of all saved data (locations, notes, trail sessions, and GeoNames metadata). The same panel lets you load the file on another device to restore what you backed up.

