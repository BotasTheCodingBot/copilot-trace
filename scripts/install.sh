#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if command -v cygpath >/dev/null && [[ "$(uname -s)" == *MINGW* ]]; then
  ROOT_DIR="$(cygpath -u "$ROOT_DIR")"
  VENV_DIR="$(cygpath -u "$VENV_DIR")"
fi

VENV_BIN="$VENV_DIR/bin"
if [[ -d "$VENV_DIR/Scripts" ]]; then
  VENV_BIN="$VENV_DIR/Scripts"
fi

"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_BIN/pip" install --upgrade pip
"$VENV_BIN/pip" install -r "$ROOT_DIR/requirements.txt"
