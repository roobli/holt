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

CLI and local GUI both use `src/commands.ts` (`listTasks`, `pushTask`, `reorderTask`, `readHistory`, `updateTask`, `completeProject`, `ensureLedger` / `inspectLedger`, `openTaskBody`, plus GUI helpers `moveTask` / `reorderToIndex`). Write rules stay in `src/core/ledger.ts`.

## CLI (local ledger)

```sh
pnpm install
# from repo root; default ledger: arg → $HOLT_LEDGER → ~/.config/holt/config.json lastLedger → ./sample
pnpm holt list
pnpm holt list --project holt-mvp --json
pnpm holt push --title "Ship CLI" --lane work --estimate 2h --project holt-mvp --top
pnpm holt update T-0002 --blocked-by T-0001 --estimate 1d
pnpm holt update T-0002 --add-blocked-by T-0003
pnpm holt update T-0001 --status done
pnpm holt complete-project holt-mvp
pnpm holt reorder T-0001 --to 10
pnpm holt history --task T-0001 --json
pnpm holt open-body T-0001          # $EDITOR / xdg-open / open
pnpm holt ensure-ledger /tmp/my-holt
pnpm holt inspect ./sample --json

# or via bin after link:
pnpm link --global   # optional
holt list ./sample
```
Estimate accepts `45m` / `2h` / `1d` (1d = 8h) or a bare minute number. Soft table headers stay four columns (no deps/project columns). `--json` on `list` / `history` / `inspect` prints stable machine JSON on stdout.

Commands operate on a ledger directory:

```
<ledger>/
  tasks/T-0001.md
  history.ndjson
```

## Local Stack GUI (file-backed)

```sh
pnpm gui:dev            # http://127.0.0.1:5174 · arg → $HOLT_LEDGER → lastLedger → ./sample
pnpm gui:dev /path/to/ledger
```

Push / reorder / history in the GUI update the same files the CLI reads (and vice versa). **GUI auto-refreshes** when CLI or an editor changes ledger files (`fs.watch` → SSE). Path bar can validate / **创建** an empty ledger (`tasks/` + `history.ndjson`); last path is stored in `~/.config/holt/config.json` (shared with CLI; legacy `gui.json` still read). See [docs/ledger-resolution.md](docs/ledger-resolution.md). The repo `sample/` ledger is a **clean seed** (see `sample/README.md`); use temp dirs for smoke tests.

Details: [gui/README.md](gui/README.md).

Visual: Stack v1.2 (soft table headers, Detail default collapsed, wide shell). Do not restyle the table shell further — harden ledger wiring instead.

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
