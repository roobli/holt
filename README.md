# holt

Personal **task stack** companion: ordered vertical stack first, optional gantt timeline later.

**Local-private first.** Source of truth = ledger files beside your vault (`tasks/*.md` + `history.ndjson`), not github.io. GUI / CLI / nvim are adapters over the same file model and command semantics.

- Each task is a Markdown file; `history.ndjson` is append-only audit
- Task file = readable current state; history = audit (not pure-replay truth)
- Implementation order: file model → **CLI** → Stack GUI wired to a local dir → nvim later

## Status

- File model + **CLI** (list / push / reorder / history) — real surface starting point
- Clickable Stack demo on Pages — **mock only** (in-memory); not the product
- Timeline (gantt) deferred

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

## Stack demo (mock)

```sh
pnpm demo:dev
```

Live Pages (clickable mock only): https://roobli.github.io/holt/

Details: [demo/README.md](demo/README.md). Do not treat the website as the product.

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
