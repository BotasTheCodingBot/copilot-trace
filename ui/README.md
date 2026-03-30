# Copilot Trace UI

Trace review UI for browsing Copilot sessions, evaluation history, and per-trace payloads.

## Current shape

The UI is intentionally split into three focused pages:

- **Parser overview** — timeline-first session review with filters, paging, and a docked selected-trace panel.
- **Evaluation** — session score trends, recent trace evaluations, and score breakdowns.
- **Dashboard** — aggregate counts, coverage signals, and low-score triage.

## Run

```bash
npm ci
npm run dev
```

## Test and build

```bash
npm run test
npm run build
```

## Notes

- The app prefers the live API, but falls back to `public/traces.sample.json` when the API is unavailable.
- Page route and filter state stay in the URL so a focused review view can be reopened or shared locally.
- The three major views are lazy-loaded so the initial shell stays lighter and only fetches a page bundle when someone opens it.
- Vite manual chunks split React, MUI core, MUI icons, and the remaining vendor code into separate bundles to keep the main app chunk from swallowing the whole UI at once.
- Old trace-tree and fullscreen-navigation experiments were removed to keep the UI aligned with the current review workflow.
