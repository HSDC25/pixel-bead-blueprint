param(
    [string]$Zip = ".\pixel-bead-blueprint-v1.5.3-提交版.zip",
    [string]$InstallDir = (Join-Path $env:USERPROFILE '.qoder-cn\skills\pixel-bead-blueprint'),
    [switch]$InstallDependencies,
    [switch]$Verbose
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$zipPath = (Resolve-Path -LiteralPath $Zip).Path
$work = Join-Path $env:TEMP ('pbb-oneshot-' + [guid]::NewGuid().ToString('N'))
$verifyScript = Join-Path $PSScriptRoot 'verify-signature.ps1'

function Write-Ok($message) { Write-Host "[OK] $message" }
function Write-Fail($message) { Write-Host "[FAIL] $message" }

function Install-WindowsPackage([string]$WingetId, [string]$ChocoId) {
    $winget = Get-Command winget -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($winget) {
        & $winget.Source install --id $WingetId --exact --source winget `
            --accept-package-agreements --accept-source-agreements --silent 2>&1 |
            ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -eq 0) { return }
    }
    $choco = Get-Command choco -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($choco) {
        & $choco.Source install $ChocoId --yes --no-progress 2>&1 |
            ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -eq 0) { return }
    }
    throw "无法自动安装 $WingetId。请安装 winget 或 Chocolatey，或手动准备该依赖后重试。"
}

function Find-Node {
    $candidates = @(Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
    if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
    foreach ($candidate in ($candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)) {
        try {
            $major = [int]((& $candidate --version).TrimStart('v').Split('.')[0])
            if ($major -ge 18) { return $candidate }
        }
        catch { }
    }
    return $null
}

function Ensure-Node {
    $node = Find-Node
    if ($node) { return $node }
    if (-not $InstallDependencies) { throw '未找到 Node.js 18+。请加 -InstallDependencies，让 AI 自动安装。' }
    Write-Host '[INFO] 正在安装 Node.js LTS'
    Install-WindowsPackage 'OpenJS.NodeJS.LTS' 'nodejs-lts'
    $node = Find-Node
    if (-not $node) { throw 'Node.js 安装后仍不可用。请重开终端，或检查 PATH 后重试。' }
    return $node
}

function Test-PythonModule([string]$Python) {
    & $Python -c 'import model_signing' 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Find-Python {
    $candidates = @(Get-Command python, python3 -CommandType Application -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
    foreach ($candidate in ($candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)) {
        try {
            $null = & $candidate --version 2>$null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        }
        catch { }
    }
    return $null
}

function Find-SigningPython {
    $candidates = @(Find-Python)
    foreach ($candidate in ($candidates | Where-Object { $_ })) {
        if (Test-PythonModule $candidate) { return $candidate }
    }
    return $null
}

function Ensure-SigningPython {
    $python = Find-SigningPython
    if ($python) { return $python }
    if (-not $InstallDependencies) {
        throw '缺少可导入 model_signing 的 Python。请加 -InstallDependencies，让 AI 准备独立虚拟环境。'
    }

    $basePython = Find-Python
    if (-not $basePython) {
        Write-Host '[INFO] 正在安装 Python'
        Install-WindowsPackage 'Python.Python.3.13' 'python'
        $basePython = Find-Python
        if (-not $basePython) { throw 'Python 安装后仍不可用。请重开终端，或检查 PATH 后重试。' }
    }

    $venvDir = Join-Path $env:LOCALAPPDATA 'pixel-bead-blueprint\venv'
    $venvPython = Join-Path $venvDir 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $venvPython)) {
        Write-Host '[INFO] 正在创建独立验签虚拟环境'
        & $basePython -m venv $venvDir 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { throw '创建 Python 虚拟环境失败。' }
    }
    if (-not (Test-PythonModule $venvPython)) {
        Write-Host '[INFO] 正在安装 model-signing 验签依赖'
        & $venvPython -m pip install --disable-pip-version-check 'model-signing==1.1.1' certifi pyopenssl 2>&1 |
            ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { throw '安装 model-signing 验签依赖失败。' }
    }
    if (-not (Test-PythonModule $venvPython)) { throw '验签虚拟环境自检失败。' }
    return $venvPython
}

try {
    if (-not (Test-Path -LiteralPath $verifyScript)) { throw "找不到验签工具：$verifyScript" }
    $node = Ensure-Node
    $python = Ensure-SigningPython
    $nodeVersion = (& $node --version).Trim()
    $pythonVersion = (& $python --version).Trim()
    Write-Ok "运行环境就绪：Node $nodeVersion；Python $pythonVersion"

    New-Item -ItemType Directory -Path $work -Force | Out-Null
    Expand-Archive -LiteralPath $zipPath -DestinationPath $work -Force
    $skill = Join-Path $work 'pixel-bead-blueprint'
    if (-not (Test-Path -LiteralPath (Join-Path $skill 'SKILL.md'))) {
        throw '压缩包结构不对，找不到 pixel-bead-blueprint/SKILL.md。'
    }

    $files = @(Get-ChildItem -LiteralPath $skill -Recurse -Force -File)
    $unpackedBytes = ($files | Measure-Object -Property Length -Sum).Sum
    if ($files.Count -gt 30) { throw "文件数 $($files.Count) 超过赛题上限 30。" }
    if ($unpackedBytes -gt 40MB) { throw "解压体积超过赛题上限 40MB。" }

    $versionMatch = Select-String -LiteralPath (Join-Path $skill 'SKILL.md') -Pattern '^version:\s*(.+)$' | Select-Object -First 1
    if (-not $versionMatch) { throw 'SKILL.md 缺少 version 字段。' }
    $version = $versionMatch.Matches[0].Groups[1].Value.Trim()
    Write-Ok "拿到文件：$($files.Count) 个，版本 $version，解压 $([Math]::Round($unpackedBytes / 1MB, 2)) MB"

    $verifyOutput = & (Join-Path $PSHOME 'pwsh.exe') -NoLogo -NoProfile -ExecutionPolicy Bypass `
        -File $verifyScript -Path $skill -PythonPath $python 2>&1
    $verifyExit = $LASTEXITCODE
    if ($Verbose) { $verifyOutput | ForEach-Object { Write-Host $_ } }
    if ($verifyExit -ne 0) {
        throw "可信证书或严格验签未通过，未安装。$($verifyOutput | Select-Object -Last 4)"
    }
    Write-Ok '可信证书指纹、文件列表和每个文件的字节均通过严格验签'

    $testRoot = Join-Path $work 'test'
    Copy-Item -LiteralPath $skill -Destination $testRoot -Recurse
    Push-Location $testRoot
    try {
        $testOutput = & $node --test --test-reporter=tap scripts/test/run.js 2>&1
        $testExit = $LASTEXITCODE
        $evalOutput = & $node evals/run-evals.js 2>&1
        $evalExit = $LASTEXITCODE
    }
    finally { Pop-Location }

    $passMatch = [regex]::Match(($testOutput -join "`n"), '(?m)^# pass (\d+)\s*$')
    if ($testExit -ne 0 -or -not $passMatch.Success) {
        if ($Verbose) { $testOutput | Select-Object -Last 30 }
        throw '回归测试失败，未安装。'
    }
    if ($evalExit -ne 0) {
        if ($Verbose) { $evalOutput | Select-Object -Last 30 }
        throw 'CLI 评测失败，未安装。'
    }
    Write-Ok "回归 $($passMatch.Groups[1].Value) 项通过，CLI 评测通过"

    $target = [IO.Path]::GetFullPath($InstallDir)
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $installStage = Join-Path $parent ('.pbb-install-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $installStage -Force | Out-Null
    Get-ChildItem -LiteralPath $skill -Force | Copy-Item -Destination $installStage -Recurse

    $backup = $null
    if (Test-Path -LiteralPath $target) {
        $backup = "$target.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
        Move-Item -LiteralPath $target -Destination $backup
    }
    try {
        Move-Item -LiteralPath $installStage -Destination $target
    }
    catch {
        if ($backup -and -not (Test-Path -LiteralPath $target)) {
            Move-Item -LiteralPath $backup -Destination $target
        }
        throw
    }

    Write-Ok "安装完成：$target"
    if ($backup) { Write-Host "[INFO] 旧版本已备份：$backup" }
    Write-Host '现在可以直接说：把这张照片变成拼豆图纸。'
}
catch {
    $line = $_.InvocationInfo.ScriptLineNumber
    Write-Fail "$($_.Exception.Message)（脚本第 $line 行）"
    exit 1
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
