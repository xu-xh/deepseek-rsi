# RSI-on-DSH 增益验证 — 总报告（三池证据全景）

本文件汇总"把 RSIAgent 的 RSI 机制搬到 DeepSeek Harness 是否带来增益"这一问题的全部实验证据与结论。全部判分命令可在 CI（rsi-prototype.yml smoke）与本地复现。

## 1. 问题与方法

**问题**：在 DSH 上以 workflow 工具实现 RSI 三层（Curriculum / Actor / Verifier）+ 持久记忆 + 验证后提交，相比"单智能体 + 自测打磨"的严格 baseline，是否产生可测增量？

**方法**（贯穿全部实验）：
- 同预算严格对照：baseline = 单 agent（写→shell 自测→修订 ≤5 轮，无记忆/无外部验证）；RSI 臂 = actor/verifier/curriculum 多波次（每波动词多花 3-4× LLM 调用）。
- 机械判分器：同一命令行在两个 arm 上运行，判分过程无模型参与；RSI 的 verifier 独立于 actor（看不到实现过程）。
- 任务分三个池子，覆盖不同缺陷性质；每个结果如实记录（含阴性）。
- 判分器自检：正确实现满分 + 缺陷实现低分双断言（16 项），CI 强制。

## 2. 三池证据

### 池 A：加压任务（人造多文件一致性 / 真实数据流 / 编码边缘）
| 任务 | baseline | RSI | 属性 |
|---|---|---|---|
| trio（跨文件一致性） | 3/6 | 6/6 | 机制级增益（隔离验证修复一致性缺陷类） |
| chain（真实数据流：上游变异后 token 必须仍然贯通） | 4/5 | 6/6 | 同上 |
| validate（编码边缘） | 6/6 | 6/6 | 无差异 |

（n=1；各任务分数=判分器检测点命中数。）

### 池 B：自然缺陷池（原型真实运行中发生的 5 个缺陷，有运行记录佐证）
cli-forms / loop-terminate / home-fallback / write-once / tdz-fix：baseline 22/22 满分。
**结论：清单可自查类缺陷两 arm 均覆盖——本池无区分度**，转为保底回归集（两臂都不该翻车）。

### 池 C：真实开发任务（真实代码库 + 真实功能票 + 公开验收测试，从零实现）
| 任务 | baseline | RSI | 机制贡献 |
|---|---|---|---|
| T1 commit-memory `--mode list`（需求-现实一致性缺陷） | 验收全绿；**真实产物探针 FAIL**（自测假设失效，交付在真实数据上列错 actor） | 验收全绿；真实产物探针 PASS；verifier PASS 90/100 抓到 contract-现实脱节 → **wave2 修复** | ✅ 明确（独立验证者 + 修订波次） |
| T2 verify 审计垃圾文件（直观可自查） | 验收全绿 | 验收全绿；verifier PASS 95/100 无实质发现 | 无 |
| T3 跨根一致性审计（可自查完整契约） | 验收全绿 | 验收全绿；verifier PASS 97/100，实现为 baseline 行为超集 | 无实质增量 |

## 3. 结论（机制级，诚实版）

1. **机制级证据成立**：RSI 的独立验证者 + 修订波次，在"验收测试覆盖不到的真实缺口"（T1 的 wave-first 布局、trio/chain 的跨文件真实约束）上发现了单智能体自测无法发现的缺陷并驱动修复。跨池模式一致：贡献稳定集中于**隐藏一致性缺陷**类。
2. **系统级增益未证明**：全部主验收（三任务 + 自然缺陷池）两 arm 平局；唯一胜出维度是判分者事后加的质量探针；n 小（2-3 任务 × 1 轮），成本不对称（RSI 4× LLM 调用/任务）。
3. **可复现的边界**：任务若"验收覆盖=现实"，两 arm 等价；任务若存在"测试与现实数据布局/约束脱节"，RSI 机制有实打实的发现价值。

## 4. 已回收产出（feat/rsi-w1-prototype，全部 CI 绿）

- `853e553`→`ce2ee84` T1：commit-memory `--mode list`（双布局审计）+ 验收套件
- `8f1c05b`→`f61c642` T2：verify-read/run 零审计副作用 + 验收套件
- `5a6bcfc`→`fb538e9` T3：audit-workspace 跨根一致性审计 + 验收套件
- bench 框架：11 任务统一判分 CLI + 正/负样本双向 selfcheck（CI 强制 16 断言）
- smoke 现含 T1/T2/T3 验收 + 全量回归；CI 双 node（22/24）全绿记录见各提交上 GH Actions

## 5. 下一步（未执行，按需）

- 只加"隐藏一致性"类 T4+（每加一个"可自查"任务只多一份平局）；
- 同任务池多轮重复（≥3）把"机制级"推进到统计稳健；
- 把 `--audit` 尾值边缘（本次实验唯一残留的真实缺陷，verifier 已定位）做成票。

## 附录：复现命令

```sh
# 判分器自检（116 断言，含正/负样本）
node bench/selfcheck.mjs
# 全套回归门（含三任务验收）
node tools/smoke.mjs
# 单任务判分示例
node bench/grade.mjs --task trio --candidate <dir>
node bench/grade.mjs --task cli-forms --candidate <dir>
# 评估分支（完整 wave 历史）
git branch | grep eval-t
```