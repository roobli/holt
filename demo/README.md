# holt Stack demo (v1.1) — mock only

Clickable prototype of the Stack primary view. In-memory store; optional `localStorage` persistence. Does **not** write real task `.md` files.

For the **file-backed** Stack GUI (same semantics as the CLI), use:

```sh
pnpm gui:dev
```

See [gui/README.md](../gui/README.md) and the root README. Do not expand this demo further.

## Run locally (mock)

From repo root:

```sh
pnpm install
pnpm demo:dev
```

Open the URL Vite prints (default `http://localhost:5173`).

Build static assets:

```sh
pnpm demo:build
```

Output: `demo/dist/`.

## What works

- Empty stack + quiet CTA
- Push to top / push to bottom
- Select card → detail panel (status/lane editable; estimate & hooks read-only)
- Lane filter (All / personal / work / openjobs)
- Reorder via drag (primary); ↑ / ↓ on hover or keyboard arrows when focused
- Block height from `estimate_min`, capped 48–120px
- Brand: **holt**

## Stubbed

- Timeline view (disabled)
- “在本机打开正文 / Noto” (toast only)
- No real ledger / history.ndjson I/O
- File-backed ledger I/O lives in CLI + local GUI (`pnpm gui:dev`)

## GitHub Pages

If enabled on the repo, the demo may be served from project Pages after a `demo/dist` deploy. See root README.
