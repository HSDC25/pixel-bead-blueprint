# test-case-1：工作流 A 全流程 + AI 辅导（教我拼）

> ⚠️ 本文件是**场景剧本**（流程叙事）；验收判据以 `functional.md` 对应条目为准——两边冲突时以 functional.md 为准。

## 场景

新手用户发来一张照片说「教我拼拼豆」。验证 agent 走完六步辅导环：先问学员再开工、
特征分析出参数（说理由）、生成图纸 + coaching.md、给学员讲解（不念文档）、按场次推进。

## 输入

- 任一主体清晰的照片（包内可用 `scripts/test/fixtures/tux-large-white_win.png` 模拟；或自备任意照片）
- 学员画像未知（agent 应先问）

## 步骤

1. agent 不出图，先用 coaching 口径的问题了解学员（经验/时长/辨色/库存）。
2. agent 跑 `node scripts/run.mjs <图> --analyze`，结合看图给出网格档与参数，**回答里必须含理由**。
3. agent 跑 `node scripts/run.mjs <图> --grid N --teach --out <目录>`。
4. agent 挑 2~3 条该图专属易错点讲解，并带学员读 sheet.png 的行列号与色号表。

## 预期

- 第 1 步发生在任何参数决定之前（顺序错了即失败）。
- 第 2 步 stdout 是纯 JSON；agent 的参数建议能同时引用视觉观察与特征数值。
- 落盘五件套：`blueprint.png` / `blueprint.json` / `blueprint-ascii.txt`（≤512 短边时）/ `blueprint.md` / `compare.png` + **`coaching.md`**。
- `coaching.md` 含：难度档位（附理由）、工时与场次表、场次校验点、专属易错点、开场问题、反馈思路、打卡清单。
- agent 的讲解不是整份 coaching.md 照念。

## 失败长什么样

- agent 上来就出图、不问学员 → 辅导环没走。
- 参数建议只有数字没有理由 → 查表式决策（辅导红线）。
- 输出目录里没有 coaching.md（忘加 `--teach`）。
