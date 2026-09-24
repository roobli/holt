# UI baseline

- **Primary:** vertical Stack — atelier visual **v1.2 wide** (IA from v1.1).
  - Left rail ~200px (Views / Lanes)
  - Stack `1fr` eats remaining width — **no** page `max-width` centered shell
  - Detail ~280px; **default collapsed on large screens**, expand when a card is selected
  - Soft table headers (任务 · 状态 · lane · 估时): faint labels, not sortable; column-aligned meta; no vertical guides/zebra/cell grid; tall-row meta top-aligned
  - Block height from `estimate_min` capped 48–120px; drag primary; accent `#375A6E`
  - CTA: Open in editor · 在编辑器中打开 (`holt open-body`)
- **Secondary:** gantt-style Timeline (due / time-block); deferred; three-slot encoding when built.
- Body editing: Detail CTA / CLI `open-body` → `$EDITOR` → Noto.app (Mac) → system open; soft links `@{T-xxxx}` in body navigate in Stack. holt owns metadata + stack + history.
