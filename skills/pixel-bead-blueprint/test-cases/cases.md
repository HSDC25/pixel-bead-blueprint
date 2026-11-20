# 测试用例合集 — pixel-bead-blueprint

> 本文件合并了原先的 `functional.md` + `test-case-1..5.md` + `test-prompts.md`（v1.4.0 收口，为满足「单次 ≤30 文件」配额）。
> **分层分工（单一写方约定）**：
> - **第一部分 = 机器可执行的验收判据**，供仓库智能检视流水线（hmos-skill-test-runner）与人工验证共用 —— 冲突时一律以本部分为准。
> - **第二部分 = 叙述式场景剧本**，给 agent / 人工演示流程用，其「预期」段只是剧情摘要。
>
> 执行时只提交每条「输入」，不传入「预期输出」。所有命令在技能包根目录执行（CLI 入口 = `scripts/run.js`）。
> 功能性用例仅使用随包样张，无需自备图片；场景剧本中标注「自备」的输入请按需准备。

---

# 第一部分 · 机器可执行验收判据（functional）

### 测试用例：FUNC-A-001

**skill**：pixel-bead-blueprint
**类型**：functional（功能验证）

#### 输入

把这张照片做成拼豆图纸（附一张主体清晰的照片，自备即可），网格用 64。

#### 预期输出

**验证标准**：

- 先看构图/主体再决定参数，给出网格档理由（不是直接跑默认值）；随后执行 `node scripts/run.js <图> --grid 64`。
- 输出目录（默认 `./pixel-bead-output/<图名>-g64/`，网格 ≤200 万格时）至少含 9 件：`blueprint.png`、`blueprint.json`、`blueprint-ascii.txt`、`blueprint.md`、`sheet.png`、`compare.png`、**`review.png`（红框终审图）**、**`refine.md` + `review.md`（迭代报告 + 逐框判定表）**。
- `blueprint.md` 含色号表（色号/HEX/颗数/占比/采购包数）与处理报告；回答中按「功能名 + 现象」讲清交付物怎么用。
- 不声称支持 16-bit/隔行 PNG；遇到 progressive JPEG 走自动转码并在日志中说明。

---

### 测试用例：FUNC-B-001

**skill**：pixel-bead-blueprint
**类型**：functional（功能验证）

#### 输入

这是我拼好的成品图（附网格成品照，自备即可），提取一下用了哪些色号；然后只用这些色号给我出一张新图纸。

#### 预期输出

**验证标准**：

- 第一步执行 `--scan inventory.json`：门禁放行（低色数插画/稀疏点状分支，unique=6, flatRatio=1.00）；差分网格检出 39×48；6 个色桶全部 high 置信（ΔE=0：E16/H7/G6/A26/G10/H3）；inventory.json 含 codes/legend/grid。
- 第二步执行 `--inventory inventory.json --limit-palette --grid N`：blueprint.md 出现「库存覆盖与缺色」段（覆盖率 + 缺色就近替换 ΔE）。
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

- 执行 `node scripts/run.js <图> --grid N --compare-matrix`；输出 `compare-matrix.png`（2×N 拼图，带方案名标签）、`matrix.md`（用色/颗数/孤点率/平坦翻转率/复跑命令）、`matrix.json`。
- 选版依据是**看图 + 指标**，并说明取舍（细节保真 vs 采购压力 vs 纹理风格），不按单一分数自动选。
- 选定后给出对应复跑命令（如 `--dither fs` / `--outline 1` / `--maxcolors 24`）。

---

# 第二部分 · 场景剧本（演示用，判据见第一部分）

## 场景 1：工作流 A 全流程 + AI 辅导（教我拼）

### 场景

新手用户发来一张照片说「教我拼拼豆」。验证 agent 走完六步辅导环：先问学员再开工、特征分析出参数（说理由）、生成图纸 + coaching.md、给学员讲解（不念文档）、按场次推进。

### 输入

- 任一主体清晰的照片（自备即可）
- 学员画像未知（agent 应先问）

### 步骤

1. agent 不出图，先用 coaching 口径的问题了解学员（经验/时长/辨色/库存）。
2. agent 跑 `node scripts/run.js <图> --analyze`，结合看图给出网格档与参数，**回答里必须含理由**。
3. agent 跑 `node scripts/run.js <图> --grid N --teach --out <目录>`。
4. agent 挑 2~3 条该图专属易错点讲解，并带学员读 sheet.png 的行列号与色号表。

### 预期

- 第 1 步发生在任何参数决定之前（顺序错了即失败）。
- 第 2 步 stdout 是纯 JSON；agent 的参数建议能同时引用视觉观察与特征数值。
- 落盘五件套：`blueprint.png` / `blueprint.json` / `blueprint-ascii.txt`（≤512 短边时）/ `blueprint.md` / `compare.png` + **`coaching.md`**。
- `coaching.md` 含：难度档位（附理由）、工时与场次表、场次校验点、专属易错点、开场问题、反馈思路、打卡清单。
- agent 的讲解不是整份 coaching.md 照念。

### 失败长什么样

- agent 上来就出图、不问学员 → 辅导环没走。
- 参数建议只有数字没有理由 → 查表式决策（辅导红线）。
- 输出目录里没有 coaching.md（忘加 `--teach`）。

---

## 场景 2：超大图分块 + 按需出块

### 场景

用户要拼一张大图（如 256×256 格 = 6.5 万颗豆），需要分天分块施工。验证分块索引、按需出块、跨块坐标一致性，以及 coaching.md 按块排场次。

### 输入

- 任一分辨率较大的照片（自备，建议 1280×1600 以上）加 `--grid 128`

### 步骤

1. `node scripts/run.js <图> --grid 128 --split 32 --teach --out out-split`
2. 检查 `blocks-index.json` 与 `sheet-blocks.md`。
3. 按需补块：`node scripts/run.js <图> --grid 128 --split 32 --block 3 --out out-split`（同 outDir）。
4. 抽一块核对跨块坐标：块 K 的 `row0/row1/col0/col1` 与 `blueprint-ascii.txt` 对应行列段逐格一致。

### 预期

- `blocks-index.json` 每块含 `beads` 与主色 top3（code/count/hex）。
- `sheet-blocks.md` 表格含：块号 / 文件 / 行范围 / 列范围 / 豆数 / 主色 top3，并给出按需出块命令。
- 步骤 3 后该块目录出现 `block-3.json` + `block-3-ascii.txt` + 对应 sheet 图纸，且**不重渲染其他块**。
- `coaching.md` 的场次表按块划分（范围写「块 1、2、3…」而不是行段）。
- 跨块坐标：全局行列号在块间不重不漏。

### 失败长什么样

- index 里块缺 beads/top 字段（旧版索引）。
- coaching.md 场次写行段而没按块划分（分块信息没接进辅导层）。

---

## 场景 3：工作流 B 库存闭环（成品照 → 库存 → 限定生成 → 缺色）

### 场景

用户手里有一批豆，拍了一张排好的成品照/色卡照，想「只用我有的颜色」生成新图纸。

### 输入

- 网格成品图：`scripts/test/fixtures/mondrian-1930-cii-original.jpg`（`scripts/test/run.js` 的投影网格检测即用此样张；或自备带间隙的色卡截图）
- 派生库存：第一步 `--scan` 的输出 JSON

### 步骤

1. `node scripts/run.js scripts/test/fixtures/mondrian-1930-cii-original.jpg --scan inventory.json`
2. 用一张新照片限定生成：`node scripts/run.js <照片> --inventory inventory.json --grid 64 --out out-b`
3. 再加 `--limit-palette` 跑一版：`--inventory inventory.json --limit-palette --grid 64 --out out-b-limited`
4. 对比两版 `blueprint.md` 的「库存覆盖与缺色」段。

### 预期

- 步骤 1 打印匹配表（取样 RGB / 色号 / HEX / ΔE / 置信度）并写 `inventory.json`（含 codes/legend/grid.mode）。
- 色卡截图带间隙时，日志出现「投影检出」（`grid.mode='projection'`）而不是网格检测失败。
- 步骤 2/3 的 `blueprint.md` 有缺色表：缺色号 / HEX / 需补颗数 / 最接近库存色 / ΔE。
- `--limit-palette` 版缺色为 0（全部落在库存内），未限定版如实列出缺口。

### 失败长什么样

- 传普通照片却扫出库存（门禁没拦，工作流 B 结构性拒绝失效）。
- 低置信色号被静默写入库存（必须先拒并提示 `--accept-low-confidence`）。
- 带间隙色卡直接报「网格检测失败」（投影检测未生效）。

---

## 场景 4：大模型推理回调（--analyze + compare.png 参数对比）

### 场景

用户对出图结果不满意（「太抽象了」/「杂色多」），验证 agent 用特征数据 + compare.png 做有理由的参数回调，而不是猜参数。

### 输入

- 任一照片（建议含渐变或细节区，如风景）

### 步骤

1. 首轮出图：`node scripts/run.js <图> --grid 64 --out out-r1`，看 CLI 孤点诊断与 compare.png。
2. 用户反馈「不像」→ agent 重跑 `--analyze`，对比特征与首轮参数，给出新参数（如 `--grid 128`）并**说明理由**。
3. 二轮出图后并排对比两版 `compare.png`，向用户展示差异并让用户选择。

### 预期

- agent 能区分两类根因并说对解法：**整体抽象 = 网格档不够**（加大 --grid，不动色）；**个别颜色错 = 行内错位**（用 ASCII 矩阵逐行核，不动档位）。
- 照片场景 agent **不**主动开 `--dither fs`（实测增噪），除非用户点名要渐变纹理。
- 回调后的 compare.png 差异被具体描述（「浪的形态出来了」），不是「更好了」。

### 失败长什么样

- 反馈后 agent 直接换随机参数重跑（没看 compare/特征）。
- 把「抽象」归因到色数并压 `--maxcolors`（方向错误，细节由网格决定）。

---

## 场景 5：输入格式兼容（progressive JPEG / EXIF 竖图 / 透明底）

### 场景

用户从网上下载图片（常是 progressive JPEG）、用手机竖拍（EXIF Orientation=6）、或想拼透明底挂件。验证三条兼容路径。

### 输入

- `scripts/test/fixtures/progressive-mondrian.jpg`（progressive JPEG 样张）
- 任一 EXIF=6 的竖拍 JPEG（可用带 EXIF 的手机照片）
- 任一透明底 PNG（自备；管线完整消费 alpha，透明格 = 不放豆）

### 步骤

1. progressive：`node scripts/run.js scripts/test/fixtures/progressive-mondrian.jpg --grid 48 --out out-fmt` —— 观察日志出现「progressive JPEG：已用 <工具> 转 PNG 再解码」。
2. EXIF：直接喂竖拍原图 —— 日志出现「EXIF 方向 6：已按元数据转正」，产物为竖版（宽 < 高）。
3. 透明底：喂透明 PNG —— `blueprint.json` 出现 -1、`blueprint-ascii.txt` 空位为 `...`、`blueprint.png` 透明区 alpha=0，色号表没有「背景色」豆。

### 预期

- 三条路径都产出完整五件套，不抛「不支持 progressive」旧错误。
- 机器无任何转换器时，progressive 分支报**可读错误**（列出尝试过的工具与手工转格式建议），不是堆栈。
- 透明语义 = 空位（留孔不填豆），不是填白/填黑。

### 失败长什么样

- progressive 图直接被拒（转码链没生效）或转码后方向歪了（EXIF 没从原 JPEG 补回）。
- 透明区出现大量白豆/黑豆（alpha 语义回归）。

---

# 第三部分 · 可直接粘贴的触发语

| # | 触发语（粘给 agent） | 预期走的路径 | 对应剧本 |
|---|---|---|---|
| 1 | 「教我拼拼豆，用这张照片」（附任意照片） | 六步辅导环全流程（工作流 A + --teach） | 场景 1 |
| 2 | 「这张图太大了，帮我切成能分天拼的图纸」（附大图） | 工作流 A + --split/--block + 分块场次 | 场景 2 |
| 3 | 「识别一下这张成品用了哪些色号，之后只用我有的颜色拼」（附成品照） | 工作流 B：--scan → --inventory | 场景 3 |
| 4 | 「这两个参数哪版好？帮我看着调」（附同一张图） | 大模型推理环：--analyze + compare.png 对比回调 | 场景 4 |
| 5 | 「这张手机拍的竖图/网上下的图能拼吗」（附 progressive JPEG 或带 EXIF 图） | 格式兼容：自动转码 + EXIF 转正 | 场景 5 |

## 一键自检命令（不依赖 agent，先验管线本体；在包根目录执行）

```bash
node --test scripts/test/run.js    # 全量 57 项（2026-11-21 复跑实测：tests 57 / pass 57 / fail 0，约 18s）
```