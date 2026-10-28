# Windows 后台无窗口运行 + 开机自启：通用规范

> 适用于：**任何需要在 Windows 上「开机自启 + 后台无窗口运行」的任务**（常驻脚本、守护进程、定时切换器等）。
> 本规范不绑定具体项目，可直接复制模板到任意任务使用。
> 本机已验证案例：`webos-tv-brightness`（电视亮度自动切换常驻脚本）。
>
> 核心结论一句话：**任务计划程序 + `wscript.exe` + VBS 启动器**，三层实现「登录自启 + 完全无窗口」。

## 0. 需求与目标

| 需求 | 说明 |
|---|---|
| 开机自启 | 用户登录 Windows 后自动运行，无需手动操作 |
| 后台无窗口 | 运行期间**不出现任何控制台窗口**（启动瞬间也不闪现） |
| 可卸载 | 有对应卸载脚本，不留残留 |
| 通用 | 模板可复用于任何其他常驻任务 |

## 1. 方案对比（为什么选 VBS）

| 方案 | 无窗口? | 说明 |
|---|---|---|
| **任务计划 + `wscript.exe` + VBS 启动器**（本规范） | ✅ 完全无窗口 | `WshShell.Run(..., 0, False)` 以隐藏窗口启动；wscript 本身是 GUI 宿主不弹窗 |
| 任务计划 + `powershell.exe -WindowStyle Hidden` | ❌ 启动瞬间闪现 | 任务计划程序直接启动控制台程序时，即使 `-WindowStyle Hidden`，窗口仍会短暂闪现（`nvidia-brightness-switcher` 旧方案即如此） |
| 任务计划 + 直接运行 exe | ⚠️ 取决于程序 | 控制台程序必弹窗；GUI 程序可能无窗口但需自行处理 |
| 注册表 `Run` 键 | ⚠️ 同 -WindowStyle Hidden 问题 | 无任务计划的可视化管理与错误记录 |
| Windows 服务(sc.exe) | ✅ 无窗口 | 但需要管理员权限、服务账户、无法直接访问用户会话的 GUI/前台窗口检测 |

**结论**：普通用户级任务（登录后运行、需要访问交互会话如前台窗口检测）用 **wscript + VBS** 最合适。

## 2. 架构总览

```
[计划任务]  (用户登录时触发, 无需管理员权限)
   └─> wscript.exe tv-runner.vbs     ← 无窗口 GUI 宿主, 保持运行(等待主脚本)
          └─> WshShell.Run("powershell ... 主脚本.ps1", 0, True)   ← 隐藏窗口启动, 等待
               └─> 主脚本.ps1         ← 真正的常驻逻辑(无限循环/守护)
                    └─> (可选) 单实例互斥锁
```

- **wscript.exe**：Windows 的 GUI 脚本宿主，本身不弹控制台窗口；
- **VBS 启动器**：`Run(..., 0, True)` 的 `0` = 隐藏窗口，`True` = **等待**主脚本退出（**必须 True**，否则任务计划器清理子进程树，见 §3.2 踩坑说明）；
- **主脚本.ps1**：常驻逻辑 + 日志 + 单实例保护。

## 3. 通用模板

### 3.1 项目结构（约定）

```
<任意项目>/
├─ src/ 或 scripts/        ← main.ps1 与 runner.vbs 必须同一目录
│  ├─ main.ps1            ← 常驻主脚本(你自己的逻辑)
│  ├─ runner.vbs          ← 无窗口启动器(模板, 改脚本名即可)
│  ├─ install-autostart.ps1    ← 注册计划任务(模板)
│  └─ uninstall-autostart.ps1  ← 卸载计划任务(模板)
└─ logs/                  ← 主脚本写日志
```

> **约定**：`main.ps1` 与 `runner.vbs` **必须放在同一目录**（VBS 用 `GetParentFolderName(ScriptFullName)` 定位同目录主脚本）。

### 3.2 VBS 启动器（`runner.vbs` 模板）

```vbs
' runner.vbs - 无窗口启动器
' 用 wscript.exe 运行: wscript.exe "C:\路径\runner.vbs"
' 以隐藏窗口方式启动 PowerShell 常驻脚本
Option Explicit

Dim shell, scriptPath
Set shell = CreateObject("WScript.Shell")

' 主脚本与 VBS 放在同一目录(推荐结构):
' GetParentFolderName(ScriptFullName) 返回 VBS 所在目录
scriptPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
scriptPath = shell.ExpandEnvironmentStrings(scriptPath) & "\main.ps1"

' 参数 0 = 隐藏窗口; True = 等待 powershell 退出(关键, 见下方说明)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """", 0, True
```

> **说明**：
> - `-ExecutionPolicy Bypass`：绕过执行策略限制（个人电脑常用）；
> - `-WindowStyle Hidden`：双保险，即使有窗口也隐藏；
> - `ExpandEnvironmentStrings` 处理路径中的环境变量（如 `%USERPROFILE%`）；
> - **路径约定**：VBS 与主脚本 `.ps1` **放在同一目录**，`GetParentFolderName(ScriptFullName)` 即返回该目录（注意：它返回的是 VBS 文件所在目录，不是上一级）；
> - **⚠️ `Run` 第三参数必须为 `True`（等待）**：若用 `False`（不等待），wscript 启动 powershell 后立即退出，任务计划器判定任务「已完成」并**清理整个子进程树**，常驻进程会被终止（本规范实测踩坑）。用 `True` 时 wscript 保持运行（无窗口），任务保持 Running，子进程不被清理；
> - **⚠️ 编码必须为 ANSI（或纯英文注释）**：VBScript 引擎用 ANSI 解析，若 .vbs 保存为 UTF-8（尤其含中文注释），wscript 会解析乱码导致脚本直接失败（本规范实测踩坑）。**模板注释用英文 + 文件存 ANSI 最稳妥**；如用中文注释，文件必须存 ANSI/GBK 或 UTF-16 LE with BOM。PowerShell 保存 ANSI：`[IO.File]::WriteAllText($path, $content, [Text.Encoding]::GetEncoding([Text.Encoding]::Default.CodePage))`。

### 3.3 注册计划任务（`install-autostart.ps1` 模板）

```powershell
# install-autostart.ps1 - 注册开机自启(登录时后台无窗口运行)
# 用法: .\install-autostart.ps1
# 无需管理员权限(当前用户登录触发)

$ErrorActionPreference = 'Stop'
$TaskName = 'MyBackgroundTask'                       # ← 改成你的任务名(全局唯一)
$ProjectDir = Split-Path -Parent $PSScriptRoot
$VbsLauncher = Join-Path $ProjectDir 'src\runner.vbs' # ← 改成你的 VBS 路径
$WScriptExe = (Get-Command wscript.exe).Source

$action = New-ScheduledTaskAction -Execute $WScriptExe -Argument "`"$VbsLauncher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero)   # 0 = 无限运行(常驻任务必须)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description '你的任务描述' -Force | Out-Null

Write-Host "✅ 已注册计划任务: $TaskName (登录时后台无窗口启动)"
Write-Host "常用命令:"
Write-Host "  启动:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  停止:  Stop-ScheduledTask  -TaskName '$TaskName'"
Write-Host "  查询:  Get-ScheduledTask    -TaskName '$TaskName'"
```

**关键设置**：
| 设置 | 值 | 原因 |
|---|---|---|
| 触发器 | `AtLogOn`（用户登录时） | 常驻任务需要交互会话（如前台窗口检测）；"系统启动时"需管理员且在会话 0 无 GUI |
| `ExecutionTimeLimit` | `[TimeSpan]::Zero`（无限） | 常驻脚本无限循环,默认 3 天会被杀 |
| `AllowStartIfOnBatteries` / `DontStopIfGoingOnBatteries` | 开启 | 笔记本不因电池状态中断 |
| `StartWhenAvailable` | 开启 | 错过触发时间(如睡眠)后补跑 |

### 3.4 卸载（`uninstall-autostart.ps1` 模板）

```powershell
# uninstall-autostart.ps1 - 卸载计划任务
$ErrorActionPreference = 'Stop'
$TaskName = 'MyBackgroundTask'                       # ← 与安装脚本一致

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "计划任务 $TaskName 不存在, 无需卸载。"
    exit 0
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "✅ 已卸载计划任务: $TaskName"
```

### 3.5 常驻主脚本骨架（`main.ps1` 模板）

```powershell
#requires -Version 5.1
# main.ps1 - 常驻任务主脚本(骨架)
param([switch]$Once, [switch]$Console)   # 按需

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot

# ---------- 单实例保护(防止重复启动) ----------
$script:Mutex = New-Object System.Threading.Mutex($false, 'Global\MyTaskMutex')  # ← 改成全局唯一名
if (-not $script:Mutex.WaitOne(0)) {
    Write-Warning '任务已在运行, 本次启动取消。'
    exit 1
}

# ---------- 日志 ----------
$script:LogFile = Join-Path $ProjectDir 'logs\task.log'
New-Item -ItemType Directory -Force -Path (Split-Path $script:LogFile) | Out-Null
function Write-Log {
    param([string]$Message)
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $script:LogFile -Value $line -Encoding UTF8
    if ($Console) { Write-Host $Message }
}

Write-Log '启动'

try {
    if ($Once) { /* 单次逻辑 */; exit 0 }
    while ($true) {          # 常驻循环
        /* 你的业务逻辑 */
        Start-Sleep -Seconds 1
    }
} finally {
    if ($script:Mutex) { $script:Mutex.ReleaseMutex() }
}
```

> **重要**：常驻脚本里**不要用相对路径**——计划任务的工作目录通常是 `C:\Windows\System32`，一律用 `$PSScriptRoot` / `$ProjectDir` 拼完整路径。

## 4. 验证方法（装机后必做）

1. **注册**：`.\install-autostart.ps1` → 输出「已注册」。
2. **查看任务**：`Get-ScheduledTask -TaskName '<你的任务名>'` → State 应为 `Ready`；
   `Get-ScheduledTaskInfo` → LastTaskResult = `0` 表示上次运行成功。
3. **启动**：`Start-ScheduledTask -TaskName '<你的任务名>'`。
4. **确认任务保持 Running**：`Get-ScheduledTaskInfo` → State 应为 `Running`（wscript 等待中）。若变回 `Ready` 说明子进程被清理（检查 §5 的「Run 第三参数」坑）。
5. **确认无窗口**：
   ```powershell
   Get-Process | Where-Object { $_.ProcessName -in @('wscript','powershell','node','python') } |
       Select-Object Id, ProcessName, MainWindowTitle, MainWindowHandle
   ```
   → 常驻进程应 **MainWindowTitle 为空、MainWindowHandle = 0**（无可见窗口）；
   → wscript.exe 会**保持运行**（无窗口，它是等待者，属正常）。
6. **确认逻辑生效**：看 `logs\task.log` 是否有启动记录和后续输出。
7. **单实例**：再手动跑一次主脚本 → 应提示「已在运行, 本次启动取消」。
8. **重启验证**（可选）：注销/登录后任务自动启动。

## 5. 踩坑清单（前人经验）

| 坑 | 现象 | 解法 |
|---|---|---|
| `-WindowStyle Hidden` 直启仍闪窗口 | 任务计划启动瞬间弹控制台窗口 | 必须用 wscript + VBS（本规范） |
| **VBS `Run` 第三参数用了 `False`** | 任务变回 Ready,常驻进程被终止 | 必须用 `True`（等待）——否则 wscript 退出导致任务计划器清理子进程树（本规范实测踩坑） |
| **VBS 文件存成 UTF-8(含中文注释)** | wscript 解析乱码,脚本静默失败 | VBS 必须 ANSI/GBK 或 UTF-16 with BOM;注释用英文最稳妥（本规范实测踩坑） |
| 相对路径失效 | 脚本报「找不到文件」 | 计划任务工作目录是 System32,一律绝对路径/`$PSScriptRoot` |
| 环境变量缺失 | 脚本里 `$env:XXX` 为空 | 计划任务不继承用户手动设置的环境变量,脚本内写默认值兜底 |
| 常驻脚本 3 天被终止 | 任务运行几天后消失 | `ExecutionTimeLimit = [TimeSpan]::Zero`（无限） |
| 重复实例 | 多个常驻进程同时跑 | 单实例互斥锁（Global 命名,所有会话可见） |
| 睡眠后不触发 | 错过登录触发时间 | `StartWhenAvailable` |
| 卸载不干净 | 任务残留 | 统一用 `uninstall-autostart.ps1`,`Unregister-ScheduledTask -Confirm:$false` |
| 中文/带空格路径 | wscript 找不到脚本 | 路径一律加双引号,模板已处理 |

## 6. 本机已落地案例

**webos-tv-brightness**（电视亮度自动切换）已按本规范实现并通过全部验证：

| 项 | 值 |
|---|---|
| 任务名 | `WebOSTVBrightnessSwitcher` |
| VBS | `C:\0_Code\webos-tv-brightness\scripts\tv-brightness-switcher.vbs`（ANSI 编码,英文注释） |
| 主脚本 | `C:\0_Code\webos-tv-brightness\scripts\tv-brightness-switcher.ps1` |
| 安装/卸载 | `scripts\install-autostart.ps1` / `scripts\uninstall-autostart.ps1` |
| 日志 | `logs\switcher.log` |
| 验证 | 任务 State=Running ✅；powershell 常驻 + wscript 等待（均 MainWindowHandle=0 无窗口）✅；LastTaskResult=0 ✅；单实例互斥生效 ✅ |

> 对照参考：旧项目 `nvidia-brightness-switcher` 的 `install-autostart.ps1` 用的是 `powershell.exe -WindowStyle Hidden` 直启（有窗口闪现问题），可依本规范升级。

## 7. 相关文件

| 文件 | 作用 |
|---|---|
| `docs/电视亮度调整-调查记录.md` | 电视亮度控制完整调查与实测记录 |
| `README.md` | 项目使用说明 |
