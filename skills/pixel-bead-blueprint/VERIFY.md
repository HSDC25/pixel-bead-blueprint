# 签名与验签说明（签名文件在 GitHub，不随平台包提交）

> **本平台提交包共 25 个文件，不含 `skill.oms.sig`**（平台白名单不收 `.sig`）。
> 签名文件 `skill.oms.sig` 与证书放在 GitHub 仓库，任何人可离线验签 —— 下面给出完整步骤。
> 换句话说：**包本身可验（SHA256 / 回归测试 / 评测），签名可验（GitHub 下载后）**，两者互不依赖。

## 签名覆盖什么

GitHub 分发的技能目录带一份分离签名 `skill.oms.sig`，格式为 **OpenSSF Model Signing (OMS)**，
覆盖目录内每个文件与子目录（签名文件本身除外）。可以验证「下载到的目录 == 发布时签过的目录」。

> ⚠️ 签名能证明什么、不能证明什么
> - 能证明：**完整性 + 来源一致性**（目录没被改过，且由持有该证书私钥的人签出）。
> - 不能证明：代码安全、质量合格、获得官方认证。本签名使用**自签证书**。
> - 安全边界与风险见 `skill-card.md`；行为判据见 `test-cases/cases.md`。

## 签名信息

| 项 | 值 |
|---|---|
| 签名格式 | OpenSSF Model Signing（Sigstore bundle，分离签名） |
| PKI 方式 | `certificate`（X.509 自签） |
| 签署主体 | `CN=Pixel Studio Skill Signing, O=Pixel Studio, C=CN` |
| 证书文件 | GitHub 仓库根 `pki/pixel-studio-skill-cert.pem` |
| 证书指纹（SHA256） | `4A:56:E5:FA:FB:41:A2:00:F6:B1:E0:7E:88:68:AA:AE:16:13:EA:C3:E2:E1:38:E4:48:60:23:1D:1B:5D:01:24` |
| 签名算法 | **ECDSA P-256 / SHA-256** |
| 有效期 | 10 年（2026-11-21 签发） |

私钥不在仓库、不在任何提交包内。

## 怎么验（三步，离线可跑）

```bash
# 1) 安装官方验证器
pip install model-signing

# 2) 从 GitHub 取「带签名的技能目录」与证书
git clone https://github.com/<your-github-user>/pixel-bead-blueprint.git
cd pixel-bead-blueprint

# 3) 验签（严格模式：多一个未签名文件即失败）
python -m model_signing verify certificate skills/pixel-bead-blueprint \
  --signature skills/pixel-bead-blueprint/skill.oms.sig \
  --certificate_chain pki/pixel-studio-skill-cert.pem \
  --ignore-paths pixel-bead-output \
  --ignore-paths scripts/test/fixtures/mondrian-1930-cii-original.jpg \
  --ignore-paths scripts/test/fixtures/progressive-mondrian.jpg
```

输出 `Verification succeeded` 即通过。

## 签名忽略路径（重要）

签名时**显式忽略**三类「跑一次就会多出来」的文件，否则验签永远失败：

| 忽略路径 | 为什么 |
|---|---|
| `pixel-bead-output/` | CLI 默认输出目录，跑一次生成 9 个文件 |
| `scripts/test/fixtures/mondrian-1930-cii-original.jpg` | 回归测试首次运行时从 `fixtures.html` 解包 |
| `scripts/test/fixtures/progressive-mondrian.jpg` | 同上 |

因此：**跑过测试/评测之后再验签也应通过**（这些路径不参与比对）。平台提交包本来就不含这些文件。

## 不靠签名也能验的东西（包内自带）

```bash
node --test scripts/test/run.js     # 回归测试 57 项（实测 57/57）
node evals/run-evals.js             # 评测 6 项 CLI（实测 6/6）+ 2 项人工验收
```

关键文件 SHA256 见 `assets/README.md` 文末「完整性校验」。

## 实测坑（model-signing 1.1.1）

1. **certificate 模式必须同时传 `--certificate_chain`**，只传 `--signing_certificate` 会报
   `Unable to load PEM file ... MalformedFraming`。
2. **不支持 RSA**：报 `RSAPublicKey object has no attribute 'curve'`，必须用 ECDSA P-256。
3. 证书必须带 **KeyUsage / ExtendedKeyUsage**，否则报 `Signing certificate cannot be used for signing`。
4. 参数名是下划线：`--certificate_chain` / `--signing_certificate` / `--private_key`。

## 已知取舍

| 项 | 现状 | 升级路径 |
|---|---|---|
| 证书可信度 | **自签**：能证「未被改动」，「发布者是谁」需自行信任本仓库 | 用组织/公共 CA 签发，或 Sigstore keyless（OIDC 身份） |
| 透明度日志 | 未上传 Rekor | `--upload` 走 Sigstore 透明日志，可公开审计签名时间 |
| 证书吊销 | 无 CRL/OCSP | 引入公网 CA 或企业 PKI |
| 平台包是否含签名 | **不含**（白名单限制），签名随 GitHub 分发 | 若平台后续支持 `.sig`，可直接把仓库里的同名文件一并提交 |