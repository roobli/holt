# sample ledger

Clean first-run seed shipped with the repo:

- one task `T-0001` (`doing` / personal)
- matching `history.ndjson` create event

**Do not use `sample/` as a scratch pad for smoke tests.** CLI/GUI acceptance and
automated tests should use a temp directory (`mkdtemp`) or any throwaway path.

If `sample/` gets polluted (extra tasks / history lines from local push):

```sh
git checkout -- sample/
```
