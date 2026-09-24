# holt local Stack GUI

File-backed Stack UI over a ledger directory on disk. Uses the **same command layer** as the CLI (`src/commands.ts` → `src/core/ledger.ts`). This is the product-facing GUI path (local only; no public demo site).

## Run

From repo root:

```sh
pnpm install
pnpm holt gui           # preferred — same as pnpm gui:dev
pnpm holt gui ~/notes/holt-ledger
pnpm gui:dev            # equivalent low-level script
```

Prefer a personal ledger (`~/…/holt-ledger`); `./sample` is for tryouts only.

Open `http://127.0.0.1:5174` (override with `HOLT_GUI_PORT`).

The process serves Vite UI + `/api/*` that reads/writes `tasks/*.md` and `history.ndjson`.

### Auto-refresh

`fs.watch` on **`tasks/` + `history.ndjson`** (non-recursive, plus a thin root safety net; debounced) pushes SSE on `/api/watch`. More reliable than recursive root watch on some Linux setups. The UI refreshes when CLI or an external editor changes ledger files — no manual 刷新 required (button remains as fallback).

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
- Detail body shows soft task links `@{T-xxxx}` (click → select in Stack)
- CTA「Open in editor · 在编辑器中打开」→ same as CLI `open-body` (`$EDITOR` / Noto.app / `xdg-open` / `open`). Headless / no display: `opened=false`, toast shows path + 未打开

## Stubbed / not this package

- Timeline view (disabled)
- github.io static demo (see `demo/`) — do not expand
- nvim adapter
- Cross-machine sync / multiplayer
