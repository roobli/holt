# holt

Personal **task stack** companion: ordered vertical stack first, optional gantt timeline later.

- **File-backed** next to your notes vault (not inside [Noto](https://github.com/roobli/Noto))
- Each task is a Markdown file; `history.ndjson` is append-only audit
- Task file = readable current state; history = audit (not pure-replay truth)

## Status

Scaffold + **clickable Stack v1.1 demo**. Timeline (gantt) is secondary and deferred.

## Stack demo

```sh
pnpm install
pnpm demo:dev
```

- Empty stack → push top/bottom → select updates detail
- Lanes filter in-memory; reorder via ↑/↓
- Brand **holt**; paper/ink layout aligned to visual baseline v1.1
- Details: [demo/README.md](demo/README.md)

Build: `pnpm demo:build` → `demo/dist/`.

Live URL (GitHub Pages, if enabled): https://roobli.github.io/holt/

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
