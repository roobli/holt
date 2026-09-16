# holt

Personal **task stack** companion: ordered vertical stack first, optional gantt timeline later.

- **File-backed** next to your notes vault (not inside [Noto](https://github.com/roobli/Noto))
- Each task is a Markdown file; `history.ndjson` is append-only audit
- Task file = readable current state; history = audit (not pure-replay truth)

## Status

Scaffold. UI follows Stack primary visual baseline (v1.1). Timeline (gantt) is secondary and deferred.

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
```

## License

MIT
