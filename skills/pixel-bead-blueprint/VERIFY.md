# 签名与验签说明

> **签名数据在本目录的 `SIGNATURE.md` 里**（base64 内嵌）。还原成 `skill.oms.sig` 后即可离线验签。
> 为什么不用独立的 `.sig` 文件：平台白名单不收该扩展名；为什么签名不直接写进本文件：见第四节「自引用」。

## 一、签名盖住了什么

格式为 OpenSSF Model Signing（OMS / Sigstore bundle，分离签名），覆盖本目录内**除 `SIGNATURE.md` 与 `skill.oms.sig` 之外**的每个文件。
`SIGNATURE.md` 是签名之后新增的载体，因此验签要加 `--ignore_unsigned_files`（只忽略「未签名的新增文件」，改动任何已签文件仍会失败）。

> ⚠️ 能证明 / 不能证明
> - 能证明：**已签文件未被改动**，且由持有该证书私钥的人签出。
> - 不能证明：代码安全、质量合格、获得官方认证；也不能发现「有人额外塞进来的新文件」（这是本方案的已知取舍，见第五节）。
> - 本签名使用**自签证书**。安全边界见 `skill-card.md`；行为判据见 `test-cases/cases.md`。

## 二、签名与证书信息

| 项 | 值 |
|---|---|
| 签名格式 | OpenSSF Model Signing（Sigstore bundle） |
| PKI 方式 | `certificate`（X.509 自签） |
| 签署主体 | `CN=Pixel Studio Skill Signing, O=Pixel Studio, C=CN` |
| 证书位置 | 内嵌在 `SIGNATURE.md` 的 `CERTBASE64` 块；GitHub 仓库另有 `pki/pixel-studio-skill-cert.pem` |
| 证书指纹（SHA256） | `4A:56:E5:FA:FB:41:A2:00:F6:B1:E0:7E:88:68:AA:AE:16:13:EA:C3:E2:E1:38:E4:48:60:23:1D:1B:5D:01:24` |
| 签名算法 | **ECDSA P-256 / SHA-256** |
| 有效期 | 10 年（2026-11-21 签发） |

私钥不在本目录、不在任何提交包内。

## 三、验签三步

> **顺序要求（实测，2026-11-23）**：**先验签，再跑测试 / 评测**。
> `node evals/run-evals.js` 会把本轮结果写回 `evals/BENCHMARK.md`，该文件在签名清单内，跑完再验签必然报 `Hash mismatch for 'evals/BENCHMARK.md'`。
> 同理，`node --test` 首次运行会从 `scripts/test/fixtures/fixtures.html` 解包 2 个样张 jpg（26 → 28 个文件），属新增文件，被 `--ignore_unsigned_files` 忽略，不影响验签。
>
> **Windows 换行提醒（实测，2026-11-23）**：在 Windows 用 `git clone` 取回时，默认 `core.autocrlf=true` 会把 LF 转成 CRLF，导致**22 个已签文件全部哈希不符**。取回请二选一：
> - `git -c core.autocrlf=false clone https://github.com/HSDC25/pixel-bead-blueprint.git`
> - 直接用发布 zip 解压（LF 原样保留）
>
> 实测对照：zip 解压 → `Verification succeeded`；`autocrlf=false` clone → `Verification succeeded`；默认 clone → 22 个 `Hash mismatch`（exit 1）。

### 1) 还原签名与证书（从 `SIGNATURE.md`）

```powershell
# Windows PowerShell
$t = Get-Content SIGNATURE.md -Raw
$ms = [regex]::Matches($t,'(?s)<!-- (\w+):START -->(.*?)<!-- \1:END -->')
$sig = ($ms[0].Groups[2].Value) -replace '\s',''
[IO.File]::WriteAllBytes("$PWD\skill.oms.sig", [Convert]::FromBase64String($sig))
$certB = ($ms[1].Groups[2].Value) -replace '\s',''
[IO.File]::WriteAllText("$PWD\cert.pem", "-----BEGIN CERTIFICATE-----`n" + (($certB -replace '(.{64})', ('$1' + "`n")).Trim()) + "`n-----END CERTIFICATE-----`n")
```

```python
# macOS / Linux（python3）：存成 restore.py 再运行
import re, base64, pathlib
s = pathlib.Path('SIGNATURE.md').read_text(encoding='utf-8')
blk = re.findall(r'(?s)<!-- (\w+):START -->(.*?)<!-- \1:END -->', s)
pathlib.Path('skill.oms.sig').write_bytes(base64.b64decode(''.join(blk[0][1].split())))
b64 = ''.join(blk[1][1].split())
pem = '-----BEGIN CERTIFICATE-----\n' + '\n'.join(b64[i:i+64] for i in range(0, len(b64), 64)) + '\n-----END CERTIFICATE-----\n'
pathlib.Path('cert.pem').write_text(pem, encoding='ascii')
```

### 2) 安装验证器

```bash
pip install model-signing
```

### 3) 验签

```bash
python -m model_signing verify certificate . \
  --signature skill.oms.sig \
  --certificate_chain cert.pem \
  --ignore_unsigned_files
```

输出 `Verification succeeded` 即通过。
**必须带 `--ignore_unsigned_files`** —— 因为 `SIGNATURE.md` 是签名之后才加进来的载体。

## 四、为什么签名不写进本文件（自引用问题）

目录级签名不能覆盖「装着签名的那个文件」：

1. 若把 base64 写进 `VERIFY.md`，签名前它必须已含 base64，而 base64 又是签名的产物 —— 循环依赖；
2. 直觉方案是「签名时忽略 VERIFY.md」，但 **model-signing 1.1.1 的 `--ignore-paths` 实测无效**（见第五节坑 5）;
3. 所以改用官方另一条路：**签名后新增 `SIGNATURE.md` 作为载体**，验签时 `--ignore_unsigned_files` 忽略它。

## 五、实测坑（model-signing 1.1.1，2026-11-21）

| # | 现象 | 结论 |
|---|---|---|
| 1 | 只传 `--signing_certificate` → `Unable to load PEM file … MalformedFraming` | certificate 模式**必须同时传 `--certificate_chain`** |
| 2 | RSA 私钥 → `RSAPublicKey object has no attribute 'curve'` | **必须 ECDSA P-256** |
| 3 | 证书无扩展 → `Signing certificate cannot be used for signing` | 证书要带 **KeyUsage + ExtendedKeyUsage(codeSigning)** |
| 4 | `--certificate-chain` 报选项不存在 | 参数名是**下划线** |
| 5 | `--ignore-paths b.txt` / `./b.txt` / 目录 `sub` 全无效（实测：三者仍出现在签名清单） | **1.1.1 的 `--ignore-paths` 不可用**；改用 `--ignore_unsigned_files` |
| 6 | 严格模式多一个文件 → `Extra files found` | 加 `--ignore_unsigned_files` 可忽略**新增**文件；但**改动已签文件仍会 Hash mismatch**（已实测） |
| 7 | Windows 默认 `git clone`（`core.autocrlf=true`）→ **22 个已签文件全部** `Hash mismatch` | 换行符 LF→CRLF 改了字节；取回用 `git -c core.autocrlf=false clone` 或 zip 解压 |
| 8 | 先跑 `node evals/run-evals.js` 再验签 → `Hash mismatch for 'evals/BENCHMARK.md'` | 评测把结果写回该文件（已在清单内）；**先验签、再评测** |

## 六、本方案的已知取舍

| 项 | 说明 |
|---|---|
| 新增文件不设防 | 有人往目录里**添加**文件，`--ignore_unsigned_files` 下不会被发现 |
| 缓解 | 交付包文件数与清单在 `assets/README.md` 固定；评审可按清单核对是否多出文件 |
| 若平台支持 `.sig` | 把 `SIGNATURE.md` 还原出的 `skill.oms.sig` 单独提交，验签去掉 `--ignore_unsigned_files` 即为严格模式 |
| 证书可信度 | 自签：能证「未被改动」，发布者身份需自行信任本仓库 |

## 七、不靠签名也能验的东西

```bash
node --test scripts/test/run.js     # 回归测试 57 项（实测 57/57）
node evals/run-evals.js             # 评测 6 项 CLI（实测 6/6）+ 2 项人工验收
```

关键文件 SHA256 见 `assets/README.md` 文末「完整性校验」。

## 八、重签流程（发布者本机）

```powershell
# 1) 删除旧载体与旧签名
Remove-Item SIGNATURE.md, skill.oms.sig -Force -ErrorAction SilentlyContinue
# 2) 签名（此时目录里没有 SIGNATURE.md）
python -m model_signing sign certificate . --signature skill.oms.sig `
  --private_key <私钥.pem> --signing_certificate <证书.pem> --certificate_chain <证书.pem>
# 3) 用 skill.oms.sig 生成 SIGNATURE.md（base64 两块：SIGBASE64 / CERTBASE64），再删除 skill.oms.sig
# 4) 验签自检
python -m model_signing verify certificate . --signature skill.oms.sig --certificate_chain cert.pem --ignore_unsigned_files
```