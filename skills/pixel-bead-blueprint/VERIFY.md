# 验签说明 — skill.oms.sig

本技能目录带一份**分离签名** `skill.oms.sig`，格式为 **OpenSSF Model Signing (OMS)**，
覆盖目录内每个文件与子目录（签名文件本身除外）。任何人都可以离线验证「拿到的目录 == 发布时签过的目录」。

> ⚠️ **签名能证明什么、不能证明什么**
> - 能证明：**完整性 + 来源一致性**（目录没被改过，且由持有该证书私钥的人签出）。
> - 不能证明：代码安全、质量合格、获得官方认证。本签名使用**自签证书**，不是第三方 CA 或官方目录徽章。
> - 安全边界与风险请读 `skill-card.md`；行为判据请读 `test-cases/cases.md`。

## 签名信息

| 项 | 值 |
|---|---|
| 签名格式 | OpenSSF Model Signing（OMS / Sigstore bundle，分离签名） |
| PKI 方式 | `certificate`（X.509，自签） |
| 签署主体 | `CN=Pixel Studio Skill Signing, O=Pixel Studio, C=CN` |
| 证书文件 | `pki/pixel-studio-skill-cert.pem`（仓库根，可公开） |
| 证书指纹（SHA256） | `4A:56:E5:FA:FB:41:A2:00:F6:B1:E0:7E:88:68:AA:AE:16:13:EA:C3:E2:E1:38:E4:48:60:23:1D:1B:5D:01:24` |
| 有效期 | 10 年（2026-11-21 签发） |
| 签名算法 | **ECDSA P-256 / SHA-256**（注意：model-signing 的 certificate 模式不支持 RSA 密钥） |

私钥**不在本目录、不在仓库内**（保存于发布者本机受控路径）。仅公钥证书公开。

## 怎么验（三步，离线可跑）

```bash
# 1) 安装官方验证器
pip install model-signing

# 2) 取证书（已在仓库根）
curl -O https://raw.githubusercontent.com/<your-github-user>/pixel-bead-blueprint/main/pki/pixel-studio-skill-cert.pem

# 3) 对已下载的技能目录验签（严格模式：多一个未签名文件即失败）
python -m model_signing verify certificate skills/pixel-bead-blueprint \
  --signature skills/pixel-bead-blueprint/skill.oms.sig \
  --certificate_chain pixel-studio-skill-cert.pem
```

输出 `Verification success` 即通过；若提示 `signature verification failed`，说明目录内容与签名不一致（可能被改动或签名后重跑过评测）。

宽容模式（允许签名后新增未签名文件，仅用于排查）：

```bash
python -m model_signing verify certificate skills/pixel-bead-blueprint \
  --signature skills/pixel-bead-blueprint/skill.oms.sig \
  --certificate_chain pixel-studio-skill-cert.pem \
  --ignore_unsigned_files
```

## 什么时候需要重新签名

任何文件改动都会让严格验签失败，因此下列操作后必须重新签名：

1. 修改 `SKILL.md` / 脚本 / 文档 / 色盘；
2. 重跑 `node evals/run-evals.cjs`（会覆盖 `evals/BENCHMARK.md`）；
3. 重跑 `node --test scripts/test/run.js` 若产物落进技能目录（正常情况落在临时目录，不会）。

重新签名（发布者本机）：

```bash
python -m model_signing sign certificate skills/pixel-bead-blueprint \
  --signature skills/pixel-bead-blueprint/skill.oms.sig \
  --private_key <本机私钥.pem> \
  --signing_certificate pki/pixel-studio-skill-cert.pem \
  --certificate_chain pki/pixel-studio-skill-cert.pem
```

## 实测坑（model-signing 1.1.1）

1. **certificate 模式必须同时传 `--certificate_chain`**。只传 `--signing_certificate` 会报
   `Unable to load PEM file ... MalformedFraming`（内部走到私钥加载分支），并非证书有问题。
2. **不支持 RSA 密钥**：RSA 会报 `RSAPublicKey object has no attribute 'curve'`，请用 ECDSA P-256。
3. 参数名是下划线：`--certificate_chain` / `--signing_certificate` / `--private_key`（写成中划线会被拒绝）。

## 已知取舍

| 项 | 现状 | 想升级要做什么 |
|---|---|---|
| 证书可信度 | **自签**：验签能确认「未被改动」，但「发布者是谁」需要你自己信任本仓库 | 用组织 CA / 公共 CA 签发，或接入 Sigstore keyless（OIDC 身份） |
| 透明度日志 | 未上传 Rekor | `--upload` 走 Sigstore 透明日志，可公开审计签名时间 |
| 证书吊销 | 无 CRL/OCSP 流程 | 引入公网 CA 或企业 PKI |
| 第三方安全扫描 | 未做 | 接入 SkillSpector 等扫描并附报告 |