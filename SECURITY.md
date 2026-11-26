# 安全策略

## 支持范围

| 版本 | 安全更新 |
|---|---|
| 1.5.3 | 支持 |
| < 1.5.3 | 不支持 |

## 报告漏洞

请使用 GitHub 私密漏洞报告，不要开公开 issue：

https://github.com/HSDC25/pixel-bead-blueprint/security/advisories/new

请附版本、复现步骤和影响；不要在报告里放真实令牌、私钥或他人个人信息。

## 威胁模型

- 仓库或维护者账号被接管，向技能包注入代码
- 恶意 PR、误操作或供应链改动进入 `main`
- 发布包被替换，或签名、证书、文件列表被改动
- 用户用 `npx` / `gh skill install` 安装时跳过验签

## 仓库侧防护

- `main` 只接受 PR，`verify` 检查必须通过，提交必须签名；禁止强推、删除与合并提交
- `v*` 标签禁止移动与删除；Release 不可变
- Secret scanning 与 push protection 已开启
- Actions 只允许 GitHub 官方 action，且必须固定到完整 commit SHA
- 工作流令牌默认只读
- CI 在每次 push / PR 时先严格验签，再跑回归与评测

维护者使用已登记为 Signing Key 的 SSH 密钥提交；GitHub 网页提交由 GitHub 自动签名。直接向 `main` 推送会被规则集拒绝。

## 用户侧核验

发布 zip 是首选分发形态。`npx` / `gh skill install` 只负责复制文件，**不会自动验签**；装完必须再跑一次：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\verify-signature.ps1 `
  -Path <安装目录>
```

```bash
PYTHON=python ./verify-signature.sh <安装目录>
```

可信证书 DER SHA-256 指纹固定为：

```text
4A56E5FAFB41A200F6B1E07E8868AAAE1613EAC3E2E138E44860231D1B5D0124
```

验签会拒绝：已签文件被修改、包内新增文件、证书被替换、LF 被转成 CRLF。签名只证明文件与发布时一致，不等于第三方安全认证。