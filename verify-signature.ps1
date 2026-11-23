# verify-signature.ps1 —— 验 pixel-bead-blueprint 的目录签名
# 用法（在解压出来的 skill 目录里，或指定路径）：
#   pwsh -File verify-signature.ps1                      # 当前目录
#   pwsh -File verify-signature.ps1 -Path .\pixel-bead-blueprint
param([string]$Path = ".")

$ErrorActionPreference = 'Stop'
$p = (Resolve-Path $Path).Path
Push-Location $p
try {
    if (-not (Test-Path SIGNATURE.md)) { throw "没找到 SIGNATURE.md —— 这个目录不是完整包（或不是 zip 解压出来的）" }

    # 1) 从 SIGNATURE.md 还原签名与证书
    $t = Get-Content SIGNATURE.md -Raw
    $ms = [regex]::Matches($t, '(?s)<!-- (\w+):START -->(.*?)<!-- \1:END -->')
    if ($ms.Count -lt 2) { throw "SIGNATURE.md 里找不到 SIGBASE64 / CERTBASE64 标记" }
    $sig = ($ms[0].Groups[2].Value) -replace '\s', ''
    $certB = ($ms[1].Groups[2].Value) -replace '\s', ''
    [IO.File]::WriteAllBytes("$p\skill.oms.sig", [Convert]::FromBase64String($sig))
    $pem = "-----BEGIN CERTIFICATE-----`n" + (($certB -replace '(.{64})', ('$1' + "`n")).Trim()) + "`n-----END CERTIFICATE-----`n"
    [IO.File]::WriteAllText("$p\cert.pem", $pem)

    "签名 {0} B ｜ 证书 {1} B" -f (Get-Item "$p\skill.oms.sig").Length, (Get-Item "$p\cert.pem").Length

    # 2) 验签
    python -m model_signing verify certificate "$p" `
        --signature "$p\skill.oms.sig" `
        --certificate_chain "$p\cert.pem" `
        --ignore_unsigned_files
    $code = $LASTEXITCODE
    if ($code -eq 0) { "==> 验签通过：这些文件与发布时逐字节一致" } else { "==> 验签失败（exit $code）：文件被改过，或换行被转换（CRLF）" }
    exit $code
}
finally {
    Remove-Item "$p\skill.oms.sig", "$p\cert.pem" -Force -ErrorAction SilentlyContinue
    Pop-Location
}