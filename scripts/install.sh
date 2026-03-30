#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

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

"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_BIN/pip" install --upgrade pip
"$VENV_BIN/pip" install -r "$ROOT_DIR/requirements.txt"
