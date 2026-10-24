# pixel-bead-blueprint · AI 拼豆辅导 Skill 🧩

**让 AI 变成拼豆老师**：发一张图，还你一套「照着就能拼」的完整图纸——色号表、施工图纸、采购清单、分块索引，外加从难度评定到完工复盘的全流程陪拼。

> 面向 Agent Skill 规范（SKILL.md + 自动化测试 + 触发语表）；纯 JS 零第三方依赖，Node ≥ 18 即可跑。

---

## ✨ 它能做什么

| 能力 | 你说什么 | AI 做什么 |
|---|---|---|
| 🖼️ 图纸生成 | 「把这张照片做成拼豆图纸」 | 色号表 + 施工图纸 + 采购清单 + 拼豆预览，一次出齐 |
| 🧑‍🏫 全程陪拼 | 「教我拼拼豆」「陪我拼」 | 评难度、排工时、分场次、每场验收、卡住了给提示 |
| 📦 库存回收 | 「这些是我手里的豆，用这些拼」 | 从成品照/色卡截图认色号，**只用你有的颜色**出图，缺的列采购单 |
| 👀 多模态终审 | 「帮我看看像不像」 | 机器把可疑格画红框，AI 看图逐框判定，判定表落盘可审计 |

内置 5 套色盘：**MARD 221 / MARD 291 / Perler 118 / Artkal C 188 / Artkal M 220**。

## 🚀 30 秒上手

```bash
# 在技能包根目录执行（AI 助手会自动完成下面的流程）
node scripts/run.mjs 你的图片.png --grid 64
```

跑完 `./pixel-bead-output/<图名>-g64/` 里有 9 个文件，你只需要打开 3 个：

- `blueprint.md` —— 色号表 + 采购清单（照着买豆）
- `sheet.png` —— 施工图纸（网格线 + 行列编号 + 逐格色号，对着拼）
- `compare.png` —— 原图 vs 拼豆效果并排（验收）

更完整的保姆级教程（含库存闭环、故障排查表、名词解释）：**[docs/小白上手指南.md](docs/小白上手指南.md)**

## 🔍 为什么「AI 在环」不是噱头

很多「AI 技能」只让 AI 填表，本 skill 把多模态能力做成了硬结构：

1. **机器保底**（`--refine`，默认开）：自动试 5 组参数，逐格比对原图打分（颜色 ΔE / 断线率 / 平色块劈叉），选最优，报告落盘 `refine.md`
2. **视觉终审**（`review.png`，硬门槛）：机器把最可疑的 ≤12 处**画红框**，AI 必须看图逐框判定「真缺陷 / 误报」并填写 `review.md` 判定表——填完的表就是「AI 真的看过图」的可审计证据
3. **对人诚实**：3 轮修不好的缺陷必须明说「还差什么、为什么、有什么选择」；复杂画面在出图前就打印如实声明（边缘密度 / 色彩熵 / 平色占比三判据）

拼豆真实甜区是「形」的工艺（简笔画 / 几何构成 / Logo）；名画与照片类源会在出图前收到预期落差预警。

## 🧭 两条工作流

```text
工作流 A（图纸 + 辅导）：图片 + 参数 → 色号表/施工图纸/ASCII 矩阵/统计/采购清单
                          → coaching.md 辅导计划 → AI 陪拼 → 复盘 → 库存回收 ↺
工作流 B（库存提取）：拼豆成品照/色卡截图 → 门禁 → 网格检测 → 取色 → 色号
                      → 库存色盘 → 限定色生成 → 只补缺采购 ↺
```

常用命令（更多见 `SKILL.md` 参数表）：

```bash
node scripts/run.mjs 图.png --grid 64 --teach                 # 出图 + 辅导计划
node scripts/run.mjs 豆子照片.jpg --scan 库存.json             # 提取库存
node scripts/run.mjs 想拼的图.png --inventory 库存.json        # 库存限定 + 缺色分析
node scripts/run.mjs 大图.png --grid 96 --split 52            # 分块图纸
node --test scripts/test/run.mjs                              # 51 项自检
```

## 📁 目录结构

```
pixel-bead-blueprint/
├── SKILL.md            ← skill 定义（frontmatter + 参数表 + 复现命令 + 边界声明）
├── assets/             ← 提交包说明 + 示例图纸三件套
├── docs/               ← 小白上手指南
├── references/         ← 5 套色盘 JSON + 算法模块（量化/取证/教学）+ 辅导协议
├── scripts/            ← run.mjs（CLI 入口）+ test/（51 项自动化测试 + 样张）
└── test-cases/         ← 触发语表 + 功能用例 + 叙述式场景剧本 ×5
```

## 🔒 隐私与边界（如实声明）

- 全程**离线**运行：不上传图片、不调用外部服务、无遥测
- 色值为工程预置近似值，不等于实体豆测色值，采购前建议用实体色卡校准
- 不支持 16-bit / 隔行 PNG（会报可读错误）；纯主体抠图请自行预处理透明 PNG
- 输出图纸，不提供原料采购链接

## 📄 许可与致谢

- 代码：MIT（见 [LICENSE](LICENSE)）
- 色号数据：[HansBug/pindou-color-data](https://github.com/HansBug/pindou-color-data)（MARD，MIT）、[jsspace/bead-colors](https://github.com/jsspace/bead-colors)（Perler / Artkal，MIT），来源与许可全文见 [references/palette-sources.md](references/palette-sources.md)
