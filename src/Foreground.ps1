#requires -Version 5.1
<#
  Foreground.ps1 - 前台窗口检测核心函数库(P/Invoke)
  提供: 前台进程名/窗口标题/是否全屏/所在显示器
  用法: 在其他脚本中 . .\Foreground.ps1 后调用 Get-ForegroundInfo
#>

$script:FgNativeReady = $false

function Initialize-FgNative {
    if ($script:FgNativeReady) { return }
    $cs = @'
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class FgNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFOEX
    {
        public uint cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, ref RECT lprcMonitor, IntPtr dwData);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool GetMonitorInfoW(IntPtr hMonitor, ref MONITORINFOEX lpmi);
    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
    [DllImport("user32.dll")]
    public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    private const uint MONITOR_DEFAULTTONEAREST = 2;

    public static string GetForegroundProcessName()
    {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "";
        uint pid = 0;
        GetWindowThreadProcessId(h, out pid);
        if (pid == 0) return "";
        try
        {
            using (Process p = Process.GetProcessById((int)pid)) { return p.ProcessName; }
        }
        catch { return ""; }
    }

    public static string GetForegroundWindowTitle()
    {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "";
        StringBuilder sb = new StringBuilder(512);
        GetWindowTextW(h, sb, 512);
        return sb.ToString();
    }

    // 前台窗口是否铺满其所在显示器(全屏, 容差 2px)
    public static bool IsForegroundFullscreen()
    {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return false;
        if (!IsWindowVisible(h)) return false;
        RECT w;
        if (!GetWindowRect(h, out w)) return false;
        IntPtr mon = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST);
        if (mon == IntPtr.Zero) return false;
        MONITORINFOEX mi = new MONITORINFOEX();
        mi.cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFOEX));
        if (!GetMonitorInfoW(mon, ref mi)) return false;
        int tol = 2;
        return Math.Abs(w.Left - mi.rcMonitor.Left) <= tol
            && Math.Abs(w.Top - mi.rcMonitor.Top) <= tol
            && Math.Abs(w.Right - mi.rcMonitor.Right) <= tol
            && Math.Abs(w.Bottom - mi.rcMonitor.Bottom) <= tol;
    }

    // 前台窗口所在显示器是否为主显示器(电视当唯一显示器时恒为 true)
    public static bool IsForegroundOnPrimary()
    {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return true;
        IntPtr mon = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST);
        if (mon == IntPtr.Zero) return true;
        MONITORINFOEX mi = new MONITORINFOEX();
        mi.cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFOEX));
        if (!GetMonitorInfoW(mon, ref mi)) return true;
        return (mi.dwFlags & 1) != 0; // MONITORINFOF_PRIMARY
    }
}
'@
    Add-Type -TypeDefinition $cs
    $script:FgNativeReady = $true
}

<#
.SYNOPSIS
  获取前台窗口信息(进程名/标题/是否全屏/是否在主显示器)。
#>
function Get-ForegroundInfo {
    Initialize-FgNative
    [pscustomobject]@{
        ProcessName = [FgNative]::GetForegroundProcessName()
        Title       = [FgNative]::GetForegroundWindowTitle()
        Fullscreen  = [FgNative]::IsForegroundFullscreen()
        OnPrimary   = [FgNative]::IsForegroundOnPrimary()
    }
}
