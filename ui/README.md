# Copilot Trace UI

Trace review UI for browsing Copilot sessions, evaluation history, and per-trace payloads.

## What changed

Recent trace-tree upgrades include:

- **Zoom + pan trace tree** for dense sessions.
- **Waypoint mini-map** for jumping across roots and the active branch.
- **Export tools** for the visible tree/session slice, selected path, selected trace, and trace diffs.
- **Trace diff tool** in the selected-trace panel for comparing two traces from the current filtered session.

## Run

```bash
npm install
npm run dev
```

## Test

```bash
npm run test
npm run build
```

## Notes

- The app prefers the live API, but falls back to `public/traces.sample.json` when the API is unavailable.
- Diff output is intentionally lightweight and path-oriented so reviewers can quickly spot field-level changes without leaving the UI.
