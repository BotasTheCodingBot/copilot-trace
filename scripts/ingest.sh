#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"

INPUT=""
DB="$ROOT_DIR/out/traces.db"
JSON="$ROOT_DIR/out/traces.json"
CONFIG="$ROOT_DIR/out/copilot-trace-config.json"
ROTATE_DB="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      INPUT="$2"
      shift 2
      ;;
    --db)
      DB="$2"
      shift 2
      ;;
    --json)
      JSON="$2"
      shift 2
      ;;
    --config)
      CONFIG="$2"
      shift 2
      ;;
    --no-rotate-db)
      ROTATE_DB="false"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$INPUT" ]]; then
  echo "Usage: $0 --input /path/to/sessions [--db out/traces.db --json out/traces.json --config out/copilot-trace-config.json]" >&2
  exit 2
fi

mkdir -p "$(dirname "$DB")" "$(dirname "$JSON")" "$(dirname "$CONFIG")"

ARGS=(trace "$INPUT" --db "$DB" --json "$JSON" --config "$CONFIG")
if [[ "$ROTATE_DB" == "true" ]]; then
  ARGS+=(--rotate-db)
fi

exec "$VENV_DIR/bin/copilot-trace" "${ARGS[@]}"
