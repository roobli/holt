# holt file model (v0)

## Directory

```
<ledger>/
  tasks/
    T-0001.md
  history.ndjson
  state.json          # optional; rebuildable
```

## Task file

YAML frontmatter + Markdown body (open the body in Noto or any editor).

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | `T-` + zero-padded counter; filename matches |
| `title` | yes | short |
| `status` | yes | `open` \| `doing` \| `done` \| `dropped` |
| `lane` | yes | e.g. `personal` \| `work` \| `openjobs` |
| `stack_order` | yes | smaller = nearer stack top; gaps allowed |
| `estimate_min` | no | optional stack block height |
| `due` | no | ISO-8601 |
| `owner` / `watchers` | no | single-user v1 |
| `hooks.pre` / `hooks.post` | no | declaration only; not executed in v1 |
| `created_at` / `updated_at` | yes | ISO-8601 |

## history.ndjson

Append-only. Envelope aligned with [tl](https://github.com/aholbreich/tl) plus optional `data` object:

```json
{"time":"2026-09-16T12:00:00Z","event":"created","task_id":"T-0001","actor":"dylan","data":{"title":"…","stack_order":10,"lane":"personal"}}
{"time":"2026-09-16T12:05:00Z","event":"reordered","task_id":"T-0001","actor":"dylan","data":{"from":10,"to":3}}
{"time":"2026-09-16T12:06:00Z","event":"updated","task_id":"T-0001","actor":"dylan","data":{"status":"doing"}}
```

Events (v1): `created` | `updated` | `reordered` | `reordered_batch` | `deleted` | `body_edited`.

## Write rules

1. Mutate frontmatter → atomic write task file → append history line.
2. Current UI reads `tasks/*.md`; history is audit / undo fuel.
3. Do not treat the log as the only source of truth (unlike taska pure replay).

## Non-goals (v1)

SQLite, sync, multiplayer, executing hooks, embedding inside Noto.
