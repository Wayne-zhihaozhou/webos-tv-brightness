using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace WebosBrightness
{
    // 主窗口: ①电视连接 ②亮度规则 ③后台服务 ④实时状态 ⑤日志
    public class MainForm : Form
    {
        // ① 电视连接
        TextBox txtTvIp;
        TextBox txtLocalAddr;
        Label lblConnStatus;
        Button btnPair;
        Button btnTest;

        // ② 亮度规则
        ListView listRules;
        Button btnAddRule;
        Button btnEditRule;
        Button btnDelRule;
        Button btnUpRule;
        Button btnDownRule;

        // ③ 后台服务
        Label lblServiceStatus;
        Button btnServiceStart;
        Button btnServiceStop;
        CheckBox chkAutostart;

        // ④ 实时状态
        Label lblForeground;
        Label lblMatched;
        Label lblBrightness;

        // ⑤ 日志
        TextBox txtLog;

        System.Windows.Forms.Timer timer;

        public MainForm()
        {
            InitUi();
            LoadConfigToUi();
            RefreshAll();
            timer = new System.Windows.Forms.Timer();
            timer.Interval = 2000;
            timer.Tick += (s, e) => RefreshStatus();
            timer.Start();
        }

        void InitUi()
        {
            Text = "webOS 电视亮度控制器";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(760, 700);
            Font = new Font("Microsoft YaHei UI", 9F);

            // ── ① 电视连接 ──
            var grpConn = new GroupBox { Text = "① 电视连接", Location = new Point(12, 8), Size = new Size(736, 86) };
            grpConn.Controls.Add(MakeLabel("电视 IP:", 12, 30));
            txtTvIp = new TextBox { Location = new Point(90, 26), Width = 130 };
            grpConn.Controls.Add(txtTvIp);
            grpConn.Controls.Add(MakeLabel("本机源地址:", 240, 30));
            txtLocalAddr = new TextBox { Location = new Point(330, 26), Width = 130 };
            grpConn.Controls.Add(txtLocalAddr);
            lblConnStatus = MakeLabel("连接状态: --", 12, 56, 320);
            grpConn.Controls.Add(lblConnStatus);
            btnPair = new Button { Text = "重新配对", Location = new Point(500, 22), Width = 90 };
            btnPair.Click += (s, e) => DoPair();
            grpConn.Controls.Add(btnPair);
            btnTest = new Button { Text = "测试连接", Location = new Point(600, 22), Width = 90 };
            btnTest.Click += (s, e) => DoTest();
            grpConn.Controls.Add(btnTest);
            Controls.Add(grpConn);

            // ── ② 亮度规则 ──
            var grpRules = new GroupBox { Text = "② 亮度规则(自上而下匹配,第一条命中生效)", Location = new Point(12, 102), Size = new Size(736, 260) };
            listRules = new ListView
            {
                Location = new Point(12, 22),
                Size = new Size(600, 190),
                View = View.Details,
                FullRowSelect = true,
                GridLines = true,
            };
            listRules.Columns.Add("#", 30);
            listRules.Columns.Add("规则名称", 110);
            listRules.Columns.Add("匹配条件", 250);
            listRules.Columns.Add("亮度", 60);
            listRules.Columns.Add("类型", 80);
            grpRules.Controls.Add(listRules);

            btnAddRule = new Button { Text = "+ 添加", Location = new Point(620, 22), Width = 100 };
            btnAddRule.Click += (s, e) => AddRule();
            btnEditRule = new Button { Text = "编辑", Location = new Point(620, 58), Width = 100 };
            btnEditRule.Click += (s, e) => EditRule();
            btnDelRule = new Button { Text = "删除", Location = new Point(620, 94), Width = 100 };
            btnDelRule.Click += (s, e) => DeleteRule();
            btnUpRule = new Button { Text = "↑ 上移", Location = new Point(620, 130), Width = 100 };
            btnUpRule.Click += (s, e) => MoveRule(-1);
            btnDownRule = new Button { Text = "↓ 下移", Location = new Point(620, 166), Width = 100 };
            btnDownRule.Click += (s, e) => MoveRule(1);
            grpRules.Controls.Add(btnAddRule);
            grpRules.Controls.Add(btnEditRule);
            grpRules.Controls.Add(btnDelRule);
            grpRules.Controls.Add(btnUpRule);
            grpRules.Controls.Add(btnDownRule);

            var lblRuleHint = MakeLabel("提示: 条件全空的规则 = 兜底(其他所有情况),不可删除", 12, 224, 700);
            grpRules.Controls.Add(lblRuleHint);
            Controls.Add(grpRules);

            // ── ③ 后台服务 ──
            var grpService = new GroupBox { Text = "③ 后台服务(无窗口常驻,APP 关闭不影响)", Location = new Point(12, 370), Size = new Size(736, 80) };
            lblServiceStatus = MakeLabel("服务状态: --", 12, 30, 200);
            grpService.Controls.Add(lblServiceStatus);
            btnServiceStart = new Button { Text = "启动服务", Location = new Point(300, 26), Width = 90 };
            btnServiceStart.Click += (s, e) => ServiceAction(true);
            btnServiceStop = new Button { Text = "停止服务", Location = new Point(400, 26), Width = 90 };
            btnServiceStop.Click += (s, e) => ServiceAction(false);
            grpService.Controls.Add(btnServiceStart);
            grpService.Controls.Add(btnServiceStop);
            chkAutostart = new CheckBox { Text = "开机自启(登录时后台运行)", Location = new Point(500, 30), Width = 220 };
            chkAutostart.CheckedChanged += (s, e) => ToggleAutostart();
            grpService.Controls.Add(chkAutostart);
            Controls.Add(grpService);

            // ── ④ 实时状态 ──
            var grpStatus = new GroupBox { Text = "④ 实时状态", Location = new Point(12, 458), Size = new Size(736, 76) };
            lblForeground = MakeLabel("当前前台: --", 12, 26, 700);
            lblMatched = MakeLabel("命中规则: --", 12, 48, 350);
            lblBrightness = MakeLabel("电视亮度: --", 380, 48, 300);
            grpStatus.Controls.Add(lblForeground);
            grpStatus.Controls.Add(lblMatched);
            grpStatus.Controls.Add(lblBrightness);
            Controls.Add(grpStatus);

            // ── ⑤ 日志 ──
            var grpLog = new GroupBox { Text = "⑤ 日志(最近 10 条)", Location = new Point(12, 542), Size = new Size(736, 146) };
            txtLog = new TextBox
            {
                Location = new Point(12, 22),
                Size = new Size(710, 112),
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                Font = new Font("Consolas", 9F),
            };
            grpLog.Controls.Add(txtLog);
            Controls.Add(grpLog);

            // 底部提示
            var lblBottom = MakeLabel("APP 仅用于配置亮度策略; 亮度切换由后台服务独立执行。", 12, 696, 700);
            Controls.Add(lblBottom);
        }

        Label MakeLabel(string text, int x, int y, int width = 120)
        {
            return new Label { Text = text, Location = new Point(x, y), Width = width, AutoSize = false };
        }

        // ── 配置加载 ──
        AppConfig current;
        bool isFallback( int idx ) { return IsFallbackRule(current.Rules[idx]); }
        bool IsFallbackRule(Rule r)
        {
            return r.Processes.Count == 0 && r.TitleKeywords.Count == 0 && !r.MatchFullscreen;
        }

        void LoadConfigToUi()
        {
            current = ConfigStore.Load();
            txtTvIp.Text = current.TvIp;
            txtLocalAddr.Text = current.LocalAddr;
            RefreshRuleList();
        }

        void RefreshRuleList()
        {
            listRules.Items.Clear();
            if (current == null) return;
            for (int i = 0; i < current.Rules.Count; i++)
            {
                var r = current.Rules[i];
                bool fb = IsFallbackRule(r);
                var item = new ListViewItem((i + 1).ToString());
                item.SubItems.Add(r.Name);
                item.SubItems.Add(r.ConditionSummary());
                item.SubItems.Add(r.Brightness.ToString());
                item.SubItems.Add(fb ? "兜底" : "条件");
                item.Tag = i;
                listRules.Items.Add(item);
            }
        }

        // ── 规则操作 ──
        void AddRule()
        {
            var dlg = new RuleDialog(null, false);
            if (dlg.ShowDialog(this) == DialogResult.OK)
            {
                current.Rules.Add(dlg.Result);
                SaveAndRefresh();
            }
        }

        void EditRule()
        {
            if (listRules.SelectedIndices.Count == 0) return;
            int idx = listRules.SelectedIndices[0];
            var rule = current.Rules[idx];
            bool fb = IsFallbackRule(rule);
            var dlg = new RuleDialog(rule, fb);
            if (dlg.ShowDialog(this) == DialogResult.OK)
            {
                current.Rules[idx] = dlg.Result;
                SaveAndRefresh();
            }
        }

        void DeleteRule()
        {
            if (listRules.SelectedIndices.Count == 0) return;
            int idx = listRules.SelectedIndices[0];
            if (IsFallbackRule(current.Rules[idx]))
            {
                MessageBox.Show("兜底规则不可删除(可编辑亮度值)。", "提示",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (MessageBox.Show("删除规则「" + current.Rules[idx].Name + "」?", "确认",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
            {
                current.Rules.RemoveAt(idx);
                SaveAndRefresh();
            }
        }

        void MoveRule(int delta)
        {
            if (listRules.SelectedIndices.Count == 0) return;
            int idx = listRules.SelectedIndices[0];
            int target = idx + delta;
            if (target < 0 || target >= current.Rules.Count) return;
            var tmp = current.Rules[idx];
            current.Rules[idx] = current.Rules[target];
            current.Rules[target] = tmp;
            SaveAndRefresh();
            listRules.Items[target].Selected = true;
            listRules.EnsureVisible(target);
        }

        void SaveAndRefresh()
        {
            ConfigStore.Save(current);
            RefreshRuleList();
            RefreshStatus();
        }

        // ── 电视连接 ──
        void DoPair()
        {
            SaveTvFields();
            Cursor = Cursors.WaitCursor;
            string outStr = RunCli("pair");
            Cursor = Cursors.Default;
            lblConnStatus.Text = "配对结果: " + (outStr.Length > 60 ? outStr.Substring(0, 60) : outStr);
        }

        void DoTest()
        {
            SaveTvFields();
            Cursor = Cursors.WaitCursor;
            string outStr = RunCli("get");
            Cursor = Cursors.Default;
            lblConnStatus.Text = "测试: " + (outStr.Length > 60 ? outStr.Substring(0, 60) : outStr);
        }

        void SaveTvFields()
        {
            if (current == null) current = new AppConfig();
            current.TvIp = txtTvIp.Text.Trim();
            current.LocalAddr = txtLocalAddr.Text.Trim();
            ConfigStore.Save(current);
        }

        string RunCli(string cmd)
        {
            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo("node",
                    "\"" + System.IO.Path.Combine(ProjectPaths.Root, "src", "cli.js") + "\" " + cmd)
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                };
                psi.EnvironmentVariables["TV_IP"] = txtTvIp.Text.Trim();
                psi.EnvironmentVariables["LOCAL_ADDR"] = txtLocalAddr.Text.Trim();
                using (var p = System.Diagnostics.Process.Start(psi))
                {
                    string o = p.StandardOutput.ReadToEnd();
                    string e = p.StandardError.ReadToEnd();
                    p.WaitForExit(20000);
                    return (o + e).Trim();
                }
            }
            catch (Exception ex)
            {
                return "调用失败: " + ex.Message;
            }
        }

        // ── 服务控制 ──
        void ServiceAction(bool start)
        {
            Cursor = Cursors.WaitCursor;
            string result = start ? ServiceControl.Start() : ServiceControl.Stop();
            Cursor = Cursors.Default;
            RefreshStatus();
            if (result.Length > 0 && result != "0")
            {
                // 成功时输出为空; 有内容通常是错误
                if (result.Contains("错误") || result.Contains("失败") || result.Contains("Cannot") || result.Contains("denied"))
                    MessageBox.Show(result, "服务操作", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        void ToggleAutostart()
        {
            // 避免初始化时触发
            if (!chkAutostart.Checked) return;
            Cursor = Cursors.WaitCursor;
            string result = ServiceControl.EnableAutostart();
            Cursor = Cursors.Default;
            if (result.Contains("已注册") || result.Length == 0)
            {
                // 成功
            }
            else
            {
                MessageBox.Show("注册自启失败: " + result, "开机自启", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        // ── 状态刷新 ──
        void RefreshAll()
        {
            RefreshStatus();
        }

        void RefreshStatus()
        {
            // 异步刷新, 避免 UI 线程被 PowerShell 子进程调用阻塞
            try
            {
                var ui = this;
                System.Threading.Tasks.Task.Run(() =>
                {
                    bool running = ServiceControl.IsRunning();
                    bool autostart = ServiceControl.IsAutostartEnabled();
                    var st = ServiceStatus.Read();
                    string log = ServiceControl.ReadLogTail(10);
                    ui.Invoke(new Action(() =>
                    {
                        try
                        {
                            lblServiceStatus.Text = "服务状态: " + (running ? "● 运行中" : "○ 未运行");
                            lblServiceStatus.ForeColor = running ? Color.Green : Color.Red;
                            chkAutostart.Checked = autostart;

                            if (!string.IsNullOrEmpty(st.Process))
                            {
                                lblForeground.Text = "当前前台: " + st.Process +
                                    (st.Fullscreen ? "(全屏)" : "") +
                                    (string.IsNullOrEmpty(st.Title) ? "" : " — " + Truncate(st.Title, 40));
                                lblMatched.Text = "命中规则: " + (string.IsNullOrEmpty(st.MatchedRule) ? "(无)" : st.MatchedRule);
                                lblBrightness.Text = "目标亮度: " +
                                    (st.TargetBrightness.HasValue ? st.TargetBrightness.Value.ToString() : "--") +
                                    "  已应用: " + (string.IsNullOrEmpty(st.Applied) ? "--" : st.Applied);
                            }
                            else
                            {
                                lblForeground.Text = "当前前台: --(服务未写状态)";
                            }

                            txtLog.Text = log;
                        }
                        catch { }
                    }));
                });
            }
            catch { }
        }

        string Truncate(string s, int max)
        {
            if (string.IsNullOrEmpty(s) || s.Length <= max) return s;
            return s.Substring(0, max) + "...";
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            timer.Stop();
            base.OnFormClosing(e);
        }
    }
}
