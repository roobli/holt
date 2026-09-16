# holt local Stack GUI

File-backed Stack UI over a ledger directory on disk. Uses the **same command layer** as the CLI (`src/commands.ts` → `src/core/ledger.ts`). This is the product-facing GUI path; the github.io demo remains an in-memory mock only.

## Run

From repo root:

```sh
pnpm install
pnpm gui:dev            # default ledger: ./sample
pnpm gui:dev ./sample   # or any ledger path
```

Open `http://127.0.0.1:5174` (override with `HOLT_GUI_PORT`).

The process serves Vite UI + `/api/*` that reads/writes `tasks/*.md` and `history.ndjson`.

## Shared with CLI

```sh
pnpm holt list ./sample
# push / reorder in the GUI, then:
pnpm holt list ./sample
pnpm holt history ./sample --task T-0001
```

Both surfaces call `listTasks` / `pushTask` / `reorderTask` / `readHistory` (plus GUI helpers `moveTask`, `reorderToIndex`, `updateTask`).

## What works

- Point at a ledger path (header bar)
- list / push top|bottom / reorder (drag + ↑↓) / select + history
- status & lane updates → task file + history
- CTA「在本机打开正文 / Noto」→ `xdg-open` / `open` on the task `.md` (may no-op in headless boxes; path shown in toast)

## Stubbed / not this package

- Timeline view (disabled)
- github.io static demo (see `demo/`) — do not expand
- nvim adapter
