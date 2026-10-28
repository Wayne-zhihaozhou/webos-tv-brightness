using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace WebosBrightness
{
    // 一条亮度规则
    public class Rule
    {
        public string Name { get; set; }
        public int Brightness { get; set; }
        public bool MatchFullscreen { get; set; }
        public List<string> Processes { get; set; }
        public List<string> TitleKeywords { get; set; }
        public List<string> IgnoreProcesses { get; set; }

        public Rule()
        {
            Name = "新规则";
            Brightness = 50;
            MatchFullscreen = false;
            Processes = new List<string>();
            TitleKeywords = new List<string>();
            IgnoreProcesses = new List<string>();
        }

        public string ConditionSummary()
        {
            var parts = new List<string>();
            if (MatchFullscreen) parts.Add("全屏");
            if (Processes.Count > 0) parts.Add(string.Format("进程({0}个)", Processes.Count));
            if (TitleKeywords.Count > 0) parts.Add(string.Format("标题关键词({0}个)", TitleKeywords.Count));
            if (parts.Count == 0) return "其他(兜底)";
            return string.Join(" 或 ", parts);
        }
    }

    // 整个配置
    public class AppConfig
    {
        public string TvIp { get; set; }
        public string LocalAddr { get; set; }
        public int PollIntervalMs { get; set; }
        public bool RestoreOnExit { get; set; }
        public int RestoreValue { get; set; }
        public List<Rule> Rules { get; set; }

        public AppConfig()
        {
            TvIp = "192.168.1.4";
            LocalAddr = "192.168.1.5";
            PollIntervalMs = 1000;
            RestoreOnExit = false;
            RestoreValue = 60;
            Rules = new List<Rule>();
        }
    }

    // config.json 读写(与后台服务脚本格式一致, 零第三方依赖)
    public static class ConfigStore
    {
        public static string ConfigPath
        {
            get { return Path.Combine(ProjectPaths.Root, "config.json"); }
        }

        public static AppConfig Load()
        {
            var cfg = new AppConfig();
            if (!File.Exists(ConfigPath)) return cfg;
            try
            {
                var ser = new JavaScriptSerializer();
                var json = ser.Deserialize<Dictionary<string, object>>(
                    File.ReadAllText(ConfigPath, Encoding.UTF8));
                if (json == null) return cfg;

                if (json.ContainsKey("tvIp")) cfg.TvIp = Str(json["tvIp"], cfg.TvIp);
                if (json.ContainsKey("localAddr")) cfg.LocalAddr = Str(json["localAddr"], cfg.LocalAddr);
                if (json.ContainsKey("pollIntervalMs")) cfg.PollIntervalMs = Int(json["pollIntervalMs"], cfg.PollIntervalMs);
                if (json.ContainsKey("restoreOnExit")) cfg.RestoreOnExit = Bool(json["restoreOnExit"], cfg.RestoreOnExit);
                if (json.ContainsKey("restoreValue")) cfg.RestoreValue = Int(json["restoreValue"], cfg.RestoreValue);

                if (json.ContainsKey("rules"))
                {
                    var rulesArr = json["rules"] as System.Collections.ArrayList;
                    if (rulesArr != null)
                    {
                        cfg.Rules.Clear();
                        foreach (object obj in rulesArr)
                        {
                            var r = obj as Dictionary<string, object>;
                            if (r == null) continue;
                            var rule = new Rule();
                            if (r.ContainsKey("name")) rule.Name = Str(r["name"], rule.Name);
                            if (r.ContainsKey("brightness")) rule.Brightness = Int(r["brightness"], rule.Brightness);
                            if (r.ContainsKey("matchFullscreen")) rule.MatchFullscreen = Bool(r["matchFullscreen"], rule.MatchFullscreen);
                            if (r.ContainsKey("processes")) rule.Processes = StrList(r["processes"]);
                            if (r.ContainsKey("titleKeywords")) rule.TitleKeywords = StrList(r["titleKeywords"]);
                            if (r.ContainsKey("ignoreProcesses")) rule.IgnoreProcesses = StrList(r["ignoreProcesses"]);
                            cfg.Rules.Add(rule);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                System.Windows.Forms.MessageBox.Show("config.json 读取失败: " + ex.Message, "错误",
                    System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Warning);
            }
            return cfg;
        }

        public static void Save(AppConfig cfg)
        {
            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine(string.Format("  \"tvIp\": \"{0}\",", JsonEsc(cfg.TvIp)));
            sb.AppendLine(string.Format("  \"localAddr\": \"{0}\",", JsonEsc(cfg.LocalAddr)));
            sb.AppendLine(string.Format("  \"pollIntervalMs\": {0},", cfg.PollIntervalMs));
            sb.AppendLine(string.Format("  \"restoreOnExit\": {0},", cfg.RestoreOnExit ? "true" : "false"));
            sb.AppendLine(string.Format("  \"restoreValue\": {0},", cfg.RestoreValue));
            sb.AppendLine("  \"rules\": [");
            for (int i = 0; i < cfg.Rules.Count; i++)
            {
                var r = cfg.Rules[i];
                sb.AppendLine("    {");
                sb.AppendLine(string.Format("      \"name\": \"{0}\",", JsonEsc(r.Name)));
                sb.AppendLine(string.Format("      \"brightness\": {0},", r.Brightness));
                sb.AppendLine(string.Format("      \"matchFullscreen\": {0},", r.MatchFullscreen ? "true" : "false"));
                sb.AppendLine("      \"processes\": " + JsonArr(r.Processes) + ",");
                sb.AppendLine("      \"titleKeywords\": " + JsonArr(r.TitleKeywords) + ",");
                sb.AppendLine("      \"ignoreProcesses\": " + JsonArr(r.IgnoreProcesses));
                sb.AppendLine((i < cfg.Rules.Count - 1 ? "    }," : "    }"));
            }
            sb.AppendLine("  ]");
            sb.AppendLine("}");
            File.WriteAllText(ConfigPath, sb.ToString(), new UTF8Encoding(true));
        }

        static string JsonArr(List<string> list)
        {
            if (list == null || list.Count == 0) return "[]";
            var items = new List<string>();
            foreach (var s in list)
                if (!string.IsNullOrEmpty(s)) items.Add("\"" + JsonEsc(s) + "\"");
            return "[" + string.Join(", ", items) + "]";
        }

        static string JsonEsc(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        static string Str(object o, string def)
        {
            return o == null ? def : o.ToString();
        }

        static int Int(object o, int def)
        {
            int v;
            return int.TryParse(o == null ? "" : o.ToString(), out v) ? v : def;
        }

        static bool Bool(object o, bool def)
        {
            if (o == null) return def;
            bool v;
            return bool.TryParse(o.ToString(), out v) ? v : def;
        }

        static List<string> StrList(object o)
        {
            var result = new List<string>();
            var arr = o as System.Collections.ArrayList;
            if (arr != null)
            {
                foreach (object item in arr)
                    if (item != null) result.Add(item.ToString());
            }
            return result;
        }
    }

    // 项目路径
    public static class ProjectPaths
    {
        public static string Root
        {
            get
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                // 从可执行文件所在目录向上找含 config.json 的项目根
                var d = new DirectoryInfo(baseDir);
                while (d != null)
                {
                    if (File.Exists(Path.Combine(d.FullName, "config.json")))
                        return d.FullName;
                    d = d.Parent;
                }
                return baseDir;
            }
        }

        public static string StatusPath { get { return Path.Combine(Root, "status.json"); } }
        public static string LogPath { get { return Path.Combine(Root, "logs", "switcher.log"); } }
        public static string SwitcherScript { get { return Path.Combine(Root, "scripts", "tv-brightness-switcher.ps1"); } }
        public static string VbsLauncher { get { return Path.Combine(Root, "scripts", "tv-brightness-switcher.vbs"); } }
    }
}
