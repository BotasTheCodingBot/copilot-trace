# Roadmap for Copilot Trace

## Goals
Grow the copilot-trace prototype into a full AgentTrace-style workspace so you can: parse every Copilot conversation, understand each decision, evaluate outputs over time, and interact with traces via a modern UI + API.

## Missing features we will build
1. **Evaluation framework** – bring over TracerEval behavior so we can define test cases, score Copilot responses, and visualize evaluation history just like AgentTrace. *Tasks:*
   - Define a test runner + scoring helpers (unit tests, accuracy metrics).
   - Store evaluation results in SQLite/JSON alongside traces.
   - Surface a dedicated UI view with scorecards/history + screenshot proof. (Current task in development.)

2. **Advanced dashboard components** – add filters, tagging, annotation, and importance charts.
   - Build UI filters for trace type/tag and timeline search.
   - Allow tags/notes to be edited per trace and reflected in the API/db.
   - Extend session overview with charts (e.g., counts by type). Take screenshot when done.
   - ✅ Current UI now splits these capabilities into dedicated Parser overview / Evaluation / Dashboard pages with a workspace menu.

3. **Trace ingestion CLI + storage helpers** – match AgentTrace’s `TraceManager` convenience.
   - Create a CLI entrypoint `copilot-trace trace` to ingest programmatically.
   - Support swapping SQLite storage paths and rotating DBs.
   - Document CLI usage in README.

4. **API & evaluation integration** – unify backend data flow.
   - Extend API to serve evaluation results + annotations.
   - Add pagination/filters to `/api/traces` and `/api/traces/sessions`.
   - Ensure the UI consumes these endpoints rather than static JSON.

5. **Production readiness** – packaging, documentation, and automation.
   - Add `requirements.txt`/`package-lock` (done) and plan `pyproject` plus npm scripts.
   - Provide scripts to regenerate traces + run tests (`make test` style).
   - Document architecture in `docs/PLAN.md` (this file) and README.

## Next immediate milestones
- **Feature 1** (Evaluation framework) – currently in progress, finish parser export + evaluation UI, run tests, capture screenshot. (Subagent working now.)
- **Feature 2** (Advanced dashboard) – once evaluation view is stable, add filters/tags and capture screenshot.
- **Feature 3** (CLI/storage helpers) – after UI done, create CLI/tracer helpers.
- **Feature 4** (API + evaluation integration) – build on top of the new schema.
- **Feature 5** (Docs/automation) – wrap up with release checklist.
