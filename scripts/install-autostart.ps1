# install-autostart.ps1 - 注册 Windows 计划任务开机自启(用户登录时启动亮度切换)
# 用法: .\scripts\install-autostart.ps1
# 卸载: .\scripts\uninstall-autostart.ps1
# 需要管理员权限注册计划任务(或当前用户任务无需管理员)

$ErrorActionPreference = 'Stop'
$TaskName = 'WebOSTVBrightnessSwitcher'

$ScriptDir = Split-Path -Parent $PSScriptRoot
$VbsLauncher = Join-Path $ScriptDir 'scripts\tv-brightness-switcher.vbs'
$WScriptExe = (Get-Command wscript.exe).Source

# 用 wscript.exe + VBS 启动器实现完全无窗口后台运行
# (直接启动 powershell.exe 即使加 -WindowStyle Hidden, 任务计划程序仍会闪现控制台窗口)
$action = New-ScheduledTaskAction -Execute $WScriptExe -Argument "`"$VbsLauncher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'webOS 电视亮度自动切换: 游戏/视频 50, 其他 0(后台无窗口)' -Force | Out-Null

Write-Host "✅ 已注册计划任务: $TaskName (用户登录时启动, 后台无窗口)"
Write-Host "启动器: $VbsLauncher"
Write-Host ""
Write-Host "常用命令:"
Write-Host "  启动:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  停止:  Stop-ScheduledTask  -TaskName '$TaskName'"
Write-Host "  查询:  Get-ScheduledTask    -TaskName '$TaskName'"
Write-Host "  卸载:  .\scripts\uninstall-autostart.ps1"
