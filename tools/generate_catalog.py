# tools/generate_catalog.py
from geodata import generate_dynamic_catalog

# admin1-level (states/provinces)
generate_dynamic_catalog(level="admin1", country=None, min_count=200, limit=1000)

# (optional) admin2-level per country, if you want a deeper catalog:
# generate_dynamic_catalog(level="admin2", country="US", min_count=200, limit=5000)
