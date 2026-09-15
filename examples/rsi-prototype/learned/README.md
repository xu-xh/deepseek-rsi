# learned/ — 学习成果落库（经过了验证边界的记忆回注）

过去多次真实闭环中**通过隔离验证、机械判分满分、并已提交**（`commit-memory` 的
`tree matches manifest`）的实现，按任务归档于此。它们是"memory changes only at
verified boundaries"的仓库级体现：落库的唯一门槛是验证通过。

| 目录 | 来源 | 已验证成绩 | 机械门 |
|---|---|---|---|
| `http-echo/` | RSI 波次 w001/a02（证据最全：错误方法 404、200KB body、verbatim 回显均实测） | PASS 100，判分 **4/4** | `bench/grade.mjs --task http-echo` |
| `parser/` | 对照实验 baseline（单次成型） | 判分 **6/6** | `bench/grade.mjs --task parser` |
| `stats/` | 对照实验 baseline（单次成型） | 判分 **6/6** | `bench/grade.mjs --task stats` |

`tools/smoke.mjs` 每次运行都会用同一判分器复判三件套，保证落库资产长期为满分
（任何回退都会让 CI 变红）。

## 如何作为种子记忆回注一次运行

新实验若想"站在前人的肩膀上"，在 workflow 调用里把 `args.memoryDir` 指向本目录
（或拷贝一份到 `rsi-workspace/memory/`）：actor 的提示词已经说明"Shared read-only
seed memory (optional, list first)"，它们会在下一轮波次中作为只读种子被引用。

## 与 rsi-workspace/ 的分工

- `rsi-workspace/`（gitignored）：每次实验的原始候选、提交日志、审计——过程性事实；
- `learned/`（git 跟踪）：经过验证的好实现——**结论性记忆**。实验产物可择优回注
  到这里，形成"学习 → 验证 → 落库 → 复用"闭环。