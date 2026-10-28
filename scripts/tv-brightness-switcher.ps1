#requires -Version 5.1
<#
  tv-brightness-switcher.ps1 - webOS 电视亮度自动切换服务(无窗口常驻)
  按 config.json 中的规则列表(优先级自上而下)匹配前台窗口, 应用对应亮度。
  - 支持 config.json 热重载(文件变化自动重新加载, 无需重启)
  - 每轮检测写 status.json(前台/命中规则/亮度), 供配置 APP 显示

  依赖: 本项目 Node CLI(src/cli.js), 需已配对(key/client-key.json)
  用法:
    常驻监听(默认):     .\scripts\tv-brightness-switcher.ps1
    只检测一次:         .\scripts\tv-brightness-switcher.ps1 -Once
    试运行(只记录):     .\scripts\tv-brightness-switcher.ps1 -DryRun
    前台输出:           .\scripts\tv-brightness-switcher.ps1 -Console
  环境变量: TV_IP / LOCAL_ADDR(可被 config.json 覆盖)
#>
param(
    [switch]$Once,
    [switch]$DryRun,
    [switch]$Console
)

$ErrorActionPreference = 'Stop'
$script:ScriptDir = Split-Path -Parent $PSScriptRoot
$script:CfgPath = Join-Path $script:ScriptDir 'config.json'
$script:StatusPath = Join-Path $script:ScriptDir 'status.json'
$script:LogFile = Join-Path $script:ScriptDir 'logs\switcher.log'

# ---------- 默认配置 ----------
function Get-DefaultConfig {
    return @{
        tvIp               = '192.168.1.4'
        localAddr          = '192.168.1.5'
        pollIntervalMs     = 1000
        restoreOnExit      = $false
        restoreValue       = 60
        rules              = @(
            @{
                name             = '游戏'
                brightness       = 50
                matchFullscreen  = $true
                processes        = @()
                titleKeywords    = @()
                ignoreProcesses  = @('explorer','cmd','conhost','powershell','pwsh','windowsterminal','code','devenv','taskmgr','mstsc','notepad','wechat','weixin','qq','dingtalk','wps','winword','excel','powerpnt','acrobat','sumatrapdf','msedge','chrome','firefox','brave')
            },
            @{
                name             = '视频'
                brightness       = 50
                matchFullscreen  = $false
                processes        = @('vlc','mpv','potplayer','potplayermini64','potplayermini','mpc-hc','mpc-be','kmplayer','smplayer','kodi','plex','emby','jellyfin','ffplay')
                titleKeywords    = @('bilibili','youtube','netflix','twitch','youku','优酷','iqiyi','爱奇艺','腾讯视频','芒果tv','芒果','douyu','斗鱼','huya','虎牙','抖音','快手','哔哩哔哩','acfun')
                ignoreProcesses  = @()
            },
            @{
                name             = '空闲默认'
                brightness       = 0
                matchFullscreen  = $false
                processes        = @()
                titleKeywords    = @()
                ignoreProcesses  = @()
            }
        )
    }
}

# ---------- 读取配置(含默认值合并) ----------
$script:Config = $null
function Read-Config {
    $defaults = Get-DefaultConfig
    $cfg = @{
        tvIp           = $defaults.tvIp
        localAddr      = $defaults.localAddr
        pollIntervalMs = $defaults.pollIntervalMs
        restoreOnExit  = $defaults.restoreOnExit
        restoreValue   = $defaults.restoreValue
        rules          = @()
    }
    if (Test-Path $script:CfgPath) {
        try {
            $json = Get-Content -Raw -Encoding UTF8 $script:CfgPath | ConvertFrom-Json
            if ($json.tvIp) { $cfg.tvIp = [string]$json.tvIp }
            if ($json.localAddr) { $cfg.localAddr = [string]$json.localAddr }
            if ($null -ne $json.pollIntervalMs) { $cfg.pollIntervalMs = [int]$json.pollIntervalMs }
            if ($null -ne $json.restoreOnExit) { $cfg.restoreOnExit = [bool]$json.restoreOnExit }
            if ($null -ne $json.restoreValue) { $cfg.restoreValue = [int]$json.restoreValue }
            if ($json.rules -and $json.rules.Count -gt 0) {
                foreach ($r in $json.rules) {
                    $cfg.rules += @{
                        name            = [string]$r.name
                        brightness      = [int]$r.brightness
                        matchFullscreen = [bool]$r.matchFullscreen
                        processes       = @($r.processes | ForEach-Object { if ($_) { $_.ToString() } } | Where-Object { $_ })
                        titleKeywords   = @($r.titleKeywords | ForEach-Object { if ($_) { $_.ToString() } } | Where-Object { $_ })
                        ignoreProcesses = @($r.ignoreProcesses | ForEach-Object { if ($_) { $_.ToString() } } | Where-Object { $_ })
                    }
                }
            }
        } catch {
            Write-Warning "config.json 解析失败, 使用默认配置: $($_.Exception.Message)"
        }
    }
    # 兜底: 至少一条默认规则
    if ($cfg.rules.Count -eq 0) {
        $cfg.rules = $defaults.rules
    }
    if ($cfg.pollIntervalMs -lt 300) { $cfg.pollIntervalMs = 300 }
    $script:Config = $cfg
    return $cfg
}

# ---------- 规则匹配(返回命中的规则对象, 未命中返回兜底规则或 null) ----------
function Get-MatchedRule {
    param([hashtable]$Config, [pscustomobject]$Fg)
    if (-not $Fg.ProcessName) { return $null }
    $pn = $Fg.ProcessName.ToLowerInvariant()
    $title = $Fg.Title.ToLowerInvariant()
    $fallback = $null
    foreach ($rule in $Config.rules) {
        # 兜底规则: 匹配条件全为空(processes 空、titleKeywords 空、matchFullscreen=false), 无条件命中
        if ($rule.processes.Count -eq 0 -and $rule.titleKeywords.Count -eq 0 -and -not $rule.matchFullscreen) {
            $fallback = $rule
            continue
        }
        $hit = $false
        # 条件1: 前台进程在名单中
        if ($rule.processes.Count -gt 0 -and $rule.processes -contains $pn) { $hit = $true }
        # 条件2: 全屏且进程不在忽略名单
        if (-not $hit -and $rule.matchFullscreen -and $Fg.Fullscreen) {
            $ignore = @($rule.ignoreProcesses) | ForEach-Object { $_.ToString().ToLowerInvariant() }
            if ($ignore -notcontains $pn) { $hit = $true }
        }
        # 条件3: 标题包含关键词
        if (-not $hit -and $rule.titleKeywords.Count -gt 0) {
            foreach ($kw in $rule.titleKeywords) {
                if ($title.Contains($kw.ToString().ToLowerInvariant())) { $hit = $true; break }
            }
        }
        if ($hit) { return $rule }
    }
    return $fallback
}

# ---------- 写状态文件(供 APP 显示) ----------
function Write-Status {
    param([pscustomobject]$Fg, [hashtable]$Rule, [string]$Applied, [string]$Error)
    $obj = @{
        updatedAt     = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        foreground    = @{
            process = $Fg.ProcessName
            title   = $Fg.Title
            fullscreen = $Fg.Fullscreen
        }
        matchedRule   = if ($Rule) { $Rule.name } else { '' }
        targetBrightness = if ($Rule) { [int]$Rule.brightness } else { $null }
        applied       = $Applied
        error         = $Error
        serviceRunning = $true
    } | ConvertTo-Json -Depth 4
    try {
        Set-Content -Path $script:StatusPath -Value $obj -Encoding UTF8
    } catch { }
}

# ---------- 调电视亮度(调 Node CLI) ----------
function Set-TVBacklight {
    param([int]$Value)
    $env:TV_IP = $script:Config.tvIp
    $env:LOCAL_ADDR = $script:Config.localAddr
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

New-Item -ItemType Directory -Force -Path (Split-Path $script:LogFile) | Out-Null

$cfg = Read-Config
Write-Log ('启动. 规则数={0}, 轮询={1}ms, 电视={2}' -f $cfg.rules.Count, $cfg.pollIntervalMs, $cfg.tvIp)

$lastRuleName = ''
$lastAppliedBrightness = $null
$lastCfgWrite = (Get-Item $script:CfgPath -ErrorAction SilentlyContinue).LastWriteTime

try {
    # 初始检测并应用
    $fg = Get-ForegroundInfo
    $rule = Get-MatchedRule $cfg $fg
    if ($rule) {
        $lastRuleName = $rule.name
        $lastAppliedBrightness = $rule.brightness
        if ($DryRun) {
            Write-Log ('[dry-run] 命中规则: {0}(进程={1}, 全屏={2}) 目标亮度={3}' -f $rule.name, $fg.ProcessName, $fg.Fullscreen, $rule.brightness)
        } else {
            try {
                $ok = Set-TVBacklight $rule.brightness
                Write-Log ('初始命中: {0}(进程={1}, 全屏={2}) 亮度 -> {3} {4}' -f $rule.name, $fg.ProcessName, $fg.Fullscreen, $rule.brightness, $(if ($ok) {'✅'} else {'❌'}))
            } catch {
                Write-Log ('设置亮度失败: {0}' -f $_.Exception.Message)
            }
        }
    } else {
        Write-Log ('初始: 无匹配规则(进程={0})' -f $fg.ProcessName)
    }
    Write-Status $fg $rule $(if ($DryRun) {'dry-run'} else { $lastAppliedBrightness }) ''

    if ($Once) { exit 0 }

    # 循环监听
    while ($true) {
        # 热重载: config.json 变化则重新加载
        $cfgFile = Get-Item $script:CfgPath -ErrorAction SilentlyContinue
        if ($cfgFile -and $cfgFile.LastWriteTime -ne $lastCfgWrite) {
            $lastCfgWrite = $cfgFile.LastWriteTime
            $oldCfg = $cfg
            $cfg = Read-Config
            Write-Log ('配置热重载: 规则数 {0} -> {1}' -f $oldCfg.rules.Count, $cfg.rules.Count)
            # 重载后强制重新评估
            $lastRuleName = ''
        }

        $fg = Get-ForegroundInfo
        $rule = Get-MatchedRule $cfg $fg
        if ($rule) {
            if ($rule.name -ne $lastRuleName -or $rule.brightness -ne $lastAppliedBrightness) {
                $desc = '命中: {0}(进程={1}, 标题={2}, 全屏={3}) 亮度 -> {4}' -f $rule.name, $fg.ProcessName, $fg.Title, $fg.Fullscreen, $rule.brightness
                if ($DryRun) {
                    Write-Log ('[dry-run] ' + $desc)
                } else {
                    try {
                        $ok = Set-TVBacklight $rule.brightness
                        Write-Log ($desc + (' {0}' -f $(if ($ok) {'✅'} else {'❌'})))
                        if ($ok) { $lastAppliedBrightness = $rule.brightness }
                    } catch {
                        Write-Log ('设置亮度失败: {0}' -f $_.Exception.Message)
                    }
                }
                $lastRuleName = $rule.name
            }
        } elseif ($lastRuleName -ne '') {
            Write-Log ('无匹配规则(进程={0})' -f $fg.ProcessName)
            $lastRuleName = ''
        }

        Write-Status $fg $rule $(if ($DryRun) {'dry-run'} else { $lastAppliedBrightness }) ''
        Start-Sleep -Milliseconds $cfg.pollIntervalMs
    }
} finally {
    if ($script:Config -and $script:Config.restoreOnExit -and -not $DryRun) {
        try {
            $null = Set-TVBacklight $script:Config.restoreValue
            Write-Log ('退出, 已恢复亮度 {0}' -f $script:Config.restoreValue)
        } catch { }
    }
    if ($script:Mutex) { $script:Mutex.ReleaseMutex() }
}
