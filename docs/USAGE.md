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
   - Copy the entire session directory (e.g. `539fc419/.../sessions/<uuid>`) into your local logs folder if you have new recordings.

2. **Run the CLI ingestion**
   ```bash
   cd copilot-trace
   make ingest INPUT=../copilot-logs/Okonomi/copilot-chat/539fc419/sessions \
       DB=out/traces.db JSON=out/traces.json
   ```
   - `make ingest` wraps `parser/cli.py trace`.
   - The parser decodes nested payloads, tool calls, and tool results, then stores traces/evaluations in SQLite + JSON.
   - The generated config file records your current db/json paths and last input timestamp.

3. **Run the API (if not already running)**
   ```bash
   make run-api
   # or: .venv/bin/python parser/api.py --db out/traces.db --host 127.0.0.1 --port 8000
   ```
   - This starts the local HTTP server exposing `/api/traces`, `/api/traces/sessions`, `/api/evaluations`, `/api/evaluations/sessions`, and annotation updates.
   - The CLI just generated the data the API reads.

4. **Start the UI**
   ```bash
   make run-ui
   # or: cd ui && npm run dev -- --host 0.0.0.0 --port 5173
   ```
   - Open `http://localhost:5173/#/parser` in your browser to navigate between Parser, Evaluation, and Dashboard pages.
   - The UI fetches the latest sessions/traces/evaluations from the live API. No rebuild is needed after each parse unless you want a fresh bundle.

5. **Annotate & explore**
   - Use the Parser page to search traces, switch timeline sort order, and inspect the selected trace beside the session stream.
   - Use **Export session** in the trace timeline header to write the currently selected session as a local MLflow-oriented bundle (`manifest.json`, `session.json`, `traces.json`, `evaluations.json`, `mlflow-run.json`) to a folder on disk.
   - The selected trace panel keeps payload and evaluation context visible while you move through paged results.
   - The Evaluation page surfaces heuristic scores per session/trace plus explicit status explanations, score bands, and sortable history.
   - Dashboard shows aggregated metrics and low-score triage.

6. **Import a bundle into MLflow (optional)**
   ```bash
   cd copilot-trace
   . .venv/bin/activate
   pip install mlflow
   python scripts/import_bundle_to_mlflow.py \
       /path/to/export-root/copilot-session-export \
       --tracking-uri file:$(pwd)/out/mlruns \
       --experiment-name copilot-trace
   ```
   - The importer reads the exported bundle files plus `mlflow-run.json` and creates a real MLflow run.
   - Exported tags, params, and numeric metrics are logged to MLflow.
   - The whole bundle directory is uploaded as artifacts under `copilot_trace_bundle/` unless you override `--artifact-path`.
   - Useful flags:
     - `--run-name my-session-run` to override the exported run name
     - `--artifact-path raw_bundle` to change the artifact subdirectory
     - `--no-set-terminated` if you want to leave lifecycle handling to another process

7. **Automated usage**
   - `make install` sets up deps (`pip install -r requirements.txt`, `npm ci` inside `ui`).
   - `make test` runs Python and UI tests.
   - `make build` builds both Python package and UI.
   - `make package` produces a wheel/sdist via `python -m build`.

## Tips
- If you want to inspect a specific Copilot conversation, copy the session folder into `copilot-logs/Okonomi/copilot-chat/<trace>/sessions` and rerun ingestion.
- The CLI config file (`out/copilot-trace-config.json`) helps you reuse paths in subsequent runs.
- Hash routes (`#/parser`, `#/evaluation`, `#/dashboard`) let you link directly to each page.
- `/api/traces` and `/api/evaluations` accept `sort=asc|desc` so UI state and direct API calls stay aligned.
- For continuous automation, hook `make ingest` into your CI so new `.mpack` logs are parsed before the UI starts.