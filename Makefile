.PHONY: ingest test clean lint

PYTHON ?= python

INGEST_ARGS := --overwrite

ifdef SOURCE
INGEST_ARGS += --source $(SOURCE)
endif
ifdef CONFIG
INGEST_ARGS += --config $(CONFIG)
endif
ifdef OUTPUT
INGEST_ARGS += --output $(OUTPUT)
endif
ifdef USE_SAMPLE
INGEST_ARGS += --use-sample
endif
ifdef DOWNLOAD_DIR
INGEST_ARGS += --download-dir $(DOWNLOAD_DIR)
endif
ifdef WORKDIR
INGEST_ARGS += --workdir $(WORKDIR)
endif
ifdef BATCH
INGEST_ARGS += --batch-size $(BATCH)
endif
ifdef QUIET
INGEST_ARGS += --quiet
endif

# Default ingestion target
ingest:
	@echo "Running GeoNames ingestion..."
	$(PYTHON) scripts/ingest.py $(INGEST_ARGS)

# Placeholder test target
test:
	@echo "No tests defined yet."

lint:
	@echo "No linters configured yet."

# Remove generated artefacts
clean:
	@echo "Cleaning staging and output directories..."
	$(PYTHON) - <<'PY'
import pathlib
from shutil import rmtree

data_dir = pathlib.Path('data')
download_dir = data_dir / 'downloads'
work_dir = data_dir / 'work'

for directory in (work_dir, download_dir):
    if directory.exists():
        for item in directory.iterdir():
            if item.is_file():
                item.unlink()
            else:
                rmtree(item, ignore_errors=True)
    directory.mkdir(parents=True, exist_ok=True)

if not data_dir.exists():
    data_dir.mkdir(parents=True, exist_ok=True)
PY
