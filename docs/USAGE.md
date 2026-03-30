# Using Copilot Trace

## Overview
`copilot-trace` ingests Visual Studio/GitHub Copilot session dumps from `copilot-logs/` and converts them into an AgentTrace-like store. It provides:

- A parser that produces JSON + SQLite traces
- An API (`/api/*`) that exposes sessions, traces, evaluations, and annotations
- A multi-page React UI wired to the live API (with sample fallback data)
- CLI tools, automation (`Makefile`/scripts), and packaging helpers

## Workflow: Adding new Copilot logs / sessions

1. **Export the Copilot logs**
   - In Visual Studio (GitHub Copilot), open the plan/output you want to inspect.
   - Locate the `.mpack` or `state.mpack` file under `copilot-logs/Okonomi/copilot-chat/...` in this workspace (each session has its own directory with the hexdigested name).
   - Copy the entire session directory (e.g., `539fc419/.../sessions/<uuid>`) into your local logs folder if you have new recordings.

2. **Run the CLI ingestion**
   ```bash
   cd copilot-trace
   make ingest INPUT=../copilot-logs/Okonomi/copilot-chat/539fc419/sessions \
       DB=out/traces.db JSON=out/traces.json CONFIG=out/copilot-trace-config.json
   ```
   - `make ingest` wraps `parser/cli.py trace` and rotates `traces.db` if you set `ROTATE=1`.
   - The parser decodes nested payloads, tool calls, and tool results, and stores the traces/evaluations in SQLite + JSON.
   - The generated config file records your current db/json paths and last input timestamp.

3. **Run the API (if not already running)**
   ```bash
   make run-api
   # or: .venv/bin/python parser/api.py --db out/traces.db --host 127.0.0.1 --port 8000
   ```
   - This starts the Flask-style HTTP server exposing `/api/traces`, `/api/traces/sessions`, `/api/evaluations`, `/api/evaluations/sessions`, etc.
   - The CLI just generated the data the API reads.

4. **Start the UI**
   ```bash
   make run-ui
   # or: cd ui && npm run dev -- --host 0.0.0.0 --port 5177
   ```
   - Open `http://localhost:5177` in your browser to navigate between Parser, Evaluation, and Dashboard pages.
   - The UI will fetch the latest sessions/traces/evaluations from the live API. No need to rebuild the UI after each parse unless you want a fresh bundle.

5. **Annotate & explore**
   - Use the Parser page to search traces, switch timeline sort order, and add tags/notes (PATCH persists to `/api/traces/:id`).
   - The trace tree now supports branch expand/collapse controls, and edge badges label common relationships like tool invocation/result flow.
   - Use **Full-screen trace** on the selected trace card when you need to inspect a long payload or linkage metadata without the sidebar squeezing the JSON viewer.
   - The Evaluation page surfaces heuristic scores per session/trace plus explicit status explanations, score bands, and sortable history.
   - Dashboard shows aggregated metrics and the latest evaluation triage.

6. **Automated usage**
   - `make install` sets up deps (`pip install -r requirements.txt`, `npm install` inside `ui`).
   - `make test` runs the Python unit tests.
   - `make build` builds both Python package and UI.
   - `make package` produces a wheel/sdist via `python -m build`.

## Tips
- If you want to inspect a specific Copilot conversation, copy the session folder into `copilot-logs/Okonomi/copilot-chat/<trace>/sessions` and rerun the CLI ingestion.
- The CLI config file (`out/copilot-trace-config.json`) helps you reuse paths in subsequent runs.
- Hash routes (`#/parser`, `#/evaluation`, `#/dashboard`) let you link directly to each page.
- `/api/traces` and `/api/evaluations` now accept `sort=asc|desc` so UI state and direct API calls stay aligned.
- For continuous automation, hook `make ingest` into your CI so new `.mpack` logs are parsed before the UI starts.
