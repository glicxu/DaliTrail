#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

# Config (override with env vars if you like)
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-9000}"
APP="${APP:-main.py}"
PY="${PY:-python}"

# --- ADDED ENVIRONMENT VARIABLE SETTING ---
export DALITRAIL_GEONAMES_DB="/home/dali-op/dali/data/geonames-all_countries_latest.db"
# ------------------------------------------

cd "$SCRIPT_DIR"

# Activate venv if present
if [[ -d "$VENV_DIR" ]]; then
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
else
  echo "warning: virtualenv not found at $VENV_DIR; using system python" >&2
fi

find_listen_pids() {
  # echo PIDs (space-separated) that are LISTENing on $PORT
  if command -v lsof >/dev/null 2>&1; then
    # -t: terse PIDs only, -i: port, -sTCP:LISTEN for TCP listeners
    # shellcheck disable=SC2010
    lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    # fuser returns nonzero if no process; suppress errors
    fuser -n tcp "$PORT" 2>/dev/null || true
  else
    echo "note: neither 'lsof' nor 'fuser' found; skipping pre-kill check" >&2
    echo ""
  fi
}

kill_pids() {
  local pids=("$@")
  [[ ${#pids[@]} -eq 0 ]] && return 0
  echo "Stopping process(es) on :$PORT: ${pids[*]} ..."
  # Try graceful first
  kill -TERM "${pids[@]}" 2>/dev/null || true

  # Wait for port to free (up to ~6s)
  for _ in {1..12}; do
    sleep 0.5
    if [[ -z "$(find_listen_pids)" ]]; then
      echo "Port :$PORT is free."
      return 0
    fi
  done

  # Force kill if still there
  echo "Forcing kill..."
  kill -KILL "${pids[@]}" 2>/dev/null || true
  sleep 0.3
}

ensure_port_free() {
  local pids
  pids="$(find_listen_pids || true)"
  if [[ -n "${pids// /}" ]]; then
    # split to array
    read -r -a arr <<<"$pids"
    kill_pids "${arr[@]}"
  fi
}

# Restart-if-running: free the port first, then exec the app
ensure_port_free

echo "Starting ${APP} on ${HOST}:${PORT} ..."
exec "$PY" "$APP" --host "$HOST" --port "$PORT"