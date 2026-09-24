# holt file model (v1)

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
| `estimate` | no | duration with unit: `45m` / `2h` / `1d` / `90` (bare = minutes) |
| `estimate_min` | no | non-negative minutes; dual-written from `estimate` during transition; legacy files may have only this |
| `blocked_by` | no | `string[]` of task ids this task depends on; truth for deps (`blocks` is derived, not stored) |
| `project` | no | slug; empty / omitted = ungrouped |
| `due` | no | ISO-8601 |
| `owner` / `watchers` | no | single-user v1 |
| `hooks.pre` / `hooks.post` | no | declaration only; not executed in v1 |
| `created_at` / `updated_at` | yes | ISO-8601 |

### Estimate units (v1)

```text
^\s*(\d+(?:\.\d+)?)\s*([mhd])?\s*$   i
```

| Suffix | Meaning | Minutes |
| --- | --- | --- |
| `m` or omitted | minutes | ×1 |
| `h` | hours | ×60 |
| `d` | workday | ×60×8 (**1d = 8h**) |

- **Display:** prefer raw `estimate`; if only legacy `estimate_min` → show `Nm`.
- **Block height / layout:** use normalized minutes only.
- **Write (push/update):** store `estimate` and dual-write `estimate_min`. Do not rewrite untouched legacy files.

Invalid estimate strings fail validation (no silent swallow).

### Dependencies

- Truth: `blocked_by: [T-0001, …]` (ordered, deduped). No self-deps; unknown ids rejected on write.
- Derived: `blocks(A)` = tasks whose `blocked_by` contains A (optional; not stored).
- Marking `status` → `done` is **refused** if any blocker is still `open`/`doing`, with a human message (e.g. `无法标完成：仍被 T-0001、T-0003 阻塞`). No force-done flag in v1. `dropped` does not use this rule.


### Soft task links (body)

- In the Markdown body, `@{T-xxxx}` is a **task link / 任务链接** (soft reference).
- Parsed from body only — no required frontmatter field. Not a hard dependency.
- Hard deps stay on `blocked_by` / `--blocked-by` (done-guard semantics unchanged).
- GUI Detail renders known ids as clickable (select/focus in Stack); unknown ids stay muted plain text.

### Project

- Field only (`project: <slug>`); no `projects/` directory in v1.
- `list --project <slug>` filters; GUI filters only (no group headers).
- `complete-project <slug>`: select `open`/`doing` tasks with that slug; run the same done checks (batch-aware: co-completed tasks count as clearing blockers); **all-or-nothing** under one lock. History: one `project_completed` summary (`task_id: "*"`) then per-task `updated`.

## history.ndjson

Append-only. Envelope aligned with [tl](https://github.com/aholbreich/tl) plus optional `data` object:

```json
{"time":"2026-09-16T12:00:00Z","event":"created","task_id":"T-0001","actor":"dylan","data":{"title":"…","stack_order":10,"lane":"personal"}}
{"time":"2026-09-16T12:05:00Z","event":"reordered","task_id":"T-0001","actor":"dylan","data":{"from":10,"to":3}}
{"time":"2026-09-16T12:06:00Z","event":"updated","task_id":"T-0001","actor":"dylan","data":{"status":"doing"}}
{"time":"2026-09-16T12:10:00Z","event":"project_completed","task_id":"*","actor":"cli","data":{"project":"holt-mvp","task_ids":["T-0001","T-0002"]}}
```

Events (v1): `created` | `updated` | `reordered` | `reordered_batch` | `deleted` | `body_edited` | `project_completed`.

## Write rules

1. Mutate frontmatter → **atomic** write task file (temp + rename) → append history line.
2. Concurrent CLI/GUI mutations take a short-lived `.holt.lock` under the ledger root (retry / stale steal); multi-step ops (move, rebalance, `complete-project`) hold one lock for the whole sequence.
3. Current UI reads `tasks/*.md`; history is audit / undo fuel.
4. Do not treat the log as the only source of truth (unlike taska pure replay).
5. `ensureLedger` creates `tasks/` and an empty `history.ndjson` when initializing a path.

## Non-goals (v1)

SQLite, sync, multiplayer, executing hooks, embedding inside Noto, storing derived `blocks`, `projects/*.md`, force-done, Timeline/nvim restyles.
