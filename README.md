# holt

Personal **task stack** companion: ordered vertical stack first, optional gantt timeline later.

**Local-private first.** Source of truth = ledger files beside your vault (`tasks/*.md` + `history.ndjson`), not github.io. GUI / CLI / nvim are adapters over the same file model and command semantics.

- Each task is a Markdown file; `history.ndjson` is append-only audit
- Task file = readable current state; history = audit (not pure-replay truth)
- Implementation order: file model → CLI → **Stack GUI ↔ local dir** → nvim later

## Status

- File model + **CLI** + **local Stack GUI** — same commands over a ledger path
- Clickable Stack demo on Pages — **mock only** (in-memory); not the product
- Timeline (gantt) deferred

## Shared commands

CLI and local GUI both use `src/commands.ts` (`listTasks`, `pushTask`, `reorderTask`, `readHistory`, plus GUI helpers `moveTask` / `reorderToIndex` / `updateTask`). Write rules stay in `src/core/ledger.ts`.

## CLI (local ledger)

```sh
pnpm install
# from repo root; default ledger is ./sample
pnpm holt list
pnpm holt push --title "Ship CLI" --lane work --estimate 45 --top
pnpm holt reorder T-0001 --to 10
pnpm holt history --task T-0001

# or via bin after link:
pnpm link --global   # optional
holt list ./sample
```

Commands operate on a ledger directory:

```
<ledger>/
  tasks/T-0001.md
  history.ndjson
```

## Local Stack GUI (file-backed)

```sh
pnpm gui:dev            # http://127.0.0.1:5174 · ledger ./sample
pnpm gui:dev /path/to/ledger
```

Push / reorder / history in the GUI update the same files the CLI reads (and vice versa). Details: [gui/README.md](gui/README.md).

Visual: Stack v1.1 (holt brand, accent `#375A6E`, card heights 48–120px, Views/Lanes, CTA「在本机打开正文 / Noto」).

## Stack demo (mock only)

```sh
pnpm demo:dev
```

Live Pages (clickable **mock** only — in-memory / localStorage): https://roobli.github.io/holt/

Details: [demo/README.md](demo/README.md). **Do not treat the website as the product**; do not expand the demo further.

| Surface | Backing | Command |
| --- | --- | --- |
| CLI | ledger dir on disk | `pnpm holt …` |
| Local GUI | same ledger dir | `pnpm gui:dev` |
| github.io demo | in-memory mock | `pnpm demo:dev` / Pages |

## Ledger layout

```
<ledger>/
  tasks/T-0001.md
  history.ndjson
  state.json          # optional cache
```

See [docs/file-model.md](docs/file-model.md).

## Develop

```sh
pnpm install
pnpm test
pnpm typecheck
```

## License

MIT
