# T3 — audit-workspace: waves/ 与 commits/ 跨根一致性审计（Dsh real-dev evaluation, ticket 3）

## Background (real failure mode)

RSI 编排同时维护两个持久根：`waves/`（编排器记录的每个波次的执行计划/候选，布局 `<wavesRoot>/<wNNN>/<actor>/`）与 `commits/`（提交闸写入的归档，布局 `<commitsRoot>/<wNNN>/<actor>/`，每个提交目录含 `MANIFEST.json`）。两者必须一一对应。

真实教训：原型实验期间，多个任务复用了相同的 wave 编号，候选目录互相覆盖、归档与计划漂移，只能靠人工核对。需要一个机械审计器把这类漂移变成可判定的检查。

## Requirement

新增零依赖 Node 工具 `examples/rsi-prototype/tools/audit-workspace.mjs`：

```
node tools/audit-workspace.mjs --waves <wavesRoot> --commits <commitsRoot> [--json]
```

1. 遍历 `waves/<wNNN>/<actor>/`（wave 目录名必须匹配 `/^w\d+$/`，不匹配忽略并计入 `SKIP` 行）。
2. 对每个计划波次 `wNNN/actor`：
   - `commits/<wNNN>/<actor>/MANIFEST.json` 存在 → `OK <wNNN> <actor>`；
   - 不存在 → `MISSING <wNNN> <actor>`（**exit 1**）。
   - 存在但 `MANIFEST.json` 的 `wave` 字段数值与目录名 `wNNN` 不一致 → `WAVE-MISMATCH <wNNN> <actor> <manifestWave>`（**exit 1**）。
3. `commits/` 侧存在提交（含 MANIFEST）但 `waves/` 无对应波次 → `ORPHAN <wNNN> <actor>`（仅输出行，**不改 exit code**）。
4. 全绿 = 无 MISSING/WAVE-MISMATCH → exit 0。
5. `--json`：stdout 仅输出 `[{kind, wave, actor, extra?}]`（`kind` ∈ OK|MISSING|WAVE-MISMATCH|ORPHAN|SKIP）；行按 `(wave 数值, actor)` 排序。
6. 缺 `--waves` 或 `--commits` → usage 错误 stderr、**exit 2**。

约束：Node 内置模块；不动任何现有文件；smoke 全绿。

## Acceptance (public suite)

`tools/check-audit-workspace.mjs`（8 断言）：

```
node tools/check-audit-workspace.mjs  # CHECK-AUDIT-WORKSPACE OK
node tools/smoke.mjs                  # SMOKE OK
```