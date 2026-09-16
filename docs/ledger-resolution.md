# Default ledger resolution

CLI and local GUI share the same default ledger rules (and the same `lastLedger` preference).

## Order

1. **Explicit path** — CLI `[ledger]` positional, or `pnpm gui:dev <path>`
2. **`HOLT_LEDGER`** environment variable (non-empty)
3. **Shared config** `lastLedger` — `~/.config/holt/config.json`  
   (reads legacy `~/.config/holt/gui.json` if `config.json` has no `lastLedger`)  
   Honors `XDG_CONFIG_HOME` when set.
4. **Fallback** `./sample` (GUI uses the repo `sample/` directory when launched from the package)

## Sync

After a successful CLI command that used an **explicit** ledger path (`list` / `push` / `update` / `reorder` / `history` / `open-body` / `inspect` / `complete-project` / `ensure-ledger`), holt writes that absolute path to `lastLedger` — same as opening a ledger in the GUI — so the other surface picks it up when env is unset.

Env-only or config-only resolves do **not** rewrite `lastLedger`.
