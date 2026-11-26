# pixel-bead-blueprint（像素事务所）

> 给 AI 助手装上「拼豆老师」：上传任意图片，生成一份能开工的拼豆图纸（色号表 / 施工图 / 逐格矩阵 / 采购清单），再陪你拼、验收、复盘、回收库存。

- 零第三方运行时依赖（只用 `node:` 内置模块）
- 零二进制、运行时不联网、只写输出目录
- Agent Skill 规范：`SKILL.md` + `scripts/` + `references/` + `assets/`
- 当前版本 **v1.5.3**，技能包 **27 个文件**（MIT）
- 兼容支持 skills 的智能体；本赛事使用华为云码道 CodeArts

## 安装

**Windows：一句话交给 AI，环境也由 AI 配齐**

把下面这句原样发给 AI：

> 请帮我安装 pixel-bead-blueprint。先阅读仓库 README 的「AI 安装协作」步骤，使用仓库根目录的 `ai-one-shot.ps1` 和 `verify-signature.ps1`，加上 `-InstallDependencies`；不要跳过验签，也不要把测试产物装进技能目录。遇到 UAC 或公司策略拦截就停下来告诉我。装完报告版本、安装路径、旧版备份路径和自检结果。

### AI 安装协作（必须遵循）

1. 使用 **PowerShell 7**。若本机没有 `pwsh`，先安装：

   ```powershell
   winget install --id Microsoft.PowerShell --exact --source winget --accept-package-agreements --accept-source-agreements
   ```

2. 从发布页或用户提供的路径取得 `pixel-bead-blueprint-v1.5.3-提交版.zip`（仓库本身不存放发布 zip），不要用编辑器保存或转换换行；发布 zip 保留签名所需的 LF 字节。
3. 在仓库根目录执行：

   ```powershell
   pwsh -NoProfile -ExecutionPolicy Bypass -File .\ai-one-shot.ps1 `
     -Zip .\pixel-bead-blueprint-v1.5.3-提交版.zip -InstallDependencies
   ```

   zip 不在仓库根目录时，把 `-Zip` 改成完整路径。
4. 脚本会按需安装 Node.js LTS、创建独立 Python 虚拟环境并安装 `model-signing==1.1.1`，然后依次完成：**严格验签 → 临时副本跑 57 项回归与 6 项 CLI 评测 → 真实安装 → 旧版备份**。任何一步失败都返回非零并停止。
5. 向用户回报实际结果，不要把“安装成功”当成“已通过安全认证”。

安装脚本位于仓库根目录，不占 Skill 的 27 个文件配额；`SKILL.md` 只有安装后才会加载，不能充当首次安装入口。若系统没有 winget / Chocolatey，或 UAC、公司策略拒绝安装依赖，AI 应如实停下并说明缺少什么。

**便捷安装：skills CLI**

```bash
npx skills add HSDC25/pixel-bead-blueprint
npx skills add HSDC25/pixel-bead-blueprint -g
npx skills add HSDC25/pixel-bead-blueprint -a claude-code
```

**便捷安装：GitHub CLI**

```bash
gh skill install HSDC25/pixel-bead-blueprint
gh skill install HSDC25/pixel-bead-blueprint --agent claude-code --scope user
gh skill install HSDC25/pixel-bead-blueprint --pin v1.5.3
```

`npx` / `gh skill install` 只负责便捷安装，**不会自动验签**。装完请再跑一次 `verify-signature.ps1 -Path <安装目录>`（或 `verify-signature.sh`）；需要“先验签再安装 + 备份旧版”时使用上面的 AI 一键路径。

**手动：Git clone**

```bash
git clone git@github.com:HSDC25/pixel-bead-blueprint.git
cp -r pixel-bead-blueprint/skills/pixel-bead-blueprint ~/.claude/skills/
```

### Windows 与 LF / CRLF

签名覆盖文件原始字节，因此 LF 改成 CRLF 也会导致验签失败。本仓库已加入：

```text
* text=auto eol=lf
```

遵循 `.gitattributes` 的 Git checkout 应保持 LF；重签脚本发现 CRLF 会直接拒绝。Windows 最稳妥的分发方式仍是发布 zip 解压，避免客户端或安装工具自行转换换行。验签脚本不会做换行归一化，避免把被篡改文件「修成可验」。

## 用它（对 AI 说话即可，不用敲命令）

| 你说 | 它做 |
|---|---|
| 「把这张照片变成拼豆图纸」 | 选网格、试 5 组参数，出全套图纸与采购清单 |
| 「教我拼拼豆 / 陪我拼」 | 六步辅导环：先问经验档位，再排工时场次，每场验收 |
| 「只用我手里有的颜色出图」 | 扫成品照 / 色卡，识别色号，限定色盘生成，列缺色采购 |
| 「我拼到第 3 场了，帮我验一下」 | 按 ASCII 矩阵逐行核数，分块对号 |

## 交付物（`--teach` 模式实测 10 件）

```text
blueprint.md        色号表 + 采购清单（颗数 / 占比 / 包数）
sheet.png           施工图纸（网格 + 行列编号 + 逐格色号 + 图例）
compare.png         原图 vs 拼豆效果并排
blueprint.png       逐格直映预览
review.png          红框：机器可疑点定位
review.md           逐框判定表（空表会被程序闸门拒绝交付）
refine.md           5 组参数迭代报告（含各轮得分）
coaching.md         陪拼计划（难度 / 工时 / 场次 / 校验点 / 易错点）
blueprint.json      逐格色号矩阵（机读）
blueprint-ascii.txt 文本矩阵（可逐行核数）
```

## 仓库防投毒

仓库按“改动必须留痕、发布必须可验”配置：

- `main` 禁止强推与删除，要求线性历史；`v*` 标签禁止移动与删除
- Secret scanning 与 push protection 已开启
- Actions 只允许 GitHub 官方 action，且必须固定到完整 commit SHA；工作流令牌默认只读
- CI 在每次 push / PR 时先严格验签，再跑 57 项回归与 6 项 CLI 评测
- 漏洞报告走 GitHub 私密渠道，见 [SECURITY.md](SECURITY.md)

这层防护只保证“仓库里的技能包没被悄悄改过”；它不等于第三方安全认证。

## 签名与信任链

`SIGNATURE.md` 内嵌 OMS 签名和自签证书的 base64。签名使用 ECDSA P-256 / SHA-256；证书包含 KeyUsage 与 codeSigning ExtendedKeyUsage。

可信证书 DER SHA-256 指纹固定为：

```text
4A56E5FAFB41A200F6B1E07E8868AAAE1613EAC3E2E138E44860231D1B5D0124
```

PowerShell 7：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\verify-signature.ps1 `
  -Path .\skills\pixel-bead-blueprint
```

Bash：

```bash
PYTHON=python ./verify-signature.sh ./skills/pixel-bead-blueprint
```

验签流程：

1. 从 `SIGNATURE.md` 解析并还原签名、证书，拒绝重复或缺失块。
2. 比对固定证书指纹；不可信证书直接拒绝。
3. 复制技能到临时目录，只排除 `SIGNATURE.md` 自身。
4. 调用 `model-signing` 严格验签，显式使用 `--no-ignore-git-paths --no-ignore_unsigned_files`；提交包不含 `.gitattributes`，LF 由仓库根属性保证。
5. 不修改被检目录；临时文件自动清理。

因此下列情况都会被拒绝：已签文件被修改、包内新增文件、证书被替换、文本 LF 被转成 CRLF。私钥不进入发布包；签名仅以 `SIGNATURE.md` 内嵌形式分发，私钥不进入公开仓库。

## 自证与评测

顺序必须是 **先验签，再跑测试 / 评测**。评测会更新 `BENCHMARK.md`，签后运行会导致该文件哈希不符。

```powershell
# 在技能目录执行
node --test --test-reporter=tap scripts/test/run.js
node evals/run-evals.js
```

| 维度 | 现状 |
|---|---|
| 回归测试 | 57 / 57 pass |
| 评测集 | 6 / 6 CLI pass，另有 2 项大模型在环人工验收 |
| 最终 zip 评测耗时 | 13.0 秒 |
| 完整性 | 关键文件 SHA256 见 `skills/pixel-bead-blueprint/assets/README.md` |
| 交付门禁 | 空判定表返回 `REVIEW_UNFILLED` / exit 3；填完返回 `REVIEW_SIGNED` / exit 0 |
| 目录级签名 | OMS 自签，固定证书指纹，严格拒绝新增文件 |
| 第三方认证 | 无；自证不等于安全认证或官方认证 |

## 正式提交包

```text
文件：pixel-bead-blueprint-v1.5.3-提交版.zip
文件数：27
zip 大小：2,498,470 B（约 2.38 MiB）
解压大小：3,608,780 B（约 3.44 MiB）
SHA256：b5db06313bb5e7d09816b82ae11958ee81fdfefc5c4e4a4c55c25634bcac5e0b
```

最终 zip 已解压复核：严格验签通过，57/57 回归通过，6/6 CLI 评测通过。

## 目录结构

```text
pixel-bead-blueprint/
├── README.md
├── LICENSE
├── .gitattributes
├── .gitignore
├── ai-one-shot.ps1
├── verify-signature.ps1
├── verify-signature.sh
├── pki/                             公开自签证书，不含私钥
└── skills/
    └── pixel-bead-blueprint/
        ├── SKILL.md                 入口（name / description / version）
        ├── SIGNATURE.md             签名与证书载体
        ├── VERIFY.md                验签、LF/CRLF 与重签说明
        ├── skill-card.md            权限矩阵 / 风险 / 验证状态
        ├── package.json
        ├── LICENSE.md                MIT 许可证
        ├── assets/                  上手指南 + 哈希 + 示例
        ├── references/              算法 / 辅导协议 / 5 套色盘
        ├── scripts/                 CLI + 回归测试 + 样张载体
        ├── test-cases/              功能判据 + 场景剧本 + 触发语
        └── evals/                   evals.json + runner + BENCHMARK.md
```

## 题材边界

只擅长简笔画 / 扁平插画 / 几何构图；照片与渐变量化后「形」可能散。色值为工程预置近似值，采购前建议用实体色卡校准。完整边界见 `SKILL.md`。

## 许可

代码与文档：MIT（见仓库根目录 `LICENSE` 与技能包内 `LICENSE.md`）。
色盘数据：MARD / Perler / Artkal 公开品牌标准，来源逐条列于 `references/palette-sources.md`。
