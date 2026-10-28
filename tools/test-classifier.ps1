# test-classifier.ps1 - 分类逻辑单元测试(不调电视亮度)
# 直接加载 tv-brightness-switcher.ps1 里的 Get-Mode,用假前台数据验证各分支
# 用法: .\tools\test-classifier.ps1
$ErrorActionPreference = 'Stop'

# 提取 Get-Mode 与 Read-Config 定义(不执行主流程)
$switcherPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\tv-brightness-switcher.ps1'
$code = Get-Content $switcherPath -Raw

# 截取从 "# ---------- 配置 ----------" 到 "# ---------- 日志 ----------" 前的定义部分
$start = $code.IndexOf('# ---------- 配置 ----------')
$end = $code.IndexOf('# ---------- 日志 ----------')
if ($start -lt 0 -or $end -lt 0 -or $end -le $start) {
    throw '无法提取配置/模式判定代码段'
}
$defs = $code.Substring($start, $end - $start)
$script:ScriptDir = Split-Path -Parent $PSScriptRoot
Invoke-Expression $defs

$cfg = Read-Config

# 假前台数据测试用例
$cases = @(
    @{ Name='全屏游戏(应 media)';        Fg=@{ProcessName='GTA5_Enhanced'; Title='Grand Theft Auto V'; Fullscreen=$true};  Expect='media' },
    @{ Name='全屏游戏2(应 media)';        Fg=@{ProcessName='eldenring';        Title='ELDEN RING';          Fullscreen=$true};  Expect='media' },
    @{ Name='视频播放器(应 media)';       Fg=@{ProcessName='vlc';              Title='movie.mp4 - VLC';     Fullscreen=$false}; Expect='media' },
    @{ Name='PotPlayer(应 media)';        Fg=@{ProcessName='potplayermini64';  Title='anime.mkv';           Fullscreen=$false}; Expect='media' },
    @{ Name='浏览器看B站视频(应 media)';  Fg=@{ProcessName='msedge';           Title='哔哩哔哩 - Microsoft Edge'; Fullscreen=$false}; Expect='media' },
    @{ Name='浏览器看YouTube(应 media)';  Fg=@{ProcessName='chrome';           Title='YouTube - Google Chrome';    Fullscreen=$false}; Expect='media' },
    @{ Name='浏览器普通页面(应 idle)';    Fg=@{ProcessName='msedge';           Title='文档 - Microsoft Edge';      Fullscreen=$false}; Expect='idle' },
    @{ Name='浏览器全屏普通页(应 idle)';  Fg=@{ProcessName='chrome';           Title='设置 - Google Chrome';       Fullscreen=$true};  Expect='idle' },
    @{ Name='桌面/资源管理器(应 idle)';   Fg=@{ProcessName='explorer';         Title='';                         Fullscreen=$false}; Expect='idle' },
    @{ Name='全屏终端(应 idle)';          Fg=@{ProcessName='windowsterminal';  Title='PowerShell';               Fullscreen=$true};  Expect='idle' },
    @{ Name='办公软件(应 idle)';          Fg=@{ProcessName='winword';          Title='报告.docx - Word';          Fullscreen=$true};  Expect='idle' },
    @{ Name='无前台(应空,保持)';          Fg=@{ProcessName='';                 Title='';                         Fullscreen=$false}; Expect='' }
)

$pass = 0; $fail = 0
foreach ($c in $cases) {
    $fgo = [pscustomobject]@{
        ProcessName = $c.Fg.ProcessName
        Title       = $c.Fg.Title
        Fullscreen  = $c.Fg.Fullscreen
        OnPrimary   = $true
    }
    $got = Get-Mode $cfg $fgo
    $ok = ($got -eq $c.Expect)
    if ($ok) { $pass++ } else { $fail++ }
    "{0} {1}: got='{2}' expect='{3}'" -f $(if ($ok) {'✅'} else {'❌'}), $c.Name, $got, $c.Expect
}
Write-Host ""
"通过 {0} / {1}" -f $pass, ($pass + $fail)
if ($fail -gt 0) { exit 1 } else { exit 0 }
