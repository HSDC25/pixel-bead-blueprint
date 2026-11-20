# pixel-bead-blueprint（像素事务所）

> 给 AI 助手装上「拼豆老师」：上传任意图片 → 一份**能开工**的拼豆图纸（色号表 / 施工图 / 逐格矩阵 / 采购清单），再陪你拼、验收、复盘、回收库存。

- **零第三方依赖**（只用 `node:` 内置模块）｜**零二进制**｜**运行时不联网**｜只写输出目录
- Agent Skill 规范：`SKILL.md` + `scripts/` + `references/` + `assets/`，兼容 Claude Code / Codex / Cursor / OpenCode / Copilot 等支持 skills 的智能体
- 当前版本 **v1.4.0**，包内 **24 个文件**

## 安装

**方式一：skills CLI（Vercel，支持 79 个智能体）**

```bash
# 装到当前项目
npx skills add <your-github-user>/pixel-bead-blueprint

# 全局安装（所有项目可用）
npx skills add <your-github-user>/pixel-bead-blueprint -g

# 指定智能体
npx skills add <your-github-user>/pixel-bead-blueprint -a claude-code
```

**方式二：GitHub CLI（官方 `gh skill install`）**

```bash
gh skill install <your-github-user>/pixel-bead-blueprint
gh skill install <your-github-user>/pixel-bead-blueprint --agent claude-code --scope user
gh skill install <your-github-user>/pixel-bead-blueprint --pin v1.4.0   # 锁版本
```

**方式三：手动**

```bash
git clone https://github.com/<your-github-user>/pixel-bead-blueprint.git
cp -r pixel-bead-blueprint/skills/pixel-bead-blueprint ~/.claude/skills/   # 或对应智能体的 skills 目录
```

## 用它（对 AI 说话即可，不用敲命令）

| 你说 | 它做 |
|---|---|
| 「把这张照片变成拼豆图纸」 | 选网格、试 5 组参数、出全套图纸与采购清单 |
| 「教我拼拼豆 / 陪我拼」 | 六步辅导环：先问经验档位 → 排工时场次 → 每场验收 |
| 「只用我手里有的颜色出图」 | 扫成品照/色卡 → 识别色号 → 限定色盘生成 → 列缺色采购 |
| 「我拼到第 3 场了，帮我验一下」 | 按 ASCII 矩阵逐行核数 / 分块对号 |

## 交付物（`--teach` 模式实测 10 件）

```
blueprint.md       色号表 + 采购清单（颗数 / 占比 / 包数）
sheet.png          施工图纸（网格 + 行列编号 + 逐格色号 + 图例）
compare.png        原图 vs 拼豆效果并排
blueprint.png      逐格直映预览
review.png         红框 ≤12 处：机器可疑点定位
review.md          逐框判定表（AI 填写；空表会被程序闸门拒绝交付）
refine.md          5 组参数迭代报告（含各轮得分）
coaching.md        陪拼计划（难度 / 工时 / 场次 / 校验点 / 易错点）
blueprint.json     逐格色号矩阵（机读）
blueprint-ascii.txt 文本矩阵（可逐行核数）
```

## 自证与评测

```bash
node --test scripts/test/run.js      # 回归测试：57 项全过
node evals/run-evals.cjs             # 评测集：6 项 CLI 用例 + 2 项人工验收 → BENCHMARK.md
```

| 维度 | 现状 |
|---|---|
| 回归测试 | 57 / 57 pass |
| 评测集 | CLI 6 / 6 pass，另有 2 项大模型在环人工验收 |
| 完整性 | 关键文件 SHA256 见 `skills/pixel-bead-blueprint/assets/README.md` |
| 交付门禁 | 空判定表 → `REVIEW_UNFILLED` + exit 3；填完 → `REVIEW_SIGNED` + exit 0 |
| 第三方认证 | **无**（详见 `skills/pixel-bead-blueprint/skill-card.md` 的验证状态表） |

## 目录结构

```
pixel-bead-blueprint/                    ← 仓库根
├── README.md                            ← 本文件
├── LICENSE                               ← MIT
├── .gitignore
└── skills/
    └── pixel-bead-blueprint/             ← 技能本体（被 npx skills / gh skill 发现）
        ├── SKILL.md                      ← 入口（frontmatter: name/description/version）
        ├── skill-card.md                 ← 信任记录：权限矩阵 / 风险 / 验证状态
        ├── package.json
        ├── assets/                       ← 上手指南 + 评审 README（含 SHA256）+ 示例
        ├── references/                   ← 算法 .js / 辅导协议 / palettes.json（5 套色盘合并）
        ├── scripts/                      ← run.js（CLI）+ test/（回归测试 + 样张载体）
        ├── test-cases/                   ← cases.md（功能判据 + 场景剧本 + 触发语）+ trigger.md
        └── evals/                        ← evals.json + run-evals.cjs + BENCHMARK.md
```

## 题材边界（如实说明）

只擅长**简笔画 / 扁平插画 / 几何构图**；照片与渐变量化后「形」会散。色值为工程预置近似值，采购前建议用实体色卡校准。完整边界见 `SKILL.md`「边界声明」与「安全边界」。

## 许可

代码与文档：MIT（见 `LICENSE`）。
色盘数据：MARD / Perler / Artkal 公开品牌标准，均为 MIT 来源，逐条列于 `references/palette-sources.md`。