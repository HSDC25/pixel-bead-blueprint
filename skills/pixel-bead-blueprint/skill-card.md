# Skill Card — pixel-bead-blueprint

> 机器可读/人可读的信任记录。格式参考 NVIDIA Verified Agent Skills 的 skill card 字段，
> 但**本 skill 未经 NVIDIA 或任何第三方认证**（见「验证状态」一节，不夸大）。

## 1. 身份

| 字段 | 值 |
|---|---|
| name | `pixel-bead-blueprint`（像素事务所） |
| version | `1.5.0`（2026-11-21） |
| 类型 | Agent Skill（Anthropic Agent Skills 规范：`SKILL.md` + `scripts/` + `references/` + `assets/`） |
| 所有者 / 作者 | 像素事务所（个人开发者，作者本人维护） |
| 分发渠道 | 小红书 Red Skill 商店（`redskill`）；GitHub 仓库**尚未建立** |
| 许可证 | 包内未附独立 LICENSE 文件；色盘数据为 MIT（见 §7）。使用条款以发布页说明为准 |

## 2. 一句话用途

上传任意图片 → 生成**能开工**的拼豆图纸（色号表 / 施工图 / 逐格矩阵 / 采购清单），并以「拼豆老师」身份陪拼、验收、复盘、回收库存。

## 3. 触发方式

- 「教我拼拼豆」「陪我拼」「当我的拼豆老师」
- 「把这张照片变成拼豆图纸」「生成像素画图纸」
- 「拼豆色号表」「像素画采购清单」
- 「识别这张成品 / 色卡用了哪些色号」「只用我手里有的颜色生成图纸」

## 4. 输入 / 输出

| | 内容 |
|---|---|
| 输入 | 照片 / 截图 / 手绘 / AI 生成图（JPEG baseline / progressive、PNG 8-bit）；成品照或色卡截图（库存模式） |
| 输出（默认 10 个文件，`--teach` 模式实测） | `blueprint.md`（色号表+采购清单）· `sheet.png`（施工图纸）· `compare.png` · `blueprint.png` · `review.png` / `review.md`（终审图与判定表）· `refine.md` · `coaching.md` · `blueprint.json` · `blueprint-ascii.txt` |
| 输出位置 | 只写 `--out` 指定目录；默认 `./pixel-bead-output/<图名>-g<网格>/` |

## 5. 依赖与运行环境

| 项 | 事实 |
|---|---|
| 运行时 | Node.js ≥ 18（只用 `node:` 内置模块） |
| 第三方依赖 | **0**（不需要 `npm install`） |
| 包内二进制 | **0**（测试样张以 base64 内联在 `scripts/test/fixtures/fixtures.html`，首次运行时才解包） |
| 包内文件数 | **26**（含本技能卡、`VERIFY.md`、`skill.oms.sig` 与 `evals/` 三件；全为文本与源码），上限 30，尚余 4 |
| 外部服务 | 无 |

## 6. 权限矩阵（装它等于交出去什么）

| 维度 | 事实 | 自核命令 |
|---|---|---|
| 读 | 只读你显式传入的图片 + 包内文件 | `grep -rhoE "from '[^']+'" scripts/*.js references/*.js \| sort -u` |
| 写 | 只写 `--out` 目录（含默认输出目录） | 见 `scripts/run.js` 的 `outDir` |
| 网络 | **无任何网络调用**（无 http / https / fetch / socket） | `grep -rn "fetch(\|require('http\|net\.connect" references scripts` |
| 子进程 | 生产入口 `scripts/run.js` 不调用 `child_process`；仅测试跑器会拉起本包自己的 node 进程 | `grep -rn child_process scripts references` |
| 系统权限 | 不需要管理员/root，不写系统目录，不改环境变量 | — |

> 「不联网」指**运行时**：安装过程（访问 Red Skill 商店、可能安装 Node）当然联网，那是安装器的行为，不是本 skill 的运行时行为。

## 7. 已知限制与风险

| 风险 / 限制 | 影响 | 缓解 |
|---|---|---|
| 题材边界 | 只擅长**简笔画 / 扁平插画 / 几何构图**；**照片与渐变必然散**（量化后「形」会丢） | SKILL.md 已写明题材边界；不适配时如实告知，不硬出图 |
| 色值为预置近似值 | 不等于实体豆在特定光源下的测色值，可能买错相近色 | 提示用实体色卡校准；`--maxcolors` + 近重复合并（ΔE≤3）压掉肉眼不可分色 |
| 无视觉能力的 Agent | 无法完成「视觉终审」，只能出图不能判真假 | 交付门禁会拦下空表（`REVIEW_UNFILLED`），并与实说明「请自己看终审图」 |
| 色号数据来源 | 来自公开品牌标准（MARD / Perler / Artkal），非实验室测量 | `references/palette-sources.md` 列明来源与 MIT 许可 |
| 大图资源占用 | 整张施工图 > 64MP 自动跳过并提示 `--split` | 分块索引 + 按需出块，防 OOM |
| 输出为工程文件 | 不提供原料采购链接，不做图像分割 | 边界声明已写明（见 SKILL.md「边界声明」） |

## 8. 可验证证据（自证，不依赖信任）

| 证据 | 位置 / 方式 |
|---|---|
| 关键文件 SHA256 | `assets/README.md` 文末「完整性校验」；整包哈希以发布页 zip SHA256 为准 |
| 零依赖 / 零联网 / 零二进制 | §6 的三条 `grep` 命令可逐条复核 |
| 回归测试 | `scripts/test/run.js`：**实测 tests 57 / pass 57 / fail 0**（2026-11-21 复跑，约 18s） |
| 文件数合规 | `Get-ChildItem -Recurse -File` 实测 **25 个**（≤30），2026-11-21 合并 `test-cases` 8→2 后达标 |
| 交付门禁可复现 | 不填 `review.md` → `REVIEW_UNFILLED` + exit 3；填完 → `REVIEW_SIGNED` + exit 0 |
| 产出可复现 | 同一输入重跑，`compare/sheet/review/blueprint.*` 逐字节一致（2026-11-18 实测 7 个文件 hash 相同） |

## 9. 验证状态（重要，勿误读）

| 项 | 状态 |
|---|---|
| 第三方安全扫描（如 SkillSpector） | **未做** |
| 真实 Agent 沙箱评测（`evals/evals.json` + BENCHMARK） | **未做**（仅有 `test-cases/` 人工用例 5 组 + 触发用例） |
| 目录级加密签名（OMS `skill.oms.sig`） | ✅ **已签**（自签证书，2026-11-21）→ 验签见 `VERIFY.md` |
| 官方目录认证（NVIDIA Verified 等） | **无** |
| 自证完整性 | ✅ 有（SHA256 + 门禁 + 可复现） |

> 结论：本 skill 目前属于**「自证可信」级别**（作者公开事实、任何人可复核），
> 不是「第三方认证」级别。任何宣传口径都不应写成「已通过安全认证」。

## 10. 想升级到「第三方可验」需要补什么

1. `skill-card.md`（本文件，已有）
2. `evals/evals.json` + `BENCHMARK.md`（把 `test-cases/` 转成可跑评测）
3. ~~目录级签名：`skill.oms.sig` + 发布者证书链 + 验签说明~~ → **已完成（自签）**：`skill.oms.sig` + `VERIFY.md`；升级路线是用公共 CA / Sigstore keyless + Rekor 透明日志
4. GitHub 仓库（`skills/pixel-bead-blueprint/SKILL.md` 结构）→ 可被 `npx skills add` / `gh skill install` 安装

---
*本卡片随 v1.5.0 维护。任何字段与实际不符，以包内文件与实测输出为准。*