# 提交包说明与图纸示例索引（2026-10-26 · 视觉终审版）

> 出品：像素事务所（Pixel Bureau）

> ⚠️ **时效性**：本文基于 2026-10-28 修订（示例换蒙德里安公版图 / 数字按当前 CLI 复测；58 项测试 / review.png 视觉终审 + 交付门禁 / `--refine` 自动迭代 / `--patch-cells` 改格回路）。后续变更以实际文件为准。
> **本目录即提交单元**：目录名 `pixel-bead-blueprint` 与 `SKILL.md` 的 frontmatter `name` **一致**（已核对）；**21 文件 / 解压约 3.6 MB**，满足赛题「单次 ≤30 文件 / ≤40MB」，**尚余 9 个配额**。2026-11-21 两轮收口：① `test-cases` 8 → 2（`cases.md` = 功能判据 + 场景剧本 ×5 + 触发语表；`trigger.md` 留给 test-runner）；② `references/palette.*.json` 5 → 1（`palettes.json`，键 = mard / mard291 / perler / artkal-c197 / artkal-m221，CLI 别名不变）。另把新增 `skill-card.md`（技能卡）纳入配额。
> **结构**（对照官方技能包规范：根目录只留 `SKILL.md`，其余按白名单归位）：
>
> ```
> pixel-bead-blueprint/
> ├── SKILL.md            ← 唯一根文件
> ├── assets/             ← README.md（本文件，评审视角）+ getting-started.md（小白上手指南，使用者视角）+ examples/（示例图纸 PNG 以 base64 内联在 .html）
> ├── references/         ← palettes.json（5 套色盘合并，键=色盘名）+ 算法 .js + 辅导协议
> ├── scripts/            ← run.js（CLI 入口）+ test/（自动化测试 + 样张）
> └── test-cases/         ← cases.md（功能判据 + 场景剧本 ×5 + 触发语表）+ trigger.md（test-runner 触发用例）
> ```
> **命令执行位置**：包内所有复现命令（见 `SKILL.md`「关键数字复现命令」§）一律在**本包根目录**执行，例如 `node scripts/run.js <图> --grid 96`。**默认输出目录** = 当前工作目录下的 `pixel-bead-output/<图名>-gN/`（不再写进包内 assets）。
> **样张可用性**：二进制样张与示例图以 **base64 内联**在 `scripts/test/fixtures/fixtures.html` 与 `assets/examples/*.html`；`run.js` 与测试启动时自动提取，无需手动还原（手动入口 `node references/fixtures.js`）。
> **包内自检**：`node --test scripts/test/run.js` → 57 项全过（样张由 fixtures.html 自动提取；2026-11-21 复测含 T43 状态自洽 json↔渲染逐格一致 / T44 改格回路 / T45 autocrop 白边裁切 / T46 毛边-骑线双向回归）。

## 质量门禁（2026-10-28 新增，实测驱动）

> 背景：实测「白底黑字 64 格」场景——原图暗像素 21% → 输出 0%（字被抹平），但逐格 ΔE 只有 3.83（看着最准），CLI 仍无条件打印「完成」。以下四项为针对性修复，测试 51→58 项（v1.1.1 增补 T43 状态自洽 / T44 改格回路；v1.1.2 增补 T45 autocrop；v1.1.3 增补 T46 毛边-骑线）。

1. **结构保真指标 `structureRetention`**：原图暗结构（L*<35）占比 vs 输出暗豆占比；`srcDark ≥ 8%` 且保留率 < 40% ⇒ 终端与 `blueprint.md` 同时标 `STRUCTURE_LOSS`。
2. **断线门控**：原图无暗结构（`darkRatio < 8%`）时不产出 `break` 红框——此前渐变/噪点图「断线率恒 100%、12 框全是误报」，真缺陷被淹没。
3. **交付门禁 `--review-gate`（默认 1）**：`review.md` 的「判定/处置」列全空 ⇒ 不打印「完成」，改打印 `REVIEW_UNFILLED` 并 `exit 3`。
4. **终审签署 `--verify-review <outDir>`**：agent 看图填表后运行——全部已填 ⇒ `REVIEW_SIGNED` + `exit 0`；仍有空行 ⇒ `exit 3`；文件不存在 ⇒ `exit 2`。

5. **手工逐格修补 `--patch <json>`**：`{"patches":[{"col":64,"row":55,"code":"H9"}]}`（col/row 为 1-based，与 review.md 一致；code 用当前色盘色号），在清洗/归并**之后**改写指定格并重算统计——用于 review 判定后的外科修补（如白格被墨线整格吞黑），不改算法本身。

> 自动化/对照实验可加 `--review-gate 0` 关闭交付门禁（包内测试即用此开关）。
> 元测试：T40 结构保真 / T41 断线门控，锁定上述行为不回退。

## 与源仓库的差异（防分叉，有意为之）

本包由 `skills/pixel-bead-blueprint-dev/` 收口而来；**2026-10-24 起两边目录结构已同步**（dev 也已改为 `scripts/` + `assets/examples/` + `scripts/test/`），差异只剩素材数量：

| 差异 | 源仓库（dev） | 提交包 | 原因 |
|---|---|---|---|
| 文件数 / 体积 | ~180 文件 | 31 文件 / ≤40MB | 赛题限制 + 平台白名单（仅文本类扩展名） |
| 样张 | 19 张 | 3 张（base64 内联在 fixtures.html，运行时自动提取） | 平台白名单不收二进制 |
| 示例图纸 | 21 份（六件套/份） | 1 份（两件套 PNG，base64 内联在 examples/*.html） | 同上 |
| 真实图回归 | `scripts/test/fixtures-test.js` 9 项 | 未打包 | 依赖 10+ 张原图，无法压缩进 30 |

> **收口方向唯一：改 dev，再裁剪出包**（不要反向从包改回 dev，会丢全量素材）。裁剪清单见 dev 的 `assets/README.md`。

## 图纸示例（节选）

> 提交包受 30 文件上限约束，此处收录 1 份旗舰示例的**两件套**；完整 21 份图纸索引见源仓库 `skills/pixel-bead-blueprint-dev/assets/examples/INDEX.md`。
> 收录：mondrian-1930-cii-original-g64（蒙德里安 1930，公版画作，零授权风险；5 色 4096 颗（红白黑蓝黄经典五色）；2026-10-28 实测，`--autocrop` 裁掉翻拍白边（断线根因）→ `--refine` 选 lock8+ink0.1 → v1.1.3 中央墨水判据收掉抗锯齿毛边（全图宽抖动格 104→0，线宽恒定 2 格）→ `--maxcolors 8` + 近重复兜底（H17/H1 三种白并成一种）→ `--patch-cells` 修右缘白边条与 2 处过渡孤点 → review.md 逐框判定 REVIEW_SIGNED；横竖黑线全宽连续、平坦翻转率 0%）——**施工图纸** `-sheet.png`（网格线 + 行列编号 + 逐格色号 + 图例）/ **效果对比** `-compare.png`（原图 vs 拼豆效果并排）——两张 PNG 以 base64 内联在 `examples/mondrian-1930-cii-original-g64.html`。**色号表** `-blueprint.md` 已移出本包以腾位给 `assets/getting-started.md`（源仓库仍有）。
> 第三方吉祥物示例因署名要求与版权边界已整体移出：包内样张仅保留公版画作与自产图像，均由 fixtures.html 按需提取。
> **单次运行产物实为 9 件**（README 只随包收 2 件）：上列 2 件 + `blueprint.md`（色号表+采购清单）/ `blueprint.png`（直映预览）/ `blueprint.json` / `blueprint-ascii.txt`（机器可读矩阵）/ **`review.png`（视觉终审图：机器可疑格红框 ≤12 处）** / **`refine.md`（自动迭代轮次表）+ `review.md`（逐框判定表，agent 填写后 = 终审证据）**。
> 逐格矩阵 `-blueprint.json` 与文本矩阵 `-blueprint-ascii.txt` 为机器可读件，受 30 文件上限约束未随包分发（源仓库有），CLI 运行时会照常生成。
> **新手/使用者请从 `assets/getting-started.md` 开始**（讲"怎么拼豆"）；本文档讲"包的构成与合规"。
> **一键复现**（在本包根目录执行；样张由 fixtures.html 自动提取）：`node scripts/run.js scripts/test/fixtures/mondrian-1930-cii-original.jpg --grid 64`

完整索引（19 份，存于源仓库）：

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
| wheatfield-vangogh-1889-g128 | 161×128 | 46 | 20608 | 0 | 默认 | wheatfield-vangogh-1889-g128-sheet.png |
| wheatfield-vangogh-1889-g96 | 121×96 | 38 | 11616 | 0 | 默认 | wheatfield-vangogh-1889-g96-sheet.png |

> 注：索引为源仓库全量历史产物（横跨多个管线版本），色数/颗数口径以源仓库 INDEX.md 为准。

## 分享要点（传播素材骨架）

> 供小红书等平台发布取用；**只列包内可验证的事实，不含实测之外的宣称**，具体文案可再创作。

1. **差异点**：产出不是「一张像像素画的图」，而是含**色号表 + 施工图纸 + 采购清单 + 视觉终审闭环**的可执行工程产物——「照着就能拼」：`--refine` 自动迭代 5 组参数选最优（refine.md 留痕），`review.png` 红框引导多模态大模型看图终审（review.md 判定表可审计）。
2. **首图建议**：`assets/examples/mondrian-1930-cii-original-g64.html`（两张图 base64 内联：原图 vs 拼豆效果对比 + 施工图纸；公版画作商用零风险，「像不像」一眼可判，浏览器打开即看）。
3. **互动钩子**：AI 会先问经验档位 / 单次时长 / 手里有哪些豆，再定网格与色盘；「拍一张你已有的豆 → 只用这些色出图 → 只补缺采购」是闭环玩法。
4. **素材边界**：示例图均为离线管线真实产物，未做美化；色号为工程预置近似值，采购前建议用实体色卡校准。

---

## 完整性校验（v1.4.0 补）

> 为什么只列五个：为控制文件数（赛题 **≤30 文件**，当前 25，尚余 5）。所以把校验信息写进本文件，不额外占配额——留出的配额可用于后续 `evals/` 或签名文件。

改过的包，最容易出事的是「入口」和「算色」这两处，所以先核这五个：

| 文件 | 字节 | SHA256 |
|---|---|---|
| `SKILL.md` | 33,809 | `519a1c7da735d5e024cdc3605659ce05b7b20a5a63ee07d1699bed5cd4a0730c` |
| `package.json` | 279 | `78329172a0015f6ac672d5eda123576811188ad984c139bc8d5e2344151ac1d5` |
| `scripts/run.js` | 63,108 | `4e14bfc11e724686a4fed776d1100e85a6e1c841fedc7b7561107bea0b95d86a` |
| `references/quantize.js` | 109,447 | `32eebfaf296550134fead3b43c5ba2cffa7830e0a370a17ad40e6961576171c5` |
| `references/palettes.json` | 52,676 | `69b28426e3c49cfa6b2e75f6ff2124e990a415804f3bde15da5ad62239501d6c` |

核对方法：

```bash
shasum -a 256 SKILL.md scripts/run.js            # macOS / Linux
certutil -hashfile SKILL.md SHA256               # Windows
```

**整包**以发布页给出的 zip SHA256 为准（zip 无法自带自身哈希）。若上面五个对得上、整包也对得上，说明这个包从发布到现在没被动过；对不上就**先不要运行**，回到发布页核对来源。

另外重申一句：本包 **零二进制、零第三方依赖**（`node:` 内置模块 + 包内文件），25 个文件里没有可执行体；运行后多出来的两个 jpg 是 `scripts/test/fixtures/fixtures.html` 解包的测试样张，不是随包发的。