# BENCHMARK — pixel-bead-blueprint

> 生成：`node evals/run-evals.cjs` ｜ 时间：2026-11-20T17:03:29.742Z ｜ 版本：v1.5.0
> 结果：**6/6 cli 用例 PASS**，2 项人工验收（manual），耗时 7.7s

| 用例 | 类型 | 结果 | 覆盖 |
|---|---|---|---|
| EVAL-A-001 | cli | PASS | 工作流 A：一张图 → 完整交付物（含终审图、迭代报告、辅导计划） |
| EVAL-TEACH-001 | cli | PASS | 辅导计划落盘：coaching.md 必含难度评定 / 场次 / 校验点 |
| EVAL-MATRIX-001 | cli | PASS | 一条命令跑多方案 → 对照图 + 指标表，供 AI 选版 |
| EVAL-FMT-001 | cli | PASS | 格式兼容：progressive JPEG 自动转码不报错，正常出图 |
| EVAL-SPLIT-001 | cli | PASS | 分块索引 + 逐块按需出图：跨块行列号全局连续 |
| EVAL-GATE-001 | cli | PASS | 交付门禁双向：空判定表 exit 3，填完并签署 exit 0 |
| EVAL-B-001 | manual | MANUAL | 库存闭环：--scan 成品照 → inventory.json → --limit-palette 只用手里的色号 |
| EVAL-AGENT-001 | manual | MANUAL | 辅导环行为：先问学员再出图；参数决策必须给理由；反馈后按根因回调而不是随机换参 |

## 说明

- 只判定 **CLI 可机器判定的部分**：退出码、交付物清单、文本/JSON 字段、门禁双向、分块索引完整性与行列覆盖。
- `kind=manual` 属大模型在环行为（先问学员、参数给理由），需评审按 `test-cases/cases.md` 人工打勾。
- 评测不改包内文件：产物写在系统临时目录，跑完即弃。
