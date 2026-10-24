# 功能性测试用例

> **分层分工（单一写方约定，2026-10-25）**：本文件 = **机器可执行的验收判据**，供仓库智能检视流水线（hmos-skill-test-runner）及人工验证共用；`test-case-1..5.md` = **叙述式场景剧本**（给 agent/人工演示流程用，其「预期」段只是剧情摘要）。**两者冲突时以本文件为准**——验收判据只在这里维护一份。
> 执行时只提交每条「输入」，不传入「预期输出」。所有命令在技能包根目录执行（CLI 入口 = `scripts/run.mjs`）。
> 样张：`scripts/test/fixtures/` 随包分发 3 张；文中引用 `greatwave-hokusai-1831.jpg` 等未随包样张时，可用任一同名图片替代。

---

### 测试用例：FUNC-A-001

**skill**：pixel-bead-blueprint
**类型**：functional（功能验证）

#### 输入

把这张照片做成拼豆图纸（附一张主体清晰的照片，如 `scripts/test/fixtures/tux-large-white_win.png`），网格用 64。

#### 预期输出

**验证标准**：

- 先看构图/主体再决定参数，给出网格档理由（不是直接跑默认值）；随后执行 `node scripts/run.mjs <图> --grid 64`。
- 输出目录（默认 `./pixel-bead-output/<图名>-g64/`，网格 ≤200 万格时）至少含 9 件：`blueprint.png`、`blueprint.json`、`blueprint-ascii.txt`、`blueprint.md`、`sheet.png`、`compare.png`、**`review.png`（红框终审图）**、**`refine.md` + `review.md`（迭代报告 + 逐框判定表）**。
- `blueprint.md` 含色号表（色号/HEX/颗数/占比/采购包数）与处理报告；回答中按「功能名 + 现象」讲清交付物怎么用。
- 不声称支持 16-bit/隔行 PNG；遇到 progressive JPEG 走自动转码并在日志中说明。

---

### 测试用例：FUNC-B-001

**skill**：pixel-bead-blueprint
**类型**：functional（功能验证）

#### 输入

这是我拼好的成品图（附网格成品照，如 `scripts/test/fixtures/mondrian-1930-cii_win.png`），提取一下用了哪些色号；然后只用这些色号给我出一张新图纸。

#### 预期输出

**验证标准**：

- 第一步执行 `--scan inventory.json`：打印匹配表（取样 RGB / 色号 / HEX / ΔE / 置信度），低置信（ΔE>12）**拒绝静默入库**并提示确认；库存 JSON 含 codes/legend/grid。
- 第二步执行 `--inventory inventory.json [--limit-palette] --grid N`；`blueprint.md` 出现「库存覆盖与缺色」段（覆盖率 + 缺色就近替换 ΔE）。
- 普通照片被门禁拒绝时，明确提示改走工作流 A，而不是硬扫。

---

### 测试用例：FUNC-TEACH-001

**skill**：pixel-bead-blueprint
**类型**：functional（功能验证）

#### 输入

我想学着拼这个（附照片），教我怎么安排，别一次给太多。

#### 预期输出

**验证标准**：

- 走六步辅导环：**先问学员**（经验/单次时长/辨色/库存）再出图，不直接甩图纸。
- 执行 `--analyze` 并引用特征（如 edgeDensity / subject.ratio）解释参数选择，回答必须含「为什么」。
- 执行 `--teach` 后输出 `coaching.md`，含难度评定（附理由）、工时与场次、每场校验点、该图专属易错点、打卡清单。
- 讲解挑 2~3 条与本图相关的易错点，不整份文档照念。

---

### 测试用例：FUNC-MATRIX-001

**skill**：pixel-bead-blueprint
**类型**：functional（功能验证）

#### 输入

我不确定哪种效果好，帮我把几种参数都试一下再选。

#### 预期输出

**验证标准**：

- 执行 `node scripts/run.mjs <图> --grid N --compare-matrix`；输出 `compare-matrix.png`（2×N 拼图，带方案名标签）、`matrix.md`（用色/颗数/孤点率/平坦翻转率/复跑命令）、`matrix.json`。
- 选版依据是**看图 + 指标**，并说明取舍（细节保真 vs 采购压力 vs 纹理风格），不按单一分数自动选。
- 选定后给出对应复跑命令（如 `--dither fs` / `--outline 1` / `--maxcolors 24`）。
