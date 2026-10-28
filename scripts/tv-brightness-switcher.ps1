#requires -Version 5.1
<#
  tv-brightness-switcher.ps1 - webOS 电视亮度自动切换主程序
  游戏 / 视频时亮度 -> mediaBrightness(默认 50),
  其他情况亮度 -> idleBrightness(默认 0, OLED 接近黑屏)。

  依赖: 本项目 Node CLI(src/cli.js),需已配对(key/client-key.json)
  用法:
    常驻监听(默认):     .\scripts\tv-brightness-switcher.ps1
    只检测一次:         .\scripts\tv-brightness-switcher.ps1 -Once
    试运行(只记录):     .\scripts\tv-brightness-switcher.ps1 -DryRun
    前台输出:           .\scripts\tv-brightness-switcher.ps1 -Console
    手动强制应用:       .\scripts\tv-brightness-switcher.ps1 -ApplyNow
  环境变量: TV_IP / LOCAL_ADDR(同 cli.js)
#>
param(
    [switch]$Once,
    [switch]$DryRun,
    [switch]$Console,
    [switch]$ApplyNow
)

$ErrorActionPreference = 'Stop'
$script:ScriptDir = Split-Path -Parent $PSScriptRoot

# ---------- 配置 ----------
function Read-Config {
    $defaults = @{
        mediaBrightness          = 50
        idleBrightness           = 0
        pollIntervalMs           = 1000
        treatFullscreenAsMedia   = $true
        restoreOnExit            = $false
        restoreValue             = 60
        gameProcesses            = @()
        mediaProcesses           = @('vlc','mpv','potplayer','potplayermini64','potplayermini','mpc-hc','mpc-be','kmplayer','smplayer','kodi','plex','emby','jellyfin','ffplay')
        videoTitlePatterns       = @('bilibili','youtube','netflix','twitch','youku','优酷','iqiyi','爱奇艺','腾讯视频','芒果tv','芒果','douyu','斗鱼','huya','虎牙','抖音','快手','哔哩哔哩','acfun')
        ignoreFullscreenProcesses = @('explorer','cmd','conhost','powershell','pwsh','windowsterminal','code','devenv','taskmgr','mstsc','notepad','wechat','weixin','qq','dingtalk','wps','winword','excel','powerpnt','acrobat','sumatrapdf','msedge','chrome','firefox','brave')
    }
    $cfgPath = Join-Path $script:ScriptDir 'config.json'
    if (Test-Path $cfgPath) {
        try {
            $json = Get-Content -Raw -Encoding UTF8 $cfgPath | ConvertFrom-Json
            foreach ($prop in $json.PSObject.Properties) {
                if ($defaults.ContainsKey($prop.Name)) { $defaults[$prop.Name] = $prop.Value }
            }
        } catch {
            Write-Warning "config.json 解析失败, 使用默认配置: $($_.Exception.Message)"
        }
    }
    foreach ($k in @('gameProcesses','mediaProcesses','videoTitlePatterns','ignoreFullscreenProcesses')) {
        $arr = @($defaults[$k]) | ForEach-Object { if ($null -ne $_) { $_.ToString() } }
        $defaults[$k] = @($arr | Where-Object { $_ -ne '' })
    }
    $defaults['pollIntervalMs'] = [int]$defaults['pollIntervalMs']
    if ($defaults['pollIntervalMs'] -lt 300) { $defaults['pollIntervalMs'] = 300 }
    return $defaults
}

# ---------- 模式判定 ----------
function Get-Mode {
    param([hashtable]$Config, [pscustomobject]$Fg)
    if (-not $Fg.ProcessName) { return '' }   # 无前台窗口信息, 保持当前模式
    $pn = $Fg.ProcessName.ToLowerInvariant()
    if ($Config.mediaProcesses -contains $pn) { return 'media' }
    if ($Config.gameProcesses -contains $pn) { return 'media' }
    if ($Config.treatFullscreenAsMedia -and $Fg.Fullscreen -and ($Config.ignoreFullscreenProcesses -notcontains $pn)) { return 'media' }
    if ($Fg.Title -and $Config.videoTitlePatterns.Count -gt 0) {
        $title = $Fg.Title.ToLowerInvariant()
        foreach ($pat in $Config.videoTitlePatterns) {
            if ($title.Contains($pat.ToLowerInvariant())) { return 'media' }
        }
    }
    return 'idle'
}

# ---------- 调电视亮度(调 Node CLI) ----------
function Set-TVBacklight {
    param([int]$Value)
    $env:TV_IP = if ($env:TV_IP) { $env:TV_IP } else { '192.168.1.4' }
    $env:LOCAL_ADDR = if ($env:LOCAL_ADDR) { $env:LOCAL_ADDR } else { '192.168.1.5' }
    $cliPath = Join-Path $script:ScriptDir 'src\cli.js'
    $nodeArgs = @($cliPath, 'set', [string]$Value)
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw '未找到 Node.js' }
    Push-Location $script:ScriptDir
    try {
        & $node.Source @nodeArgs 2>&1 | Out-Null
    } finally {
        Pop-Location
    }
    return $LASTEXITCODE -eq 0
}

# ---------- 日志 ----------
$script:LogFile = $null
function Write-Log {
    param([string]$Message)
    if ($script:LogFile) {
        $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
        Add-Content -Path $script:LogFile -Value $line -Encoding UTF8
    }
    if ($Console) { Write-Host $Message }
}

# ---------- 单实例保护 ----------
$script:Mutex = New-Object System.Threading.Mutex($false, 'Global\WebosTVBrightnessSwitcher')
if (-not $script:Mutex.WaitOne(0)) {
    Write-Warning 'tv-brightness-switcher 已在运行, 本次启动取消。'
    exit 1
}

# 加载前台窗口检测
. (Join-Path $script:ScriptDir 'src\Foreground.ps1')

$cfg = Read-Config
$logDir = Join-Path $script:ScriptDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$script:LogFile = Join-Path $logDir 'switcher.log'

Write-Log ('启动. 媒体亮度={0}, 空闲亮度={1}, 轮询={2}ms' -f $cfg.mediaBrightness, $cfg.idleBrightness, $cfg.pollIntervalMs)

$lastMode = ''
try {
    # 初始检测并应用
    $fg = Get-ForegroundInfo
    $mode = Get-Mode $cfg $fg
    if ($mode) {
        $lastMode = $mode
        $target = if ($mode -eq 'media') { $cfg.mediaBrightness } else { $cfg.idleBrightness }
        if ($DryRun) {
            Write-Log ('[dry-run] 初始模式: {0}(进程={1}, 标题={2}, 全屏={3})' -f $mode, $fg.ProcessName, $fg.Title, $fg.Fullscreen)
        } else {
            try {
                $ok = Set-TVBacklight $target
                Write-Log ('初始模式: {0}(进程={1}, 全屏={2}) 亮度 -> {3} {4}' -f $mode, $fg.ProcessName, $fg.Fullscreen, $target, $(if ($ok) {'✅'} else {'❌'}))
            } catch {
                Write-Log ('设置亮度失败: {0}' -f $_.Exception.Message)
            }
        }
    }

    if ($ApplyNow) { exit 0 }
    if ($Once) { exit 0 }

    # 循环监听
    while ($true) {
        $fg = Get-ForegroundInfo
        $mode = Get-Mode $cfg $fg
        if ($mode -and $mode -ne $lastMode) {
            $target = if ($mode -eq 'media') { $cfg.mediaBrightness } else { $cfg.idleBrightness }
            $desc = '模式切换: {0} -> {1}(进程={2}, 标题={3}, 全屏={4})' -f $lastMode, $mode, $fg.ProcessName, $fg.Title, $fg.Fullscreen
            if ($DryRun) {
                Write-Log ('[dry-run] ' + $desc)
            } else {
                try {
                    $ok = Set-TVBacklight $target
                    Write-Log ($desc + (' 亮度 -> {0} {1}' -f $target, $(if ($ok) {'✅'} else {'❌'})))
                } catch {
                    Write-Log ('设置亮度失败: {0}' -f $_.Exception.Message)
                }
            }
            $lastMode = $mode
        }
        Start-Sleep -Milliseconds $cfg.pollIntervalMs
    }
} finally {
    if ($cfg.restoreOnExit -and -not $DryRun) {
        try {
            $null = Set-TVBacklight $cfg.restoreValue
            Write-Log ('退出, 已恢复亮度 {0}' -f $cfg.restoreValue)
        } catch { }
    }
    if ($script:Mutex) { $script:Mutex.ReleaseMutex() }
}
