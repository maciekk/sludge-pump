# Task Rollover — Obsidian Plugin

## Build & Test

```bash
npm install          # install dependencies
npm run build        # production build → main.js
npm run dev          # dev build with sourcemaps
npm test             # run tests (vitest)
npm run test:watch   # run tests in watch mode
```

## Architecture

- `src/main.ts` — Plugin entry point. Registers two command-palette commands ("Rollover unchecked tasks" and "Undo last rollover"), settings tab, and backup/restore logic. All Obsidian API interaction lives here.
- `src/rollover.ts` — Pure logic with zero Obsidian dependencies. Parses the `## Tasks` section into groups of checkbox trees, computes which items to roll over vs retain, and produces new file contents. Fully testable.
- `src/rollover.test.ts` — Unit tests for the pure rollover logic (vitest).
- `esbuild.config.mjs` — Bundles `src/main.ts` into `main.js` for Obsidian.

## Key design decisions

- **Safety first:** Every rollover backs up all affected files to `.rollover-backups/<timestamp>/` before any writes. Undo restores from the latest backup.
- **Pure core:** All parsing and rollover computation is in `rollover.ts` with no side effects, making it easy to test without mocking Obsidian APIs.
- **Nested checkboxes:** Unchecked items roll over with their full subtree. Checked parents with unchecked descendants are included as context (preserving their `[x]` state).

## Installing into Obsidian

Copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/task-rollover/`, then enable the plugin in Obsidian settings.
