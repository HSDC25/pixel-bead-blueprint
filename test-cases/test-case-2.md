# test-case-2：超大图分块 + 按需出块

> ⚠️ 本文件是**场景剧本**（流程叙事）；验收判据以 `functional.md` 对应条目为准——两边冲突时以 functional.md 为准。

## 场景

用户要拼一张大图（如 256×256 格 = 6.5 万颗豆），需要分天分块施工。
验证分块索引、按需出块、跨块坐标一致性，以及 coaching.md 按块排场次。

## 输入

- `scripts/test/fixtures/tux-large-white_win.png` 加 `--grid 128`（或自备任一大图）

## 步骤

1. `node scripts/run.mjs <图> --grid 128 --split 32 --teach --out out-split`
2. 检查 `blocks-index.json` 与 `sheet-blocks.md`。
3. 按需补块：`node scripts/run.mjs <图> --grid 128 --split 32 --block 3 --out out-split`（同 outDir）。
4. 抽一块核对跨块坐标：块 K 的 `row0/row1/col0/col1` 与 `blueprint-ascii.txt` 对应行列段逐格一致。

## 预期

- `blocks-index.json` 每块含 `beads` 与主色 top3（code/count/hex）。
- `sheet-blocks.md` 表格含：块号 / 文件 / 行范围 / 列范围 / 豆数 / 主色 top3，并给出按需出块命令。
- 步骤 3 后该块目录出现 `block-3.json` + `block-3-ascii.txt` + 对应 sheet 图纸，且**不重渲染其他块**。
- `coaching.md` 的场次表按块划分（范围写「块 1、2、3…」而不是行段）。
- 跨块坐标：全局行列号在块间不重不漏。

## 失败长什么样

- index 里块缺 beads/top 字段（旧版索引）。
- coaching.md 场次写行段而没按块划分（分块信息没接进辅导层）。
