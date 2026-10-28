using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace WebosBrightness
{
    // 服务实时状态(读 status.json)
    public class ServiceStatus
    {
        public string UpdatedAt { get; set; }
        public string Process { get; set; }
        public string Title { get; set; }
        public bool Fullscreen { get; set; }
        public string MatchedRule { get; set; }
        public int? TargetBrightness { get; set; }
        public string Applied { get; set; }
        public string Error { get; set; }
        public bool ServiceRunning { get; set; }

        public static ServiceStatus Read()
        {
            var s = new ServiceStatus();
            if (!File.Exists(ProjectPaths.StatusPath)) return s;
            try
            {
                var ser = new JavaScriptSerializer();
                var json = ser.Deserialize<Dictionary<string, object>>(
                    File.ReadAllText(ProjectPaths.StatusPath, Encoding.UTF8));
                if (json == null) return s;
                if (json.ContainsKey("updatedAt")) s.UpdatedAt = Str(json["updatedAt"]);
                if (json.ContainsKey("matchedRule")) s.MatchedRule = Str(json["matchedRule"]);
                if (json.ContainsKey("applied")) s.Applied = Str(json["applied"]);
                if (json.ContainsKey("error")) s.Error = Str(json["error"]);
                if (json.ContainsKey("serviceRunning")) s.ServiceRunning = Bool(json["serviceRunning"]);
                if (json.ContainsKey("targetBrightness") && json["targetBrightness"] != null)
                {
                    int v;
                    if (int.TryParse(json["targetBrightness"].ToString(), out v))
                        s.TargetBrightness = v;
                }
                if (json.ContainsKey("foreground") && json["foreground"] is Dictionary<string, object>)
                {
                    var fg = (Dictionary<string, object>)json["foreground"];
                    if (fg.ContainsKey("process")) s.Process = Str(fg["process"]);
                    if (fg.ContainsKey("title")) s.Title = Str(fg["title"]);
                    if (fg.ContainsKey("fullscreen")) s.Fullscreen = Bool(fg["fullscreen"]);
                }
            }
            catch { }
            return s;
        }

        static string Str(object o) { return o == null ? "" : o.ToString(); }
        static bool Bool(object o)
        {
            bool v;
            return o != null && bool.TryParse(o.ToString(), out v) && v;
        }
    }
}
