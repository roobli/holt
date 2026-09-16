# holt

**holt：vault 旁的本地任务账本，不是网站。**

Source of truth = `tasks/*.md` + `history.ndjson` on disk. CLI and Stack GUI share the same commands. github.io is a mock demo only.

---

## 最短日常用法

### 安装

```sh
git clone https://github.com/roobli/holt.git && cd holt
pnpm install
```

（需要 Node 22+。）可选：`pnpm link --global` 后直接用 `holt …`。

### 默认 ledger

解析顺序（CLI 与 GUI 相同）：

1. 命令里显式路径  
2. 环境变量 `HOLT_LEDGER`  
3. `~/.config/holt/config.json` 的 `lastLedger`  
4. 回退 `./sample`

显式打开过的路径会写回 `lastLedger`，两边共用。细节：[docs/ledger-resolution.md](docs/ledger-resolution.md)。

### 每天三行 · CLI

```sh
pnpm holt list
pnpm holt push --title "写日报" --lane work --estimate 45m --top
pnpm holt update T-0001 --status doing
```

### 每天三行 · GUI

```sh
pnpm gui:dev
# 浏览器打开终端里打印的地址（默认 http://127.0.0.1:5174）
# 另一终端改文件会热刷：pnpm holt push --title "from CLI" --lane personal --top
```

### 完成整个 project 一例

```sh
pnpm holt push --title "A" --lane work --project holt-mvp --estimate 2h --top
pnpm holt push --title "B" --lane work --project holt-mvp --estimate 1d --top
# 若 B 依赖 A：先 --blocked-by <A的id>，必须先把 A done，否则 complete 整批拒绝
pnpm holt list --project holt-mvp
pnpm holt complete-project holt-mvp
```

GUI：左侧 Projects 过滤 → 打开某条 Detail →「完成整个 project」（同语义、全有或全无）。

### 再建一个自己的账本

```sh
pnpm holt ensure-ledger ~/notes/holt-ledger
pnpm holt list ~/notes/holt-ledger
pnpm gui:dev ~/notes/holt-ledger
```

---

## 常用命令速查

```sh
pnpm holt list [--project <slug>] [--json]
pnpm holt push --title <t> --lane <lane> [--estimate 45m|2h|1d] [--project <slug>] [--top|--bottom]
pnpm holt update <id> [--status …] [--estimate …] [--project …] [--blocked-by …]
pnpm holt reorder <id> --to <stack_order>
pnpm holt history [--task <id>] [--json]
pnpm holt open-body <id>                 # $EDITOR / 系统打开 md
pnpm holt inspect [--json]
pnpm holt complete-project <slug>
```

估时：`45m` / `2h` / `1d`（**1d = 8h**）或纯分钟数；双写 `estimate_min`。有 `blocked_by` 时标 `done` 会被人话拒绝。

## 文件布局

```
<ledger>/
  tasks/T-0001.md
  history.ndjson
```

见 [docs/file-model.md](docs/file-model.md)。

## 表面对照

| 表面 | 真相 | 怎么开 |
| --- | --- | --- |
| CLI | 本机 ledger | `pnpm holt …` |
| Local GUI | 同一 ledger | `pnpm gui:dev` |
| github.io | 内存 mock | 仅演示，不当产品 |

更多：[gui/README.md](gui/README.md) · mock：[demo/README.md](demo/README.md)

## Develop

```sh
pnpm test
pnpm typecheck
```

## License

MIT
