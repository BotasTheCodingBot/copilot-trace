#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"

convert_path() {
  local path="$1"
  if [[ "$path" =~ ^([A-Za-z]):\\(.*) ]]; then
    local drive=${BASH_REMATCH[1],,}
    local rest=${BASH_REMATCH[2]}
    echo "/$drive/${rest//\\//}"
  else
    echo "$path"
  fi
}

if [[ "$(uname -s)" =~ MINGW ]] || [[ "$(uname -s)" =~ MSYS ]]; then
  ROOT_DIR="$(convert_path "$ROOT_DIR")"
  VENV_DIR="$(convert_path "$VENV_DIR")"
fi

VENV_BIN="$VENV_DIR/bin"
if [[ -d "$VENV_DIR/Scripts" ]]; then
  VENV_BIN="$VENV_DIR/Scripts"
fi

PYTHON_EXEC="$VENV_BIN/python"
if [[ -f "$VENV_BIN/python.exe" ]]; then
  PYTHON_EXEC="$VENV_BIN/python.exe"
fi

HOST="0.0.0.0"
PORT="8000"
DB="$ROOT_DIR/out/traces.db"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --db)
      DB="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

exec "$PYTHON_EXEC" "$ROOT_DIR/parser/api.py" --db "$DB" --host "$HOST" --port "$PORT"
