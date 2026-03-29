# copilot-trace

Parse Visual Studio / GitHub Copilot chat session logs into an AgentTrace-compatible trace store, then inspect the result in a focused multi-page UI for parser review, evaluation triage, and session health.

## Why this exists
Copilot exports are messy, deeply nested, and annoying to inspect by hand. `copilot-trace` turns them into a cleaner trace model you can:

- ingest into SQLite
- export as JSON
- query through a small local API
- review in a browser UI with trace filters, annotations, evaluation context, and dashboard summaries

## What’s in the repo
- **Python parser** for Okonomi-style Copilot session logs
- **CLI** for ingesting one or more session folders
- **SQLite + JSON exporters** using an AgentTrace-like shape
- **Local HTTP API** for traces, sessions, evaluations, and annotation updates
- **React + Vite UI** with dedicated Parser, Evaluation, and Dashboard pages
- **Tests + scripts + Make targets** for repeatable local usage

## Feature highlights
- recursive decoding of nested tool payloads and `ValueContainer` blobs
- persisted storage config in `out/copilot-trace-config.json`
- API-backed filtering, paging, and trace annotation writes
- trace-level evaluation context surfaced directly in the UI
- hash-based page routing (`#/parser`, `#/evaluation`, `#/dashboard`) so direct links survive static hosting
- sample fallback data loaded as a separate asset instead of being bundled into the main JS chunk

## Project structure
```text
copilot-trace/
├── parser/         # parser, CLI, API, storage helpers, evaluation export
├── tests/          # Python parser/API/CLI tests
├── ui/             # React + Vite frontend
├── scripts/        # install/run/ingest helpers
├── docs/           # notes and publishing plan
├── screenshots/    # UI captures
├── out/            # generated sqlite/json/config outputs (local only)
├── Makefile        # common automation entrypoints
└── pyproject.toml  # package metadata
```

## Prerequisites
- Python 3.11+
- Node.js 20+

## Install

### Fast path
```bash
cd copilot-trace
make install
```

### Manual path
```bash
cd copilot-trace
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cd ui && npm ci && cd ..
```

## Quick start

### 1) Ingest Copilot logs
```bash
cd copilot-trace
./scripts/ingest.sh --input ../copilot-logs/Okonomi/copilot-chat/539fc419/sessions
```

Equivalent CLI call:
```bash
cd copilot-trace
. .venv/bin/activate
copilot-trace trace \
  ../copilot-logs/Okonomi/copilot-chat/539fc419/sessions \
  --db out/traces.db \
  --json out/traces.json \
  --rotate-db
```

Inspect the active storage config:
```bash
copilot-trace config
```

### 2) Run the API
```bash
cd copilot-trace
make run-api
```

Equivalent direct command:
```bash
. .venv/bin/activate
python3 parser/api.py --db out/traces.db --host 0.0.0.0 --port 8000
```

### 3) Run the UI
```bash
cd copilot-trace
make run-ui
```

Equivalent direct command:
```bash
cd ui
npm run dev -- --host 0.0.0.0 --port 5173
```

Open <http://localhost:5173/#/parser>.

## UI routes
The UI uses hash routes so you can deep-link without needing server-side rewrite rules:

- `#/parser`
- `#/evaluation`
- `#/dashboard`

Selected session and filter state are mirrored into the URL query string where practical.

## Automation reference

### Common commands
```bash
make install      # create venv + install Python and UI deps
make test         # run Python unit tests
make build        # build Python package + UI bundle
make package      # build Python distribution artifacts
make run-api      # run the local API server
make run-ui       # start Vite dev server
make ingest INPUT=/path/to/sessions
```

### Script equivalents
- `./scripts/install.sh`
- `./scripts/ingest.sh --input /path/to/sessions`
- `./scripts/run-api.sh --db out/traces.db --host 0.0.0.0 --port 8000`
- `./scripts/run-ui.sh --host 0.0.0.0 --port 5173`

## Validation

### Run tests
```bash
cd copilot-trace
make test
```

### Build distributables
```bash
cd copilot-trace
make package
make build
```

## Publishing notes
This repo is close to “shareable side-project” territory, but a couple of publishing decisions should still be made explicitly:

- choose a license
- decide whether to keep example trace exports in-repo or generate them during release prep
- decide whether GitHub Pages, static hosting, or local-only hosting is the intended UI delivery model
- add a real screenshot set for README/social cards if this is going public

### Suggested release checklist
1. Run `make test`
2. Run `make build`
3. Confirm the UI works against both live API and sample fallback
4. Regenerate screenshots if the UI changed
5. Pick a license before making the repo public
6. Push to GitHub and add a short project description + topics

## Notes on dependencies
- `requirements.txt` is intentionally small and geared toward local development.
- Python runtime dependencies live in `pyproject.toml`.
- `requirements.txt` installs the package in editable mode so the `copilot-trace` CLI is available immediately.
- UI dependency versions are locked in `ui/package-lock.json`.

## Screenshots
Current captures live in `screenshots/`.
