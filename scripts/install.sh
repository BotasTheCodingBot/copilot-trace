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

detect_python() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "$1"
    return
  fi
  return 1
}

if ! detect_python "$PYTHON_BIN" >/dev/null 2>&1; then
  if detect_python python3 >/dev/null 2>&1; then
    PYTHON_BIN=python3
  elif detect_python python >/dev/null 2>&1; then
    PYTHON_BIN=python
  elif detect_python py >/dev/null 2>&1; then
    PYTHON_BIN="py -3"
  else
    echo "python interpreter not found" >&2
    exit 1
  fi
fi

VENV_BIN="$VENV_DIR/bin"
if [[ -d "$VENV_DIR/Scripts" ]]; then
  VENV_BIN="$VENV_DIR/Scripts"
fi

"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_BIN/pip" install --upgrade pip
"$VENV_BIN/pip" install -r "$ROOT_DIR/requirements.txt"
