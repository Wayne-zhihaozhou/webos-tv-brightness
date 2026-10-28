# webos-tv-brightness

在 **Windows 电脑**上控制 **LG webOS 电视亮度** 的命令行工具。**不需要 root、不需要在电视上装 app**。

基于 **SSAP 协议 + createAlert 技巧**：电脑通过 WebSocket 连电视（`wss://<ip>:3001`），配对后即可读取/设置/步进调节 `backlight`（OLED Light）。

**内置亮度自动切换**：游戏 / 视频时亮度 50，其他情况亮度 0（OLED 接近黑屏）。常驻后台 + 计划任务开机自启。

- **适用平台**：Windows（需 Node.js）+ LG webOS TV（已实测 LG OLED55G6PCA / webOS 26 中国版）
- **License**：[MIT](./LICENSE)

---

## 快速开始

### 1. 安装依赖

```powershell
cd C:\0_Code\webos-tv-brightness
npm install
```

### 2. 首次配对

```powershell
# 电视屏幕上会弹出「允许此设备控制电视吗?」→ 用遥控器确认
.\scripts\tv-brightness.ps1 pair
```

配对成功后 `client-key` 保存在 `key/client-key.json`（已 gitignore），之后免确认重连。

### 3. 手动控制

```powershell
# 读取当前亮度
.\scripts\tv-brightness.ps1 get

# 直接设置亮度到 60
.\scripts\tv-brightness.ps1 set 60

# 亮度 +1 / -1 步进
.\scripts\tv-brightness.ps1 step +1
.\scripts\tv-brightness.ps1 step -1

# 诊断:列出 picture 类别下所有可用设置键
.\scripts\tv-brightness.ps1 info
```

也可以直接用 Node：

```powershell
node src/cli.js get
node src/cli.js set 60
node src/cli.js step +1
```

### 4. 亮度自动切换(游戏/视频 50, 其他 0)

```powershell
# 手动启动常驻切换(前台窗口变化时自动调亮度)
.\scripts\tv-brightness-switcher.ps1

# 只检测一次并应用后退出
.\scripts\tv-brightness-switcher.ps1 -Once

# 试运行(只记录日志, 不改亮度)
.\scripts\tv-brightness-switcher.ps1 -DryRun

# 前台输出(默认写日志)
.\scripts\tv-brightness-switcher.ps1 -Console
```

**开机自启**(任务计划程序, 用户登录时启动, **后台无窗口**):

```powershell
# 注册计划任务(开机自启)
.\scripts\install-autostart.ps1

# 立即启动
Start-ScheduledTask -TaskName 'WebOSTVBrightnessSwitcher'

# 卸载
.\scripts\uninstall-autostart.ps1
```

> **无窗口实现**：任务动作用 `wscript.exe` + `tv-brightness-switcher.vbs` 启动器（`WshShell.Run` 隐藏窗口模式），
> 避免任务计划程序直接启动 powershell.exe 时闪现控制台窗口。常驻进程无主窗口（MainWindowHandle=0）。

日志在 `logs/switcher.log`。

---

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `TV_IP` | `192.168.1.4` | 电视 IP |
| `LOCAL_ADDR` | `192.168.1.5` | 绑定本机物理网卡 IP（**绕过 VPN 劫持，必填**） |

示例：

```powershell
$env:TV_IP = '192.168.1.4'
$env:LOCAL_ADDR = '192.168.1.5'
.\scripts\tv-brightness.ps1 get
```

> **为什么必须绑定 LOCAL_ADDR**：如果电脑开着 SecoClient 等 VPN，到电视网段的路由会被劫持，直接连电视端口全不通。绑定物理网卡 IP 后流量强制走该网卡。详见 `docs/电视亮度调整-调查记录.md` §9。

---

## 工作原理

```
电脑(SSAP 客户端)  --wss:3001-->  电视(webOS TV)
    │                                  │
    ├─ hello                           │
    ├─ ssap://system/getSystemInfo     │  (新固件要求注册前获取)
    ├─ register(无签名 manifest)        ├─ 弹窗「允许此设备控制电视吗?」
    │  ← client-key                     │  用户确认
    │                                  │
    ├─ ssap://settings/getSystemSettings  ← 读亮度(可直接读)
    └─ createAlert(挂 luna 写回调) → closeAlert
         └─ 系统以特权身份执行 luna://com.webos.settingsservice/setSystemSettings
             (绕开 ACG 权限,不需要 root)
```

### 关键点

- **写亮度用 createAlert 技巧**：直接调 `setSystemSettings` 会被 ACG 拒绝；通过创建弹窗并把 luna 调用挂到弹窗的按钮/关闭回调，关闭弹窗时由**系统以特权身份**执行写入。
- **无签名配对**：`com.lge.test` 共享签名已被 LG 加入黑名单（实测 `403 Pairing rejected: blacklisted certificate detected`），改用无签名 manifest（Home Assistant aiowebostv 同款）。
- **亮度键名**：这台 G6 上 OLED 亮度键是 `backlight`（字符串值），`oledLight` 不存在；`brightness`/`energySaving`/`pictureMode` 也可读。
- **写后读回验证**：createAlert 的 luna 调用无返回值，必须 `getSystemSettings` 读回确认。

---

## 自动切换分类方案

`tv-brightness-switcher.ps1` 每 1 秒检测一次前台窗口，按优先级分类：

| 优先级 | 判定条件 | 分类 |
|---|---|---|
| 1 | 前台进程 ∈ `mediaProcesses`（vlc/mpv/potplayer/kodi…） | 媒体(50) |
| 2 | 前台进程 ∈ `gameProcesses`（自定义游戏名单） | 媒体(50) |
| 3 | 前台窗口**全屏** 且 进程 ∉ `ignoreFullscreenProcesses` | 媒体(50) |
| 4 | 窗口标题含 `videoTitlePatterns`（bilibili/youtube/爱奇艺…） | 媒体(50) |
| 5 | 其他 | 空闲(0) |

**关键设计**：
- **全屏检测兜底**：大多数游戏全屏运行，不用逐个加游戏名单（实测 GTA5 全屏自动识别为媒体 ✅）。
- **忽略名单**：浏览器/终端/办公软件全屏不触发（浏览器按 F11 全屏 ≠ 看视频）。
- **状态变化才调亮度**：模式没变不调（避免每 1 秒调一次导致闪烁）。
- **单实例互斥**：已运行时再启动会被拒绝，避免重复轮询。
- 分类逻辑有单元测试：`.\tools\test-classifier.ps1`（12 个用例全过）。

配置在 `config.json`：

```json
{
  "mediaBrightness": 50,
  "idleBrightness": 0,
  "pollIntervalMs": 1000,
  "gameProcesses": [],
  "mediaProcesses": ["vlc", "mpv", "potplayer", "kodi", "..."],
  "videoTitlePatterns": ["bilibili", "youtube", "爱奇艺", "..."],
  "ignoreFullscreenProcesses": ["explorer", "chrome", "msedge", "code", "..."]
}
```

> 玩游戏就加 `gameProcesses`（如 `["gta5_enhanced", "eldenring"]`）；但通常不需要——全屏检测已覆盖。

---

## 目录结构

```
webos-tv-brightness/
├─ src/
│  ├─ ssap-client.js     SSAP 客户端核心(连接/配对/请求,含 client-key 持久化)
│  ├─ brightness.js      亮度控制(读/写/步进)
│  ├─ cli.js             命令行入口
│  └─ Foreground.ps1     前台窗口检测(P/Invoke: 进程/标题/全屏/主显示器)
├─ scripts/
│  ├─ tv-brightness.ps1            PowerShell 封装(手动控制)
│  ├─ tv-brightness-switcher.ps1   自动切换常驻脚本
│  ├─ install-autostart.ps1        注册计划任务(开机自启)
│  └─ uninstall-autostart.ps1      卸载计划任务
├─ tools/
│  ├─ test-classifier.ps1          分类逻辑单元测试
│  └─ 实测脚本与参考源码(bscpylgtv / aiowebostv)
├─ docs/
│  └─ 电视亮度调整-调查记录.md  完整调查与实测记录
├─ config.json            自动切换配置
├─ key/                   配对凭证(client-key,已 gitignore)
├─ package.json
└─ .gitignore
```

---

## 实测记录摘要

| 操作 | 结果 |
|---|---|
| 直接设置 60 → 45 | ✅ 读回 45 |
| 恢复 60 | ✅ 读回 60 |
| 步进 +1（60 → 61） | ✅ 读回 61 |
| 步进 -1（61 → 60） | ✅ 读回 60 |

完整记录见 `docs/电视亮度调整-调查记录.md`。

---

## 常见问题

- **连不上电视（端口全 CLOSED）**：检查 `LOCAL_ADDR` 是否为本机物理网卡 IP，`TV_IP` 是否正确。
- **`403 Pairing rejected`**：说明用了被黑名单的签名——本项目用无签名注册，不应出现；确认 `src/ssap-client.js` 未被改动。
- **首次配对无弹窗**：确认电视「网络控制 / LG Connect Apps」已开启。
- **`Some keys are not allowed`**：键名不支持，先跑 `info` 看可用键。

---

## 相关项目

- [wakeonlan-webos](https://github.com/…)：电视端 webOS 应用（本项目调查文档的原出处，见 `docs/`）
- [bscpylgtv](https://github.com/chros73/bscpylgtv)：Python 版 webOS 控制库（createAlert 技巧来源）
- [aiowebostv](https://github.com/home-assistant-libs/aiowebostv)：Home Assistant 库（无签名注册握手参考）
- [LGforMac / LGforWin](https://github.com/itsAllexB/LGforMac)：macOS/Windows 亮度控制应用
