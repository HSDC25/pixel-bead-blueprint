# 提交包说明与图纸示例索引（2026-10-25 · 视觉终审版）

> ⚠️ **时效性**：本文基于 2026-10-25 的包状态（51 项测试 / review.png 视觉终审 / `--refine` 自动迭代）。后续变更以实际文件为准。
> **本目录即提交单元**：目录名 `pixel-bead-blueprint` 与 `SKILL.md` 的 frontmatter `name` **一致**（已核对）；**30 文件 / 1.6 MB**，正好满足赛题「单次 ≤30 文件 / ≤40MB」。⚠️ **配额顶格零余量（已知取舍）**：trigger.md / functional.md 是赛题 test-runner 格式的硬要求，示例图纸已裁到 1 份三件套——**第 31 个文件无位置**，新增内容只能替换或外置。
> **结构**（对照官方技能包规范：根目录只留 `SKILL.md`，其余按白名单归位）：
>
> ```
> pixel-bead-blueprint/
> ├── SKILL.md            ← 唯一根文件
> ├── assets/             ← README.md（本文件）+ examples/（示例图纸三件套）
> ├── references/         ← 5 套色盘 JSON + 算法 .mjs + 辅导协议
> ├── scripts/            ← run.mjs（CLI 入口）+ test/（自动化测试 + 样张）
> └── test-cases/         ← 叙述式用例 ×5 + 触发语表 + test-runner 用例（trigger.md / functional.md）
> ```
> **命令执行位置**：包内所有复现命令（见 `SKILL.md`「关键数字复现命令」§）一律在**本包根目录**执行，例如 `node scripts/run.mjs <图> --grid 96`。**默认输出目录** = 当前工作目录下的 `pixel-bead-output/<图名>-gN/`（不再写进包内 assets）。
> **样张可用性**：`scripts/test/fixtures/` 随包分发 3 张——`mondrian-1930-cii-original.jpg` / `progressive-mondrian.jpg` / `tux-large-white_win.png`；`SKILL.md` 中引用 `greatwave-hokusai-1831.jpg`、`duke-wave_win.png`、`selfportrait-vangogh-1887.jpg` 的命令需自备同名样张。
> **包内自检**：`node --test scripts/test/run.mjs` → 51 项全过（2026-10-25 实测）。

## 与源仓库的差异（防分叉，有意为之）

本包由 `skills/pixel-bead-blueprint-dev/` 收口而来；**2026-10-24 起两边目录结构已同步**（dev 也已改为 `scripts/` + `assets/examples/` + `scripts/test/`），差异只剩素材数量：

| 差异 | 源仓库（dev） | 提交包 | 原因 |
|---|---|---|---|
| 文件数 / 体积 | ~180 文件 | 30 文件 / ≤40MB | 赛题限制 |
| 样张 | 19 张 | 3 张 | 30 文件上限 |
| 示例图纸 | 21 份（六件套/份） | 1 份（三件套） | 同上 |
| 真实图回归 | `scripts/test/fixtures-test.mjs` 9 项 | 未打包 | 依赖 10+ 张原图，无法压缩进 30 |

> **收口方向唯一：改 dev，再裁剪出包**（不要反向从包改回 dev，会丢全量素材）。裁剪清单见 dev 的 `assets/README.md`。

## 图纸示例（节选）

> 提交包受 30 文件上限约束，此处收录 1 份旗舰示例的**三件套**；完整 21 份图纸索引见源仓库 `skills/pixel-bead-blueprint-dev/assets/examples/INDEX.md`。
> 收录：tux-large-white_win-g64（吉祥物，8 色 5056 颗；2026-10-25 主色桶取样默认后复核）——**色号表** `-blueprint.md` / **施工图纸** `-sheet.png`（网格线 + 行列编号 + 逐格色号 + 图例）/ **效果对比** `-compare.png`（原图 vs 拼豆效果并排）。
> **单次运行产物实为 9 件**（README 只随包收 3 件）：上列 3 件 + `blueprint.png`（直映预览）/ `blueprint.json` / `blueprint-ascii.txt`（机器可读矩阵）/ **`review.png`（视觉终审图：机器可疑格红框 ≤12 处）** / **`refine.md`（自动迭代轮次表）+ `review.md`（逐框判定表，agent 填写后 = 终审证据）**。
> 逐格矩阵 `-blueprint.json` 与文本矩阵 `-blueprint-ascii.txt` 为机器可读件，受 30 文件上限约束未随包分发（源仓库有），CLI 运行时会照常生成。
> **一键复现**（在本包根目录执行）：`node scripts/run.mjs scripts/test/fixtures/tux-large-white_win.png --grid 64`

完整索引（21 份，存于源仓库）：

| 图纸 | 网格 | 用色 | 出豆 | 空位 | 风格 | 施工图纸 |
|---|---|---|---|---|---|---|
| debian-swirl_win-g64 | 64×81 | 10 | 5184 | 0 | 默认 | debian-swirl_win-g64-sheet.png |
| duke-thumbsup_win-g64 | 64×83 | 18 | 5312 | 0 | 默认 | duke-thumbsup_win-g64-sheet.png |
| duke-wave_win-g64 | 64×83 | 15 | 5312 | 0 | 默认 | duke-wave_win-g64-sheet.png |
| ferris-happy_win-g64 | 72×64 | 21 | 4608 | 0 | 默认 | ferris-happy_win-g64-sheet.png |
| gopher_win-g64 | 64×88 | 24 | 5632 | 0 | 默认 | gopher_win-g64-sheet.png |
| greatwave-hokusai-1831-g128 | 191×128 | 54 | 24448 | 0 | 默认 | greatwave-hokusai-1831-g128-sheet.png |
| greatwave-hokusai-1831-g128-fs | 191×128 | 85 | 24448 | 0 | FS 抖动 | greatwave-hokusai-1831-g128-fs-sheet.png |
| greatwave-hokusai-1831-g96 | 143×96 | 46 | 13728 | 0 | 默认 | greatwave-hokusai-1831-g96-sheet.png |
| irises-vangogh-1889-g96 | 121×96 | 47 | 11616 | 0 | 默认 | irises-vangogh-1889-g96-sheet.png |
| mondrian-1930-cii_win-g96 | 96×98 | 23 | 9408 | 0 | 默认 | mondrian-1930-cii_win-g96-sheet.png |
| mondrian-1930-cii-original-g96 | 97×96 | 54 | 9312 | 0 | 默认 | mondrian-1930-cii-original-g96-sheet.png |
| mondrian-1930-crop_win-g64 | 64×64 | 20 | 4096 | 0 | 默认 | mondrian-1930-crop_win-g64-sheet.png |
| mondrian-cma-1927-crop_win-g96 | 96×98 | 22 | 9408 | 0 | 默认 | mondrian-cma-1927-crop_win-g96-sheet.png |
| rebecca-delacroix-1846-g96 | 96×118 | 16 | 11328 | 0 | 默认 | rebecca-delacroix-1846-g96-sheet.png |
| selfportrait-vangogh-1887-g128 | 128×159 | 77 | 20352 | 0 | 默认 | selfportrait-vangogh-1887-g128-sheet.png |
| selfportrait-vangogh-1887-g128-c24 | 128×159 | 21 | 20352 | 0 | ΔE 归并(24色目标) | selfportrait-vangogh-1887-g128-c24-sheet.png |
| selfportrait-vangogh-1887-g96 | 96×120 | 71 | 11520 | 0 | 默认 | selfportrait-vangogh-1887-g96-sheet.png |
| tux-large-white_win-g64 | 64×79 | 8 | 5056 | 0 | 默认 | tux-large-white_win-g64-sheet.png |
| tux-large-white_win-g96-outline | 96×118 | 33 | 11328 | 0 | 边缘描边 | tux-large-white_win-g96-outline-sheet.png |
| wheatfield-vangogh-1889-g128 | 161×128 | 46 | 20608 | 0 | 默认 | wheatfield-vangogh-1889-g128-sheet.png |
| wheatfield-vangogh-1889-g96 | 121×96 | 38 | 11616 | 0 | 默认 | wheatfield-vangogh-1889-g96-sheet.png |

## 分享要点（传播素材骨架）

> 供小红书等平台发布取用；**只列包内可验证的事实，不含实测之外的宣称**，具体文案可再创作。

1. **差异点**：产出不是「一张像像素画的图」，而是含**色号表 + 施工图纸 + 采购清单 + 视觉终审闭环**的可执行工程产物——「照着就能拼」：`--refine` 自动迭代 5 组参数选最优（refine.md 留痕），`review.png` 红框引导多模态大模型看图终审（review.md 判定表可审计）。
2. **首图建议**：`assets/examples/tux-large-white_win-g64-compare.png`（原图 vs 拼豆效果并排，「像不像」一眼可判）；次图 `-sheet.png`（带网格线与行列编号的施工图纸）。
3. **互动钩子**：AI 会先问经验档位 / 单次时长 / 手里有哪些豆，再定网格与色盘；「拍一张你已有的豆 → 只用这些色出图 → 只补缺采购」是闭环玩法。
4. **素材边界**：示例图均为离线管线真实产物，未做美化；色号为工程预置近似值，采购前建议用实体色卡校准。