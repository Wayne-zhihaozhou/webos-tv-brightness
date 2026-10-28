# tv-brightness.ps1 - LG webOS 电视亮度控制(Windows PowerShell 封装)
# 依赖: Node.js + 本项目 npm 依赖(ws)
# 用法:
#   .\scripts\tv-brightness.ps1 get
#   .\scripts\tv-brightness.ps1 set 60
#   .\scripts\tv-brightness.ps1 step +1
#   .\scripts\tv-brightness.ps1 step -1
#   .\scripts\tv-brightness.ps1 pair
#   .\scripts\tv-brightness.ps1 info
# 环境变量: TV_IP(默认 192.168.1.4) / LOCAL_ADDR(默认 192.168.1.5)
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('get', 'set', 'step', 'pair', 'info')]
    [string]$Action,

    [Parameter(Position = 1)]
    [string]$Value
)

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot

# 检查 Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error '未找到 Node.js,请先安装: https://nodejs.org/'
    exit 1
}

# 检查依赖,缺则自动安装
if (-not (Test-Path (Join-Path $ProjectDir 'node_modules\ws'))) {
    Write-Host '首次运行:安装依赖...'
    Push-Location $ProjectDir
    try {
        npm install
    } finally {
        Pop-Location
    }
}

$nodeArgs = @('src/cli.js', $Action)
if ($Value) {
    $nodeArgs += $Value
}

if (-not $env:TV_IP) {
    $env:TV_IP = '192.168.1.4'
}
if (-not $env:LOCAL_ADDR) {
    $env:LOCAL_ADDR = '192.168.1.5'
}

& $node.Source @nodeArgs
exit $LASTEXITCODE
