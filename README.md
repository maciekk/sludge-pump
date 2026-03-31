# Sludge Pump

An [Obsidian](https://obsidian.md) plugin that rolls over unchecked tasks from recent daily notes into today's note.

## Why "Sludge Pump"?

Over days, unfinished tasks accumulate into a heavy mass that keeps getting rolled over and over, day after day. This evokes the imagery of thick sludge being pumped along — slowly, relentlessly, from one day to the next.

## What it does

When you run the **"Rollover unchecked tasks"** command from the command palette, Sludge Pump:

1. Scans your daily notes from the past N days (configurable, default 7)
2. Finds all unchecked tasks under your `## Tasks` heading
3. Shows a diff preview of all planned changes and asks for confirmation
4. Backs up every file it will touch (for one-click undo)
5. Moves incomplete tasks into today's note under "Rollovers from YYYY-MM-DD" headings
6. Removes those tasks from the source notes

"Incomplete" means any checkbox that isn't `[x]` or `[X]` — including `[ ]` (not started) and extended markers like `[/]` (in progress). Only fully checked items stay in the source note.

### Nested checkboxes

Sludge Pump handles indented task trees correctly.

**Case 1: Unchecked parent** — the entire subtree rolls over, including checked children (they represent in-progress context):

```
Source note (before)              Source note (after)
─────────────────────             ───────────────────
- [ ] Refactor auth               (removed)
  - [x] Extract helper
  - [ ] Update tests

Today's note (added)
────────────────────
Rollovers from 2026-03-24
- [ ] Refactor auth
  - [x] Extract helper
  - [ ] Update tests
```

**Case 2: Checked parent with unchecked children** — the parent stays in the source (it's done), but is included as context in the rollover:

```
Source note (before)              Source note (after)
─────────────────────             ───────────────────
- [x] Deploy pipeline             - [x] Deploy pipeline
  - [x] Write script                - [x] Write script
  - [ ] Run in staging
  - [ ] Update docs

Today's note (added)
────────────────────
Rollovers from 2026-03-24
- [x] Deploy pipeline
  - [ ] Run in staging
  - [ ] Update docs
```

## Installation

### Using the install script

```bash
npm run build        # or: ./install.sh (builds and copies in one step)
./install.sh         # build + copy to ~/Documents/Personal (default vault)
./install.sh ~/path/to/vault   # override vault location
```

Then enable "Sludge Pump" in Obsidian **Settings > Community plugins**.

### Manual

1. Build the plugin (`npm install && npm run build`) or grab `main.js` from a release
2. Copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/sludge-pump/`
3. Enable "Sludge Pump" in Obsidian **Settings > Community plugins**

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Daily notes folder | `_journal/day/YYYY` | Vault-relative path. Supports date tokens: `YYYY`, `MM`, `DD` for year/month/day-based subfolders. |
| Date format | `YYYY-MM-DD` | Moment.js format used for daily note filenames. |
| Lookback days | `7` | How many past days to scan for unchecked tasks. |
| Tasks heading | `Tasks` | The section heading (without `##`) under which tasks live. |
| Backup folder | `.rollover-backups` | Where file backups are stored before each rollover. |

## Commands

| Command | Description |
|---------|-------------|
| **Rollover unchecked tasks from recent daily notes** | Scan, preview, and roll over unchecked tasks into today's note. |
| **Undo last task rollover** | Restore all files from the most recent backup. |

## Safety

Every rollover creates a timestamped backup of all affected files in the backup folder before writing any changes. If anything goes wrong, use the **Undo last task rollover** command to restore the exact pre-rollover state.

## Development

```bash
npm install          # install dependencies
npm run build        # production build -> main.js
npm run dev          # dev build with sourcemaps
npm test             # run tests (vitest)
npm run test:watch   # run tests in watch mode
```

The core rollover logic (`src/rollover.ts`) is pure functions with no Obsidian dependencies, making it straightforward to test.
