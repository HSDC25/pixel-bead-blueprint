# 签名与验签说明

> 签名数据在本目录的 `SIGNATURE.md` 里，格式为 OpenSSF Model Signing（OMS / Sigstore bundle）。
> 推荐使用发布包工具里的 `verify-signature.ps1` / `verify-signature.sh`。工具会固定可信证书指纹，并在临时副本上严格验签。

## 一、签名保证什么

签名覆盖本目录内除 `SIGNATURE.md` 外的每个文件。`SIGNATURE.md` 是签名后新增的载体，所以验签工具会：

1. 从载体还原签名与证书；
2. 核对证书 SHA-256 指纹必须等于发布者固定值；
3. 把技能复制到临时目录，并只排除 `SIGNATURE.md`；
4. 签名与验签都使用 `--no-ignore-git-paths`，并显式使用 `--no-ignore_unsigned_files`，严格核对文件列表和每个文件的字节。

因此以下情况都会被拒绝：

- 已签文件被修改；
- 目录里多出任何文件；
- 签名或证书被替换；
- LF 被转换成 CRLF；
- 先跑评测改写了 `evals/BENCHMARK.md` 后再验签。

> 签名能证明已签内容未被改动，且由持有对应私钥的人签署；不能证明代码安全、质量合格或获得官方认证。本签名使用自签证书，发布者身份依靠固定指纹和公开分发渠道建立信任。

## 二、证书信息

| 项 | 值 |
|---|---|
| 签名格式 | OpenSSF Model Signing（Sigstore bundle） |
| PKI 方式 | `certificate`（X.509 自签） |
| 签署主体 | `CN=Pixel Studio Skill Signing, O=Pixel Studio, C=CN` |
| 签名算法 | ECDSA P-256 / SHA-256 |
| 证书用途 | `KeyUsage` + `ExtendedKeyUsage(codeSigning)` |
| 有效期 | 2026-11-20 至 2036-11-17 |
| 证书指纹（SHA256） | `4A:56:E5:FA:FB:41:A2:00:F6:B1:E0:7E:88:68:AA:AE:16:13:EA:C3:E2:E1:38:E4:48:60:23:1D:1B:5D:01:24` |

私钥不在技能目录、不在任何提交包内，也不应随仓库分发。

## 三、一条命令验签

### Windows / PowerShell 7

把 `verify-signature.ps1` 和技能目录放在可得的位置，然后执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\verify-signature.ps1 -Path .\pixel-bead-blueprint
```

### macOS / Linux

```bash
bash verify-signature.sh ./pixel-bead-blueprint
```

虚拟环境可指定解释器：

```bash
PYTHON=/path/to/venv/bin/python bash verify-signature.sh ./pixel-bead-blueprint
```

缺少验签依赖时安装：

```bash
python -m pip install model-signing==1.1.1 certifi pyopenssl
```

成功输出必须同时包含：

```text
Verification succeeded
==> 严格验签通过
```

## 四、为什么不再使用 `--ignore_unsigned_files`

平台不接受独立 `.sig` 文件，因此签名和证书内嵌在 `SIGNATURE.md`。旧验签方式向该选项忽略未签名新增文件，攻击者可能额外塞入文件而未被发现。

现在的严格方式不需要平台多收一个文件：验签工具在临时副本中排除载体文件，签名与证书也放在临时目录外，然后使用严格模式。这样既解决自引用，又保留新增文件检测。

## 五、CRLF / LF 规则

签名校验的是**字节**，不是语义。LF 改成 CRLF 即使代码功能不变，哈希也会变化。

本包采用以下约束：

1. 仓库根目录有 `.gitattributes`：`* text=auto eol=lf`；提交包内不含该文件；
2. Windows 默认 `core.autocrlf=true` 时，Git 仍按仓库根属性签出 LF；
3. 发布 zip 保留 LF 原样；
4. 重签脚本发现文本文件含 CRLF 会直接拒绝；
5. 验签脚本不会自动转换换行，避免把被篡改文件“修成可验”。

取回方式：

| 渠道 | 结果 |
|---|---|
| 发布 zip 解压 | 推荐，字节原样保留 |
| 新仓库 `git clone` | 仓库根 `.gitattributes` 强制 LF |
| 旧提交或旧 clone | 可能仍是 CRLF，应重新下载 zip 或更新仓库属性 |

如果本地旧 clone 已产生 CRLF，可在仓库根执行一次重新规范化，再由发布者提交：

```bash
git add --renormalize .
git status
```

## 六、测试与验签顺序

必须**先验签，再跑测试/评测**。`node evals/run-evals.js` 会改写 `evals/BENCHMARK.md`；`node --test` 首次运行会解包两个样张 jpg。它们都会让严格验签失败。

推荐在临时副本里测试：

```bash
node --test --test-reporter=tap scripts/test/run.js
node evals/run-evals.js
```

一键安装脚本会自动创建测试副本，并从未修改的原始解包目录安装，不会把测试产物装进技能目录。

## 七、重签流程

发布者使用工作区工具 `promo/sign-embed.ps1`，在暂存副本执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\promo\sign-embed.ps1 `
  -Dir .\pixel-bead-blueprint `
  -Key <私钥路径> -Cert <证书路径>
```

脚本会先核对证书指纹、拒绝 CRLF、把旧载体移到临时目录；签名失败时恢复旧载体。签名输出也放在临时目录，不会污染被签目录。

重签后必须重新打包，并用最终 zip 解压再做一次严格验签和完整测试。

## 八、model-signing 1.1.1 注意事项

- certificate 模式必须同时提供 `--signing_certificate` 和 `--certificate_chain`；
- 参数名使用下划线，如 `--certificate_chain`；
- 当前证书使用 ECDSA P-256，并包含 KeyUsage 与 codeSigning EKU；
- `--ignore-paths` 在该版本实测无效，本方案不依赖它；
- model-signing 默认忽略 Git 相关文件，因此签名与验签仍显式加 `--no-ignore-git-paths`；提交包本身不含 `.gitattributes`，LF 由仓库根属性保证；
- `--no-ignore_unsigned_files` 显式保留新增文件检测。
