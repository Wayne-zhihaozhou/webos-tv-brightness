# build.ps1 - 编译 webos-tv-brightness 配置 APP(使用 .NET Framework csc.exe, 零第三方依赖)
# 用法: .\app\build.ps1
$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
    throw '未找到 csc.exe (.NET Framework 4.x 未安装)'
}

$outExe = Join-Path $appDir 'app\WebosTVBrightness.exe'

$sources = @(
    'Program.cs',
    'MainForm.cs',
    'RuleDialog.cs',
    'ConfigStore.cs',
    'ServiceControl.cs',
    'StatusReader.cs'
) | ForEach-Object { Join-Path $appDir "app\$_" }

$refs = @(
    'System.dll',
    'System.Windows.Forms.dll',
    'System.Drawing.dll',
    'System.Web.Extensions.dll',
    'System.Core.dll'
)

$args = @('/nologo', '/target:winexe', '/optimize+', '/codepage:65001', "/out:$outExe")
foreach ($r in $refs) { $args += "/reference:$r" }
$args += $sources

& $csc $args
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ 编译成功: $outExe"
} else {
    Write-Host "❌ 编译失败 (exit=$LASTEXITCODE)"
    exit $LASTEXITCODE
}
