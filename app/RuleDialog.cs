using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace WebosBrightness
{
    // 规则编辑对话框
    public class RuleDialog : Form
    {
        TextBox txtName;
        TrackBar trackBrightness;
        NumericUpDown numBrightness;
        CheckBox chkFullscreen;
        TextBox txtProcesses;
        TextBox txtKeywords;
        TextBox txtIgnore;
        Button btnOk;
        Button btnCancel;

        public Rule Result { get; private set; }

        public RuleDialog(Rule rule, bool isFallback)
        {
            Text = isFallback ? "编辑默认规则" : (rule == null ? "添加规则" : "编辑规则");
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(460, 420);
            Font = new Font("Microsoft YaHei UI", 9F);

            int y = 12;

            // 名称
            AddLabel("规则名称:", 12, y + 4);
            txtName = new TextBox { Location = new Point(140, y), Width = 300 };
            Controls.Add(txtName);
            y += 34;

            // 亮度滑块
            AddLabel("亮度(0-100):", 12, y + 8);
            numBrightness = new NumericUpDown
            {
                Location = new Point(140, y),
                Width = 60,
                Minimum = 0,
                Maximum = 100,
            };
            Controls.Add(numBrightness);
            trackBrightness = new TrackBar
            {
                Location = new Point(210, y - 4),
                Width = 230,
                Minimum = 0,
                Maximum = 100,
                TickFrequency = 10,
            };
            Controls.Add(trackBrightness);
            numBrightness.ValueChanged += (s, e) =>
            {
                if ((int)numBrightness.Value != trackBrightness.Value)
                    trackBrightness.Value = (int)numBrightness.Value;
            };            trackBrightness.ValueChanged += (s, e) =>
            {
                if (trackBrightness.Value != (int)numBrightness.Value)
                    numBrightness.Value = trackBrightness.Value;
            };
            y += 40;

            // 匹配条件
            chkFullscreen = new CheckBox
            {
                Text = "前台窗口全屏时命中",
                Location = new Point(140, y),
                Width = 300,
            };
            Controls.Add(chkFullscreen);
            y += 30;

            AddLabel("进程名单(逗号分隔):", 12, y + 4);
            txtProcesses = new TextBox { Location = new Point(140, y), Width = 300 };
            Controls.Add(txtProcesses);
            y += 34;

            AddLabel("标题关键词(逗号分隔):", 12, y + 4);
            txtKeywords = new TextBox { Location = new Point(140, y), Width = 300 };
            Controls.Add(txtKeywords);
            y += 34;

            AddLabel("忽略名单(全屏但不触发):", 12, y + 4);
            txtIgnore = new TextBox { Location = new Point(140, y), Width = 300 };
            Controls.Add(txtIgnore);
            y += 34;

            // 说明
            AddLabel("说明: 满足任一条件即命中。进程名不含 .exe 后缀。", 12, y + 2, 430);
            y += 26;
            AddLabel("条件全空 = 兜底规则(其他所有情况)。", 12, y + 2, 430);
            y += 30;

            // 按钮
            btnCancel = new Button { Text = "取消", Location = new Point(280, y), Width = 80 };
            btnCancel.Click += (s, e) => { DialogResult = DialogResult.Cancel; Close(); };
            btnOk = new Button { Text = "保存", Location = new Point(370, y), Width = 80 };
            btnOk.Click += (s, e) => SaveAndClose();
            Controls.Add(btnCancel);
            Controls.Add(btnOk);

            // 填充数据
            if (rule != null)
            {
                txtName.Text = rule.Name;
                numBrightness.Value = Math.Max(0, Math.Min(100, rule.Brightness));
                trackBrightness.Value = (int)numBrightness.Value;
                chkFullscreen.Checked = rule.MatchFullscreen;
                txtProcesses.Text = string.Join(", ", rule.Processes);
                txtKeywords.Text = string.Join(", ", rule.TitleKeywords);
                txtIgnore.Text = string.Join(", ", rule.IgnoreProcesses);
            }
            else
            {
                txtName.Text = "新规则";
                numBrightness.Value = 50;
                trackBrightness.Value = 50;
            }

            if (isFallback)
            {
                // 兜底规则: 固定全屏不勾选、名单为空
                chkFullscreen.Enabled = false;
                txtProcesses.Enabled = false;
                txtKeywords.Enabled = false;
                txtIgnore.Enabled = false;
            }
        }

        void AddLabel(string text, int x, int y, int width = 120)
        {
            var lbl = new Label { Text = text, Location = new Point(x, y), Width = width, AutoSize = false };
            Controls.Add(lbl);
        }

        void SaveAndClose()
        {
            string name = txtName.Text.Trim();
            if (name == "")
            {
                MessageBox.Show("请填写规则名称。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            var r = Result ?? new Rule();
            r.Name = name;
            r.Brightness = (int)numBrightness.Value;
            r.MatchFullscreen = chkFullscreen.Checked;
            r.Processes = SplitList(txtProcesses.Text);
            r.TitleKeywords = SplitList(txtKeywords.Text);
            r.IgnoreProcesses = SplitList(txtIgnore.Text);
            Result = r;
            DialogResult = DialogResult.OK;
            Close();
        }

        static List<string> SplitList(string text)
        {
            var result = new List<string>();
            if (string.IsNullOrWhiteSpace(text)) return result;
            foreach (var part in text.Split(new[] { ',', '，', ';', '；', '\n', '\r' },
                StringSplitOptions.RemoveEmptyEntries))
            {
                var p = part.Trim();
                if (p.Length > 0) result.Add(p);
            }
            return result;
        }
    }
}
