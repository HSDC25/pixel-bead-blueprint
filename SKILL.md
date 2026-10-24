---
name: pixel-bead-blueprint
description: >-
  AI 拼豆辅导 skill（赛题二·内容创作·个人表达）。把用户照片、手绘、AI 灵感图转成可执行的拼豆图纸（色号表 + 施工图纸 +
  ASCII 矩阵 + 采购清单 + 分块索引），并以拼豆老师身份完成全流程辅导：难度评定、工时场次、陪拼验收、完工复盘、库存回收闭环。
  支持库存限定（从拼豆成品照/色卡截图自动提取色号，只用手里的豆子生成图纸）。内置 MARD 221/291、Perler、Artkal 色盘。
  Use when the user wants to generate a pixel/bead pattern from a photo, identify bead color codes from a finished piece,
  limit a design to the beads they already own, or get step-by-step bead-craft tutoring (analyze image features, generate
  blueprints, compare variants, teach and verify progress).
  触发词：教我拼拼豆、陪我拼、拼豆老师、拼豆图纸、像素画图纸、色号表、拼豆采购清单、识别成品色号、用我有的颜色生成、缺哪些色。
---

# AI 拼豆辅导 Skill（pixel-bead-blueprint）

> 赛道：通用赛道 · 赛题二 · 内容创作（个人表达 + 图片创意）
> 一句话：上传任意图片 → AI 老师给「一份能拼的图纸」并**陪学员拼完**。AI 文生图给的是「一张像像素画的图」；离线 APP 给的是「图纸文件」；本 skill 给的是**图纸 + 因人而异的教学计划 + 施工期 AI 陪拼 + 完工复盘与库存闭环**。
> **agent 必读辅导协议**：references/ai-tutor-protocol.md （六步辅导环 + 禁区红线）。

## 触发词

- "教我拼拼豆" / "陪我拼" / "当我的拼豆老师"（完整六步辅导环）
- "把这张照片变成拼豆图纸" / "生成像素画图纸"（工作流 A）
- "拼豆色号表" / "像素画采购清单"
- "识别一下这张成品/色卡用了哪些色号"（工作流 B）
- "只用我手里有的颜色生成图纸" / "我缺哪些色、要补买多少"（工作流 B）

## 输入

- 图片（照片 / 手绘 / 截图 / AI 生成图——AI 图是合法上游灵感输入，本 skill 负责把它变成可执行图纸）
- **格式支持（2026-10-22）**：JPEG baseline（420/422/444/灰度，EXIF Orientation 1~8 自动转正）/ **progressive JPEG（SOF2 自动转码，见「格式兼容」）** / PNG 8-bit（RGBA/RGB/灰度/调色板）。**不支持**：16-bit PNG、隔行 PNG——抛可读错误。
- 拼豆成品照 / 像素画作品图 / 拼豆图纸 / **紧贴或带间隙的**色卡截图（工作流 B；普通照片被门禁拒绝并提示改走工作流 A）
- 想拼纯主体形状（如「猫形挂件」）：请用户提供**透明背景 PNG**；管线完整消费 alpha——透明格 = 不放豆
- **主体太小** → 先 `--crop x,y,w,h` 裁到主体再生成（900×700 狗脸 96 档只剩 ~9×9 格）

## AI 辅导定位（本 skill 与离线生成的本质区别）

```text
AI 文生图      → 一张「像像素画的图」（拼不了）
离线 APP      → 固定算法 + 图纸文件（用户自己琢磨）
本 skill      → 特征分析 + 视觉推理出参数 + 图纸 + 教学计划 + AI 陪拼 + 复盘回收 ↺
```

**六步辅导环**（详细规程见 references/ai-tutor-protocol.md ）：

1. **了解学员**：经验档位 / 单次时长 / 辨色困扰 / 库存——先问再开工，档位不符主动建议降网格并讲理由。
2. **看图 + 特征分析**：视觉理解构图与必保细节（机器测不出）× `--analyze` 特征 JSON（机器测得准），推理决策、**禁查表**。
3. **生成图纸 + 辅导计划**：`--teach` 落盘 `coaching.md`（难度评定 / 工时场次 / 每场校验点 / 该图专属易错点）。
4. **讲解互动**：带学员读图纸、讲管线决策（处理报告回显翻译成人话）、两版 compare.png 对比让学员参与决策。
5. **施工期陪拼**：按 coaching.md 场次推进，每场验收（ASCII 矩阵逐行核 / 分块对块）；反馈走应对思路（先分类根因再动手）。
6. **完工复盘 + 库存回收**：对照 compare.png 复盘 → 成品照 `--scan` 回补库存 → 下次难度递进建议。

**辅导质量红线**：不静态映射参数；不整份念 coaching.md；参数决策必须答得出「为什么」。

## 可选参数（与 CLI 一一对应；默认值以本表为准）

| 参数 | CLI | 范围 | 默认 | 作用 |
|---|---|---|---|---|
| 网格数 | `--grid N` | 8~8192 | 64 | 细节保留率（64 格约 8%，128 约 12%，256 约 17%）；>512 为超大档 |
| 色盘 | `--palette <别名\|json>` | mard(221) / mard291 / perler(118) / artkal-c197 / artkal-m221 / 同 schema 自定义 JSON | MARD 221 | 色号体系；Perler/Artkal 用短码 P1.. / 数字码，色号表带产品号与名称 |
| 映射算法 | `--dither nearest\|fs` | 最近色 / FS 抖动 | **最近色** | 干净色块 vs 渐变纹理；照片默认 nearest（FS 实测增噪） |
| 边缘描边 | `--outline 1` | 开 / 关 | **关** | 轮廓保留（风格项） |
| 杂色清理 | `--clean 0\|1\|2` | 关 / 标准 / 强力 | 标准(1) | 孤点去噪；FS 模式自动跳过；**内建暗线保护**（暗格 L\*<30 且有暗邻居 = 线段结构，不被亮色多数派吞） |
| 格内取样 | `--sample dominant\|avg` | 主色桶 / 均值 | **主色桶** | dominant = 格内「像素数最多的颜色桶」取均值（APP cellDominantGrid 口径）+ **墨线保真**：格内暗像素（比主色暗 ΔY≥60）占比 ≥ `--ink-min` 时整格取线色——简笔画/Logo 必配；avg = 旧均值口径（对照实验用）。细线断线时调低 `--ink-min` 到 0.10 |
| 区域锁定 | `--region-lock DE` | 0（关）/ 6~16 | **关** | 源色 4 邻域连通（相邻格 ΔE≤DE）成区域，面积 ≥`--lock-min`(默认8) 格的整块改写为「区域源色中位」最近色号。治**大色块被光照渐变劈成多个近似色号**（Mondrian 64 档实测：44 色 5.36% 翻转 → 5 色 0.11%）。⚠️ 几何图/平色插画/扫描件建议 8~14；渐变图不适用（区域内 p90 离中位 >35 自动跳过 = 安全阀） |
| 色数上限 | `--maxcolors N` | ≥1 | 不限 | ΔE 近邻归并压采购；FS 模式自动跳过 |
| 敏感色优先 | `--sensitive 1` | 开 / 关 | **关** | 肤色保护：肤色像素在同色相族候选集内选色（候选集限制法，非 ΔE 加权） |
| 平色优先 | `--flat 0\|1\|2` | 关 / 标准 / 强力 | **fs 模式默认 1，nearest 默认 0** | 平坦区直通+零扩散（REPORT 方案 1 护栏，裸 FS 误差爆炸——CLI 实测 79%→18% 翻转率）+ 事后多数派归并 |
| 自适应候选集 | `--adaptive N` | ≥4 | **关** | 图像主色 → 品牌色盘受限候选集（≤N 色），治 Voronoi 分界翻转。⚠️ **代价（REPORT 明示）：色号被图像约束，可能不含你手里真有的色号**；⚠️ 渐变图收益有限（实测大浪 13.57%→13.25%，主色连续分布时受限集仍有近邻贴分界）——收益集中在主色结构简单的平色图 |
| 裁剪 | `--crop x,y,w,h` | 源图像素 | 不裁 | 裁到主体；EXIF 转正后的坐标 |
| 分块 | `--split N` | ≥16 | 不分块 | 分块索引（含每块主色 top3）+ 分块施工图纸 + 按需块矩阵/ASCII |
| 按需块 | `--block K` | 配合 --split | 全部 | 只出第 K 块（>256 块时默认只出索引，必须按需） |
| ASCII 矩阵 | `--ascii auto\|0\|1` | — | auto | auto = 短边 ≤512 自动出 `blueprint-ascii.txt`；1 强出（>200 万格拒绝） |
| AI 辅导 | `--teach` | 开 / 关 | 关 | 落盘 `coaching.md` 辅导计划；`--level auto\|beginner\|intermediate\|advanced` / `--session-minutes N` |
| 参数对照 | `--compare-matrix` | 开 / 关 | 关 | 一条命令跑多方案 → `compare-matrix.png` 拼图 + `matrix.md` 指标表/复跑命令；`--matrix-variants nearest,fs,outline,merge` 自定方案 |
| 限定色盘 | `--inventory <json>` / 加 `--limit-palette` | 库存色盘 | 全色盘 | 工作流 B：默认只做覆盖/缺色分析；加 `--limit-palette` 才限定生成 |
| 自动迭代选参 | `--refine N` | 0（关）/ 组数上限 | **开（6）** | 参数阶梯自动试 5 组（given / 区域锁定 / 低墨阈 / 锁定+墨阈 / avg）→ 每组算机器保真度（`evalGridQuality`：逐格ΔE + 30×断线率 + 0.5×翻转率）→ 选最低分继续管线 → `refine.md` 落盘全部轮次。**只对 nearest 生效**（fs 抖动跳过）；>200 万格跳过；不枚举网格数（网格由 agent 看 `--analyze` 推理）。复跑命令在 refine.md 头部 |
| 透明阈值 | — | 固定 128 | 128 | 空位判定（`CELL_ALPHA_MIN`，暂未暴露参数） |

## 双工作流

```text
工作流 A（图纸生成 + 辅导）：图片 + 参数(--teach) → 色号表 / 施工图纸 / ASCII 矩阵 / 统计 / 采购清单
                              / 分块索引 / coaching.md 辅导计划 → AI 陪拼 → 复盘 → 库存回收 ↺
工作流 B（库存提取）：拼豆成品照 / 像素画作品图 / 拼豆图纸 / 色卡截图（紧贴或有间隙）
                      → 门禁放行 → 网格检测（差分 / 投影）→ 逐格取色 → ΔE 匹配色号
                      → 存为库存色盘 → 限定色生成 → 只补缺采购 ↺ 闭环
```

### 工作流 A：图纸生成（输出清单）

```bash
node scripts/run.mjs <图> [--grid 96] [--crop x,y,w,h] [--dither nearest|fs] [--outline 1]
               [--clean 0|1|2] [--sensitive 1] [--flat 1] [--maxcolors N]
               [--split N] [--block K] [--ascii auto|1] [--teach] [--out 输出目录]
```

| 交付物 | 实际落盘 |
|---|---|
| ① 色号表 | `blueprint.md`：色号 / 产品号 / 名称 / HEX / 颗数 / 占比 / 采购包数 |
| ② 网格坐标 | `blueprint.json`（逐格色号矩阵，-1=空位）+ `blueprint.png`（放大直映）+ **`blueprint-ascii.txt`**（文本矩阵，逐行核数/grep） |
| ③ 用色统计 | `blueprint.md` 用色统计段 + CLI 孤点诊断（孤点率判据，不评判色数多少） |
| ④ 采购清单 | `blueprint.md` 采购清单段（默认 200 颗/包） |
| ⑤ 辅导计划 | `coaching.md`（`--teach`）：难度评定 / 工时场次 / 里程碑 / 专属易错点 / 辅导问题 / 反馈思路 / 打卡 |
| 施工图纸 | `sheet.png`（网格线+行列编号+逐格色号+图例）；超大档 `--split N` 出 `sheet-block-*.png` |
| **视觉终审图** | `review.png`（≤200 万格自动出）：compare 基础上把机器可疑格（断线/劈叉/偏色，统一 0~100 伤害度标尺排序）红框标注 ≤12 处，左右两栏同位置——**agent 必须先看这张图再交付**。配套 `review.md` 逐框判定表（判定/处置两列由 agent 填写，填完 = 可审计终审证据）。**耗时量化：全链路增量 ≈0.2s**（定位 ~60ms + 渲染 ~150ms，实测 Mondrian 5.6MP g48~g128 稳定） |
| 分块索引 | `blocks-index.json`（每块豆数+主色 top3）+ `sheet-blocks.md`；`--block K` 时附 `block-K.json` + `block-K-ascii.txt` |
| 效果对比 | `compare.png`（原图 vs 拼豆效果并排——「像不像」一眼可判） |

### 超大网格档出图策略（>512，最高 8192）

| 交付物 | >512 档形态 |
|---|---|
| 色号表 / 统计 / 采购清单 | 正常输出（色数与格数无关） |
| 网格坐标 | ① 直映 PNG 总览（每格 1px）② **分块索引** `--split 52`（`blocks-index.json` 含每块豆数/主色 top3，>256 块默认只出索引）③ **逐块按需展开** `--block K` → `block-K.json` + `block-K-ascii.txt` |
| 辅导计划 | `--teach` 配合 `--split`：场次自动按块划分 |

- 源图上限 **100MP**；整张施工图纸画布 >64MP 自动跳过并提示 `--split`（防 OOM）
- 处理报告如实回报实际耗时

### 工作流 B：库存提取（全自动识别，9 环节）

| 环节 | 方案 |
|---|---|
| ① 输入 | 成品照 / 像素画作品图 / 拼豆图纸 / 色卡截图 |
| ② 裁剪（可选） | 输入含边框/背景时先 `--crop` |
| ③ 特征门禁 | 四分支 OR（方格色盘 / 稀疏点状 / 像素画成品 / 低色数插画）；照片直接拒 |
| ④ 网格检测 | 紧贴色块图走差分变色率；**有间隙色卡走投影检测**（背景占比 + 行列等距校验，检出后 `grid.mode='projection'`） |
| ⑤ 逐格取色 | 网格中心取样 → RGB 分桶归并抗噪 → 按格去重出色盘 |
| ⑥ 色号匹配 | Lab ΔE 最近色号 + 置信度分级；**低置信必须向用户确认，不静默采信** |
| ⑦ 库存持久化 | 色号集合 + 图例 + 匹配明细（可记录余量） |
| ⑧ 限定色生成 | `--limit-palette` 只在库存子集内映射 |
| ⑨ 缺色处理 | 就近替换建议（ΔE + 影响格数）+ 只补缺采购清单 |

**CLI 入口**：

```bash
#-- ① 扫成品/色卡 → 库存 JSON（低置信拒绝入库，确认后加 --accept-low-confidence）
node scripts/run.mjs <成品图或色卡> --scan inventory.json [--cols N --rows N] [--accept-low-confidence]

#-- ② 用库存生成：默认只做覆盖/缺色分析；加 --limit-palette 则只用库存色量化
node scripts/run.mjs <照片> --inventory inventory.json --grid 96 [--limit-palette] [--teach]
```

### 工作流 B 局限性（必须如实告知用户）

1. **只认网格化色块图，不认照片**——门禁结构性拒绝（设计使然）。门禁对高平坦度图会**误放**（实测单色 logo `unique=3` 也能过），由下游网格检测兜底拒绝。
2. **相邻同色格无可见边界时自动检测失败**——数清行列后加 `--cols N --rows N` 走等距取样。
3. **尺寸**——`detectGridByDiff` 对 >4096px 的图直接返回失败；大图先裁剪。≤256×256 最稳。
4. **拍摄质量影响取色精度**——低置信（ΔE>12）CLI 拒绝写库存，需人工确认后加 `--accept-low-confidence`。
5. **容差已标定但非万能**——极端噪声样张可能误拒/误放，误放后下游网格检测兜底。

### 格式兼容（2026-10-22）

- **progressive JPEG 自动转码**：解码遇 SOF2 不再直接拒绝，按 PowerShell System.Drawing → sips → magick → convert → Pillow 顺序找系统转换器转 PNG（60s 超时），EXIF 方向从原 JPEG 元数据补回后照常转正；找不到任何转换器时报可读错误并给出手工转格式建议。
- **16-bit PNG / 隔行 PNG 仍不支持**：抛可读错误。

## 处理报告（可解释输出——AI 微调的数据燃料）

| 决策数据 | 用户看到的话 |
|---|---|
| 参数快照 | 管线回显：nearest + clean1 + sensitive + flat1 |
| 归并色数 + ΔE | 「为你归并了 3 个低用量色（ΔE≤8），省 2 包采购」 |
| 清理格数 | 「清理了 47 格孤点杂色（强力档）」 |
| 孤点诊断 | 「孤点率 0.36%，色数 42 是图像本身色彩结构，不需要降档」 |
| 平色/敏感 | 「FS 平坦源区 4096 格（这些格不扩散误差）」 |
| 门禁/网格判据 | 「投影检出 16×12（有间隙色卡；背景占比 0.31）」 |

**微调闭环示例**：用户说「脸上杂色太多」→ 读处理报告 → 回「切强力档重跑」，而不是让用户翻参数表。

## 大模型推理框架（参数决策禁查表，2026-10-21 定稿）

**agent 五步**：① 先视觉看图（构图/主体/必保细节）→ ② 跑 `--analyze` 拿特征 JSON（stdout 纯 JSON，进度走 stderr；含主体代理 `subject.ratio`/`edgeCentroid`）→ ③ 视觉 × 特征推理决策并**写理由** → ④ **带 `--refine` 出图（默认开）**：机器先自动迭代 5 组参数选最优（逐格ΔE/断线率/翻转率，报告在 refine.md），agent 读报告核对选版理由 → ⑤ **视觉终审（硬门槛）**：CLI 会落盘 `review.png`（机器可疑格红框 ≤12 处），agent 必须【看图】逐框判断「真缺陷 or 机器误报」——有真缺陷按协议调参重跑（≤3 轮），全过才允许交付。**只看指标不看图 = 本末倒置，禁止交付**。**多方案比较用 `--compare-matrix`**（AI 看图选版，不按分数自动选）。

### 目检三轮闭环（2026-10-25 定稿，多模态大模型在环的落地形态）

> 用户裁定：模型应该反复对比图纸和原图，尽可能做到「像画出来的」——在有限格子内。机器指标（--refine）只保底，**形对不对/主体像不像只有视觉能判**。

1. **第 1 轮**：看 **review.png 红框**（机器已把可疑格框出来，注意力从 4160 格收敛到 ≤12 处）+ compare.png（左原图/右拼豆）→ 用一句话列**最伤形的 1~2 个缺陷**（例：「黑线在蓝块边断成虚线」「红块被劈成两色」）→ 按 SKILL.md 参数表选针对性旋钮重跑（断线→`--ink-min 0.10`/升网格；劈叉→`--region-lock 8`；偏色→换色盘/`--adaptive`）。
2. **第 2 轮**：只对比上一轮列的缺陷是否消失 + 有没有**引入新缺陷**（升网格会碎、加锁会平）→ 未消或新伤 → 再调。
3. **第 3 轮（上限）**：仍不达标就**如实交付**：明确告诉用户「已试 N 组参数，剩余缺陷是 X，原因是 Y（媒介表达力/源图质量），可选 Z（简化重绘/再升网格的代价）」。**禁止**静默交付明显残缺的图，也禁止无限重跑。

复杂画面在跑之前就有预警：CLI 会在开头打印「⚠ 复杂画面如实声明」（边缘密度/色彩熵/平色占比三判据），命中就必须先与用户对齐预期再出图。

特征语义：`colorEntropy` 色彩丰富度 · `edgeDensity` 细节密度 · `subject.centerEdgeDensity/edgeEdgeDensity/ratio` **主体代理**（中心 50% 框 vs 外圈边缘密度；ratio ≥1.35 主体居中，≤0.75 细节散在外圈 → 先裁主体）· `subject.edgeCentroid` 细节重心（偏移 >0.12 时提示裁切方向）· `flatRatio` 平色区占比 · `lumaSpread` 明暗对比 · `dominantColors` 主色结构 · `hints` 弱提示（仅参考）。

## 输入适配性（如实声明，2026-10-21 定稿）

> 用户实测：神奈川冲浪里翻拍版 96 格仍主体不凸显——**这是输入适配性问题，不是档位问题**。

1. 翻拍版先天缺陷：低分辨率 + 纸面纹理被忠实量化（管线是忠实转换器，垃圾进垃圾出）
2. 名画细节密度超出拼豆媒介表达力（浪花碎点需 256+ 格 = 6 万颗豆）
3. 无主体增强管线——主体靠输入图本身的构图对比保证

| 输入特征 | 应对 |
|---|---|
| 主体清晰、背景干净 | 直接出图（甜区） |
| 低分辨率翻拍版名画 | **先如实声明**预期落差，用户确认再跑 |
| 细节密集型绘画 | 同上 + 建议简化重绘版 |
| 剪影/Logo/扁平插画 | 最佳输入 |

### 2026-10-24 简笔画/几何构成（拼豆真实甜区，实测定稿）

> 用户裁定：拼豆是「形」的工艺——简笔画（粗轮廓+大面积平色）、几何构成（蒙德里安）、Logo 才是真实场景；名画/实景照片量化后形会散。

| 输入 | 推荐参数 | 实测（2026-10-25 口径） |
|---|---|---|
| 简笔画（线宽可能 < 一格） | 默认即可（主色桶+墨线保真+暗线保护+`--refine` 自动迭代都已内建）；轮廓仍有断线 → `--ink-min 0.10`；仍碎 → `--grid 96` | 1024px 猫脸 g64：`--refine` 自动选定 lock+低墨阈，断线率 9.6%→**0%**、翻转 3.95%→0.03%（refine.md 可复核） |
| 几何构成/扫描件大色块 | `--refine` 默认会自动试出 `--region-lock 8`（扫描件光照渐变把一块红劈成 3 个红的根治法） | Mondrian 1930 扫描件 g48：默认 25 色 9.67% 翻转 → 自动选定 lock+ink **15 色 0.23%**，红/蓝/黑各归一（g48 用户实测「糊成什么样子」的轮次已由闭环自救） |
| 笔触/油画类照片源 | `--sample avg`（主色桶会放大笔触色差，翻转率升高——大浪 g96 nearest 22.53% vs 旧 avg 口径 13.57%） | 用 `--compare-matrix` 对照后选版 |

### 2026-10-22 真实照片回归

| 样张 | 参数 | 结论 |
|---|---|---|
| 900×700 宠物 | 96 / nearest / clean2 | 全幅小主体：先 `--crop` 裁脸，或升 160+ 格 |
| 700×900 人像 | 96 / nearest / clean1 | 96 可交付；花束要更清楚升 128 |
| 1000×667 风景 | 128 / nearest | 甜区 |
| 同上 | 128 / fs | ⚠️ 2026-10-21 实测为 87→111 色满屏棋盘噪点（当时无护栏）；**2026-10-22 起 FS 默认带护栏**（误差 clamp ±40 + 平坦区直通零扩散，REPORT.md 方案 1），greatwave 128 格实测 54 色 / 平坦翻转率 19.74%——照片仍建议先 nearest，但 FS 不再是「必糊」 | 照片默认仍 nearest；FS 护栏细节见处理报告的「平坦翻转率」行 |
| 4000×2667（10.7MP） | 128 / nearest | 全链路 1.7s，性能不是瓶颈 |

> 2026-10-22 后 progressive JPEG 已自动转码，picsum 等在线样张可直接喂。

## 关键数字复现命令（对齐 REPORT.md §六 规范——每个实测数字给命令，防漂移）

> **执行位置**：以下命令一律在**本包根目录**执行（CLI 入口在 scripts/run.mjs）。
> **样张可用性（如实声明）**：scripts/test/fixtures/ 随包分发 3 张——`mondrian-1930-cii-original.jpg`、`progressive-mondrian.jpg`、`tux-large-white_win.png`。**下列「adaptive 剂量」与「多方案对照」两段中引用 `tux-large-white_win.png` / `mondrian-1930-cii-original.jpg` 的命令在包内可直接跑**（2026-10-25 复核（主色桶取样默认后）：tux g48 = 9 色，加 `--adaptive 24` = 6 色；mondrian g48 = 28 色，加 `--adaptive 24` = 17 色）；引用 `greatwave-hokusai-1831.jpg` / `duke-wave_win.png` / `selfportrait-vangogh-1887.jpg` 的行**需自备同名样张**（可从源仓库 scripts/test/fixtures/ 取得），否则会报「找不到文件」。**命令写法与数字口径不变**。

```powershell
$FX = "scripts/test/fixtures"

#-- FS 护栏三态（裸 80.94% / 护栏 31.28% / nearest 基线 22.53%；2026-10-25 主色桶取样口径复核）——大浪 g96
node scripts/run.mjs "$FX/greatwave-hokusai-1831.jpg" --grid 96 --dither fs --flat 0   # 裸 fs
node scripts/run.mjs "$FX/greatwave-hokusai-1831.jpg" --grid 96 --dither fs          # 护栏（默认）
node scripts/run.mjs "$FX/greatwave-hokusai-1831.jpg" --grid 96                      # nearest 基线

#-- adaptive 剂量（平色图收益 / 渐变图阴性）：
node scripts/run.mjs "$FX/tux-large-white_win.png" --grid 48 --adaptive 24           # tux 9→6 色
node scripts/run.mjs "$FX/mondrian-1930-cii-original.jpg" --grid 48 --adaptive 24    # mondrian 28→17 色
node scripts/run.mjs "$FX/greatwave-hokusai-1831.jpg" --grid 96 --adaptive 24        # 大浪 22.53→21.24%（收益有限，如实）

#-- 8192 超大档全链路（量化 2.1s / PNG 2.3s / 索引 0.8s —— RGB→色号缓存后量化 10.5s→2.1s）：
node --test --test-name-pattern="T14" --test-reporter=spec scripts/test/run.mjs

#-- 多方案对照（AI 选版：一条命令出 4 版拼图 + 指标表）
node scripts/run.mjs "$FX/mondrian-1930-cii-original.jpg" --grid 64 --compare-matrix
node scripts/run.mjs "$FX/greatwave-hokusai-1831.jpg" --grid 96 --compare-matrix --matrix-variants nearest,fs

#-- 主体代理指标（中心 vs 外圈边缘密度；ratio ≤0.75 提示先裁主体）
node scripts/run.mjs "$FX/duke-wave_win.png" --analyze

#-- examples 维护（平铺 + INDEX.md，原 flatten.mjs 已并入 CLI）
node scripts/run.mjs --flatten

#-- 归并压采购（自画像 g128：36→21 色，豆数守恒）：
node scripts/run.mjs "$FX/selfportrait-vangogh-1887.jpg" --grid 128 --maxcolors 24   # 自画像 g128：146→104 色（豆数守恒）

#-- 全量回归（提交包内 46 项；真实图 9 项因体积未随包分发，见上方样张可用性说明）：
node --test scripts/test/run.mjs
```

## 边界声明

- 色值为工程预置近似值，不等于实体豆在特定光源下的测色值；采购前建议用实体色卡校准
- 本 skill 不做图像分割——纯算法管线，离线可复现；纯主体形状请自行预处理透明 PNG
- 输出图纸，不提供原料采购链接
- 色号数据为公开品牌标准（MARD 数据取自 HansBug/pindou-color-data，Perler 取自 jsspace/bead-colors，Artkal 官方表经同一仓库整理；MIT 许可，来源与许可全文见 references/palette-sources.md ），不冒充实验室测量值

## 实现状态（2026-10-22 第二轮收口）

> 勾选 = 有自动化测试或真实产物验证；本节同时是「不许声称已具备」的清单。

- [x] 量化管线核心（PNG 编解码零依赖 / ΔE76 最近色 / 透明=空位铁律 / 100MP 护栏 / 采购换算 / 处理报告）
- [x] 画质件：FS 抖动（横图宽高比已修）+ **FS 护栏（2026-10-22 默认开：误差 clamp ±40 + 平坦区直通零扩散，REPORT.md 方案 1；`opts.flat:false` 可关做对比实验）** + 平坦翻转率指标（处理报告「平坦翻转率」行，REPORT §二.A 量化代理）+ 边缘描边 + ΔE 色对归并 + regionClean 平色（含暗线保护）+ 敏感色优先（同色相族候选集）+ 平色优先（源平坦抑制 + 多数派归并）+ **主色桶取样 + 墨线保真（2026-10-24 默认 dominant）+ 区域锁定 `--region-lock`（大色块光照渐变归一）**
- [x] 工作流 B 全链路：四分支门禁 / 差分网格检测 / **投影网格检测（有间隙色卡）** / 逐格取色 / 置信度分级 / 库存持久化 / 限定色盘 / 缺色分析 / `--cols --rows` 兜底
- [x] baseline JPEG（420/422/444/灰度 + EXIF 1~8）+ **progressive JPEG 自动转码**（系统转换器链 + EXIF 补回）
- [x] 内置色盘 5 套：MARD 221 / MARD 291 / Perler 118（短码+产品号）/ Artkal C 188 / Artkal M 220（references/palette-*.json  + 来源许可 `palette-sources.md`）
- [x] ASCII 矩阵（全局 `blueprint-ascii.txt` auto≤512 / 分块 `block-K-ascii.txt`）+ 分块索引（每块豆数/主色 top3）+ `--block K` 按需展开（json+ascii）
- [x] AI 辅导层：references/teaching.mjs （难度评定/工时/场次/易错点/辅导问题/反馈思路）+ `--teach` → `coaching.md` + references/ai-tutor-protocol.md （六步辅导环）
- [x] 施工图纸 sheet.png（网格线+行列编号+逐格色号+图例；2026-10-22 修复画布撑宽/图例裁切/列号覆盖）+ 超大档 64MP 画布保护
- [x] 测试：scripts/test/run.mjs 51 项（含 T38 自动迭代评分 / T39 墨线相对判据 / T35 墨线保真 / T36 暗线保护 / T37 区域锁定 / T14 **8192 真跑 67M 格**全链路 / T16e FS 护栏剂量-反应 / T22 内置色盘 / T23 投影间隙色卡 / T24 敏感色 / T25 平色优先 / T26 ASCII / T27 分块索引 / T28 --teach / T30 progressive / T31 analyze 主体代理 / T32 RGB 缓存恒等 / T33 compare-matrix / T34 flatten；无转换器环境 T30 自动跳过）+ 真实图回归 9 项（F3/F7 已按 adaptive24+clean1 推荐管线收紧到 ≤24 / ≤12；依赖 10+ 张原图，体积所限**未随提交包分发**，用源仓库 `skills/pixel-bead-blueprint-dev/test/fixtures-test.mjs` 复跑）
- [x] 性能：`nearestIndex`（零对象分配）+ RGB→色号缓存（上限 64K 条，`noRgbCache` 可关做对照）；8192 档量化 10.5s→2.1s，缓存恒等性由 T32 锁定
- [x] **`--refine` 自动迭代选参（2026-10-25 默认开）**：参数阶梯 × evalGridQuality 机器评分 → refine.md（含复跑命令）· 复杂画面自动预警（跑图开头打印：边缘密度/色彩熵/平色占比三判据命中即提示预期落差）· `--compare-matrix`（多方案对照拼图 + 指标表 + 复跑命令，AI 选版）· `--analyze` 主体代理（中心/外圈边缘密度 + 细节重心）· `--flatten`（原 flatten.mjs 并入 CLI，根目录不再有散脚本）
- [x] `test-cases/`：5 个叙述用例（工作流 A 全流程+辅导 / 超大图分块 / 工作流 B 库存闭环 / 推理回调 / 格式兼容）+ `test-prompts.md` 触发语表
- [ ] **仍不支持**：16-bit PNG / 隔行 PNG（抛可读错误）；图像分割

## 复用边界（供评委参考）

同一管线外溢：十字绣（网格 + 色号 → DMC 线号）、马赛克拼贴、乐高马赛克；「生成 → 拼完 → 拍成品回补库存 → 再生成」形成持续复用循环；辅导层（teaching.mjs 协议）可平移到十字绣/刺绣陪学场景。
