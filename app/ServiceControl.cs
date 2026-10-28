using System;
using System.Diagnostics;
using System.IO;

namespace WebosBrightness
{
    // 后台服务控制: 启停计划任务、开机自启、状态查询
    public static class ServiceControl
    {
        public const string TaskName = "WebOSTVBrightnessSwitcher";

        // 查询计划任务状态: Ready / Running / Disabled / ""
        public static string GetTaskState()
        {
            string outStr = RunPowershellQuiet(
                "(Get-ScheduledTask -TaskName '" + TaskName + "').State.ToString()");
            return outStr;
        }

        // 服务是否在运行: 任务 Running 或常驻进程存在
        public static bool IsRunning()
        {
            string state = GetTaskState();
            if (state == "Running") return true;
            // 兜底: 检查常驻 powershell 进程(命令行含 switcher 脚本)
            string ps = "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | " +
                "Where-Object { $_.CommandLine -match 'tv-brightness-switcher' } | Measure-Object | Select-Object -ExpandProperty Count";
            string count = RunPowershellQuiet(ps);
            int n;
            return int.TryParse(count, out n) && n > 0;
        }

        public static bool IsAutostartEnabled()
        {
            string state = GetTaskState();
            // 任务存在(Ready/Running)即认为已启用自启
            return state == "Ready" || state == "Running";
        }

        public static string Start()
        {
            return RunPowershell("Start-ScheduledTask -TaskName '" + TaskName + "'");
        }

        public static string Stop()
        {
            return RunPowershell("Stop-ScheduledTask -TaskName '" + TaskName + "'");
        }

        public static string EnableAutostart()
        {
            string script = Path.Combine(ProjectPaths.Root, "scripts", "install-autostart.ps1");
            return RunPowershell("-ExecutionPolicy Bypass -File \"" + script + "\"");
        }

        public static string DisableAutostart()
        {
            string script = Path.Combine(ProjectPaths.Root, "scripts", "uninstall-autostart.ps1");
            return RunPowershell("-ExecutionPolicy Bypass -File \"" + script + "\"");
        }

        // 立即应用一次当前策略(不常驻)
        public static string ApplyNow()
        {
            string script = Path.Combine(ProjectPaths.Root, "scripts", "tv-brightness-switcher.ps1");
            return RunPowershell("-ExecutionPolicy Bypass -File \"" + script + "\" -Once");
        }

        // 读取日志尾部
        public static string ReadLogTail(int lines = 10)
        {
            try
            {
                if (!File.Exists(ProjectPaths.LogPath)) return "(暂无日志)";
                var all = File.ReadAllLines(ProjectPaths.LogPath);
                int take = Math.Min(lines, all.Length);
                var tail = new string[take];
                Array.Copy(all, all.Length - take, tail, 0, take);
                return string.Join("\r\n", tail);
            }
            catch (Exception ex)
            {
                return "(日志读取失败: " + ex.Message + ")";
            }
        }

        static string RunPowershell(string args)
        {
            try
            {
                var psi = new ProcessStartInfo("powershell", "-NoProfile -NonInteractive " + args)
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                };
                using (var p = Process.Start(psi))
                {
                    string outStr = "";
                    string errStr = "";
                    if (!p.WaitForExit(15000))
                    {
                        try { p.Kill(); } catch { }
                        return "(命令超时)";
                    }
                    outStr = p.StandardOutput.ReadToEnd();
                    errStr = p.StandardError.ReadToEnd();
                    return (outStr + errStr).Trim();
                }
            }
            catch (Exception ex)
            {
                return "调用失败: " + ex.Message;
            }
        }

        static string RunPowershellQuiet(string command)
        {
            try
            {
                var psi = new ProcessStartInfo("powershell",
                    "-NoProfile -NonInteractive -Command \"" + command + "\"")
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                };
                using (var p = Process.Start(psi))
                {
                    if (!p.WaitForExit(5000))
                    {
                        try { p.Kill(); } catch { }
                        return "";
                    }
                    return p.StandardOutput.ReadToEnd().Trim();
                }
            }
            catch { return ""; }
        }
    }
}
