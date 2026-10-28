# uninstall-autostart.ps1 - 卸载计划任务(停止开机自启)
# 用法: .\scripts\uninstall-autostart.ps1

$ErrorActionPreference = 'Stop'
$TaskName = 'WebOSTVBrightnessSwitcher'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "计划任务 $TaskName 不存在, 无需卸载。"
    exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "✅ 已卸载计划任务: $TaskName"
