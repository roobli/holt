# holt local Stack GUI

File-backed Stack UI over a ledger directory on disk. Uses the **same command layer** as the CLI (`src/commands.ts` → `src/core/ledger.ts`). This is the product-facing GUI path; the github.io demo remains an in-memory mock only.

## Run

From repo root:

```sh
pnpm install
pnpm gui:dev            # ledger: arg → $HOLT_LEDGER → ~/.config/holt/config.json lastLedger → ./sample
pnpm gui:dev ./sample   # or any ledger path
```

Open `http://127.0.0.1:5174` (override with `HOLT_GUI_PORT`).

The process serves Vite UI + `/api/*` that reads/writes `tasks/*.md` and `history.ndjson`.

### Auto-refresh

`fs.watch` on the ledger directory (debounced) pushes SSE events on `/api/watch`. The UI refreshes when CLI or an external editor changes task files / `history.ndjson` — no manual 刷新 required (button remains as fallback).

### Path bar

- **打开** — switch to path; errors if missing or not a ledger (`tasks/` absent)
- **创建** — shown when path is not ready; creates `tasks/` + empty `history.ndjson`
- Last opened path remembered in `~/.config/holt/config.json` (shared with CLI; legacy `gui.json` still read)

## Shared with CLI

```sh
pnpm holt list ./sample
# push / reorder in the GUI, then (GUI should auto-update):
pnpm holt push ./sample --title "from CLI" --lane work --top
pnpm holt list ./sample
pnpm holt history ./sample --task T-0001
```

Both surfaces call `listTasks` / `pushTask` / `reorderTask` / `readHistory` (plus GUI helpers `moveTask`, `reorderToIndex`, `updateTask`).

## Write toughness

- Task files: atomic write (temp + rename)
- Mutations: `.holt.lock` with retry so concurrent CLI+GUI push/reorder do not interleave mid-write
- API surfaces lock contention as HTTP 409 with a plain-language message (账本正在被占用…)

## What works

- Point at / create a ledger path (header bar)
- list / push top|bottom / reorder (drag + ↑↓) / select + history
- Live refresh when ledger files change
- status & lane updates → task file + history
- CTA「在本机打开正文 / Noto」→ `xdg-open` / `open` on the task `.md` (may no-op in headless boxes; path shown in toast)

## Stubbed / not this package

- Timeline view (disabled)
- github.io static demo (see `demo/`) — do not expand
- nvim adapter
- Cross-machine sync / multiplayer
