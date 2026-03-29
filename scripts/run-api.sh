#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"

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

exec "$VENV_DIR/bin/python" "$ROOT_DIR/parser/api.py" --db "$DB" --host "$HOST" --port "$PORT"
