param(
    [string]$Path = ".",
    [string]$PythonPath
)

$ErrorActionPreference = 'Stop'
$ExpectedFingerprint = '4A56E5FAFB41A200F6B1E07E8868AAAE1613EAC3E2E138E44860231D1B5D0124'
$source = (Resolve-Path -LiteralPath $Path).Path
$signaturePath = Join-Path $source 'SIGNATURE.md'

if (-not (Test-Path -LiteralPath $signaturePath)) {
    throw '没找到 SIGNATURE.md：请指向解压后的 pixel-bead-blueprint 目录。'
}

$python = $null
if ($PythonPath) {
    $python = (Resolve-Path -LiteralPath $PythonPath).Path
    & $python -c 'import model_signing' 2>$null
    if ($LASTEXITCODE -ne 0) { throw "指定的 Python 无法导入 model_signing：$python" }
}
else {
    foreach ($name in @('python', 'python3')) {
        foreach ($candidate in @(Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -Unique)) {
            & $candidate -c 'import model_signing' 2>$null
            if ($LASTEXITCODE -eq 0) { $python = $candidate; break }
        }
        if ($python) { break }
    }
}
if (-not $python) {
    throw '缺少可用的 model_signing。请运行：python -m pip install model-signing==1.1.1 certifi pyopenssl'
}

$text = [IO.File]::ReadAllText($signaturePath, [Text.Encoding]::UTF8)
$blocks = @{}
foreach ($match in [regex]::Matches($text, '(?s)<!-- (\w+):START -->(.*?)<!-- \1:END -->')) {
    $key = $match.Groups[1].Value
    if ($blocks.ContainsKey($key)) { throw "SIGNATURE.md 包含重复的 $key 块。" }
    $blocks[$key] = $match.Groups[2].Value
}

foreach ($key in @('SIGBASE64', 'CERTBASE64')) {
    if (-not $blocks.ContainsKey($key)) { throw "SIGNATURE.md 缺少 $key 块。" }
}

$signature = [Convert]::FromBase64String(($blocks['SIGBASE64'] -replace '\s', ''))
$certificateDer = [Convert]::FromBase64String(($blocks['CERTBASE64'] -replace '\s', ''))
$fingerprint = [Convert]::ToHexString(
    [Security.Cryptography.SHA256]::HashData($certificateDer)
)
if ($fingerprint -ne $ExpectedFingerprint) {
    throw "证书指纹不受信任：$fingerprint"
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('pbb-verify-' + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $tempRoot 'skill'
$tempSignature = Join-Path $tempRoot 'skill.oms.sig'
$tempCertificate = Join-Path $tempRoot 'cert.pem'

try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $stage -Recurse
    Remove-Item -LiteralPath (Join-Path $stage 'SIGNATURE.md') -Force

    [IO.File]::WriteAllBytes($tempSignature, $signature)
    $certificateB64 = ($blocks['CERTBASE64'] -replace '\s', '')
    $lines = for ($i = 0; $i -lt $certificateB64.Length; $i += 64) {
        $certificateB64.Substring($i, [Math]::Min(64, $certificateB64.Length - $i))
    }
    $pem = "-----BEGIN CERTIFICATE-----`n" + ($lines -join "`n") + "`n-----END CERTIFICATE-----`n"
    [IO.File]::WriteAllText($tempCertificate, $pem, [Text.UTF8Encoding]::new($false))

    Write-Host ("签名 {0} B ｜ 可信证书指纹 {1}" -f $signature.Length, $ExpectedFingerprint)
    & $python -m model_signing verify certificate $stage `
        --no-ignore-git-paths --no-ignore_unsigned_files `
        --signature $tempSignature `
        --certificate_chain $tempCertificate
    if ($LASTEXITCODE -ne 0) {
        throw "严格验签失败（exit $LASTEXITCODE）：文件被修改、被新增，或 LF 被转成了 CRLF。"
    }
    Write-Host '==> 严格验签通过：文件列表与每个文件的字节均和发布时一致。'
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
