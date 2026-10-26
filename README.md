# 作业上传系统

一个基于 **Electron + Python Flask** 的作业提交与管理客户端，支持多后端自动切换、学习通聊天集成、AI 辅助答题、MMD 模型预览、内置浏览器与 Python 编辑器等功能。

> **提示**：本 README 已按仓库实际代码校正（端口、Excel 列位置、配置文件字段等），请以本文档为准。

---

## 功能特性

- **多后端自动切换**：按 `backends` 列表自动探测可用服务器，优先局域网，失败后回退公网
- **作业 / 素材树管理**：上传、下载、重命名、移动、权限设置、压缩包下载、帮我交作业
- **学习通集成**：独立登录窗口、免登浏览、环信聊天、好友、窗口抖动、语音通话（实验性）
- **AI 辅助答题**：基于 OpenAI 兼容接口的对话，支持页面元素工具调用（MMD 模型 / 浏览器 / 学习通）
- **MMD 模型预览**：支持 PMX / PMD / GLB / GLTF / OBJ / VRM，可配置描边、光晕、贴图与动画
- **内置浏览器**：多标签、历史记录、透明背景、自定义 UA
- **Python 编辑器 / REPL**：内置运行、交互式命令行、多标签编辑
- **个性化**：主题色、深色模式、自定义背景 / 启动动画 / 字体、毛玻璃、透明度、穿透点击
- **实验性功能**：开发者控制面板、窗口舞蹈 / 弹跳彩蛋、语音通话窗口

---

## 前置要求

| 环境 | 版本要求 |
|------|----------|
| Node.js | ≥ 18 |
| Python | ≥ 3.9 |
| pip | 最新即可 |

> 主服务默认监听 **80** 端口，Windows 下可能需要以管理员身份运行，或先释放 80 端口占用。

---

## 快速上手

### 第一步：克隆并安装依赖

```bash
git clone https://github.com/wanghaoyu16/upload_system_client.git
cd upload_system_client

npm install      # 安装 Electron 及前端依赖（easemob-websdk、agora-rtc-sdk-ng、three 等）
```

### 第二步：配置服务器

```bash
cd server_python
copy config.example.json config.json   # Windows
# cp config.example.json config.json   # macOS / Linux
```

打开 `config.json`，把占位符替换成你自己的信息：

```json
{
  "backends": [
    "http://192.168.1.100",
    "http://10.0.0.50",
    "http://你的公网IP:端口",
    "http://127.0.0.1"
  ],
  "xxt_excel_filename": "班级名单.xlsx",
  "xxt_default_password": "你的默认密码",
  "update_version_url": "http://你的服务器/version.json",
  "data_dir": "./data"
}
```

> 字段含义见下方 [配置说明](#配置说明)。

### 第三步：放入学习通数据（可选）

如果你的场景不需要学习通，跳过此步。

将班级 Excel 放到 `server_python/file/xxt/`，文件名与 `config.json` 中的 `xxt_excel_filename` 保持一致。

> **注意**：`app.py` 读取 Excel 的列位置是**硬编码**的，从第 2 行开始，最多读到第 44 行：

| 列 | 内容 |
|----|------|
| 第 5 列（E） | 学习通账号 |
| 第 6 列（F） | 姓名 |
| 第 7 列（G） | 密码（留空则使用 `xxt_default_password`） |

示例（前 4 列可以是学号、班级等任意内容）：

| 学号 | 班级 | 备注 | 序号 | 学习通账号 | 姓名 | 密码 |
|------|------|------|------|-----------|------|------|
| 2024001 | 计科1班 | - | 1 | 138xxxx | 张三 | abc123 |

### 第四步：启动

```bash
# 终端 1：启动后端服务器
cd server_python
pip install flask openpyxl         # 首次需要
python app.py                      # 主服务 → http://127.0.0.1:80
python admin_app.py                # 管理后台 → http://127.0.0.1:50

# 终端 2：启动客户端
cd ..                              # 回到项目根目录
npm start                          # 启动 Electron 窗口
```

客户端启动后会自动探测 `backends` 列表中第一个可用的服务器并连接。

---

## 配置说明

`server_python/config.json` 各字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `backends` | string[] | 后端地址列表，客户端按顺序探测，连上第一个可用的 |
| `xxt_excel_filename` | string | 学习通班级 Excel 文件名，放在 `server_python/file/xxt/` 下 |
| `xxt_default_password` | string | Excel 中某行未填密码时使用的默认密码 |
| `update_version_url` | string | `/api/check_update` 回退使用的版本 JSON 地址 |
| `data_dir` | string | 数据存储根目录。`"./data"` 相对启动目录；也可填绝对路径如 `D:\server_data` |

**版本 JSON 字段（用于客户端更新检测）**：

```json
{
  "version": "1.4.0",
  "download_url": "http://你的服务器/file/app/upload-system-setup.exe",
  "release_notes": "本次更新内容..."
}
```

- 稳定版：`{服务器}/file/app/version.json`
- 测试版：`{服务器}/file/app_beta/version.json`

> `config.json` **已被 .gitignore 忽略**，不会提交到仓库。不用担心泄露自己的 IP 和密码。

---

## 目录说明

```
项目根目录/
├── main.js                  # Electron 主进程（窗口、托盘、更新、学习通 SSO、通话窗口等）
├── preload.js               # 预加载脚本（安全桥接，含 MMD 模型/图片本地存储）
├── call-preload.js          # 来电窗口预加载（Agora RTC）
├── webview-preload.js       # webview 预加载（拦截 window.open / 下载 / 考试链接）
├── xxt-preload.js           # 学习通登录窗口预加载（截获环信凭据）
├── index.html               # 主界面
├── call-window.html         # 来电窗口
├── dev-panel.html           # 开发者控制面板
├── js/
│   ├── app.js               # 前端核心逻辑（登录、树、上传下载、学习通、浏览器、Python...）
│   ├── mmd.js               # MMD 模型加载/预览/配置
│   ├── mmd_ai.js            # MMD 模型 AI 对话
│   └── three/               # three.js 及其 addons
├── css/                     # 样式
├── static/                  # 图标、字体、Cropper 等静态资源
├── server_python/
│   ├── app.py               # Flask 主服务（端口 80）
│   ├── admin_app.py         # Flask 管理后台（端口 50）
│   ├── config.example.json  # 配置模板（可提交）
│   ├── config.json          # 你的配置（不提交）
│   ├── data/                # 运行时数据（不提交）
│   │   ├── file/work/       # 作业目录
│   │   ├── file/resource/   # 素材目录
│   │   ├── file/xxt/        # 学习通 Excel
│   │   ├── file/app/        # 正式版更新包
│   │   ├── file/app_beta/   # 测试版更新包
│   │   └── userdata/        # 用户 / token / 头像 / 通知
│   └── templates/           # 管理后台页面
└── package.json
```

---

## 需要手动修改的位置

除 `config.json` 外，以下文件中也有占位符需要替换成你自己的地址：

### js/app.js（DEFAULT_PROBE_URLS，第 6–14 行）

| 行号 | 内容 | 说明 |
|------|------|------|
| 6 | `'http://<请在此处输入内网IP地址1>'` | 内网后端地址 1 |
| 7 | `'http://<请在此处输入IP地址2>'` | 后端地址 2 |
| 8 | `'http://<请在此处输入IP地址3>'` | 后端地址 3 |
| 9 | `'http://<请在此处输入IP地址4>'` | 后端地址 4 |
| 10 | `'http://<请在此处输入IP地址5>'` | 后端地址 5 |
| 11 | `'http://<请在此处输入IP地址1>'` | 公网后端地址 1 |
| 12 | `'http://<请在此处输入IP地址2>'` | 公网后端地址 2 |
| 13 | `'http://<请在此处输入IP地址3>'` | 公网后端地址 3 |
| 14 | `'http://127.0.0.1'` | 本机（默认 80 端口） |

### main.js（`checkForLocalUpdate` 中的更新服务器）

| 行号 | 内容 | 说明 |
|------|------|------|
| 1187 | `process.env.UPDATE_HOST \|\| '请在此处输入更新服务器IP'` | 版本更新服务器 IP |

> 也可通过环境变量 `UPDATE_HOST` 设置 `main.js` 中的地址，无需改代码。

---

## 常见问题

**Q：启动报错 `No module named 'flask'`？**

```bash
pip install flask openpyxl werkzeug
```

**Q：`python app.py` 启动失败 / 80 端口被占用？**

- Windows 下 80 端口常被 IIS、其他 Web 服务占用，可用 `netstat -ano | findstr :80` 查看占用进程
- 以管理员身份运行命令行
- 如实在无法释放，可修改 `app.py` 末尾 `port=80` 为其他端口，并同步修改 `config.json` 与 `js/app.js` 中的地址

**Q：客户端连不上服务器？**

- 检查 `config.json` 中 `backends` 地址是否正确
- 确认 Python 服务已启动（80 端口主服务、50 端口管理后台）
- 防火墙是否放行了对应端口
- 确认 `js/app.js` 中的 `DEFAULT_PROBE_URLS` 也已改成实际地址

**Q：学习通显示"未找到您的学习通数据"？**

- 确认 Excel 已放到 `server_python/file/xxt/` 下
- 确认 Excel 第 5/6/7 列分别是账号、姓名、密码（从第 2 行开始）
- 确认 `config.json` 中 `xxt_excel_filename` 文件名正确
- 也可在「设置 → 学习通 → 更改本地学习通账户」中手动填写覆盖

**Q：如何更新客户端？**

- 稳定版：把 `version.json` 放到 `{data_dir}/file/app/`，`version` 大于当前版本即可
- 测试版：放到 `{data_dir}/file/app_beta/`，并在「设置 → 常规」中开启「接收测试版本更新」
- 客户端仅在对局域网后端连接时自动静默检查，公网后端需手动点「检查更新」

**Q：语音通话为什么用不了？**

- 通话为实验性功能，依赖 Agora RTC 与学习通 SSO 返回的 `imAccount`
- 若学习通默认密码被修改，会弹出重新连接窗口，需输入最新密码
- 目前 Agora 连接在某些网络环境下不可用，只能挂断或关闭

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面客户端 | Electron |
| 前端 | 原生 HTML / CSS / JS |
| 后端 | Python Flask + openpyxl |
| 3D 渲染 | three.js（MMDLoader / GLTFLoader / OBJLoader / EffectComposer） |
| 即时通讯 | 环信 (Easemob) |
| 音视频通话 | Agora RTC SDK (实验性) |
| 第三方集成 | 超星学习通 |

---

## 参与贡献

欢迎提交 Issue 和 Pull Request。

注意：
- **不要**在 PR 中包含 `config.json` 或任何含真实 IP / 密码的文件
- 新增配置项请同步更新 `config.example.json`
- Python 代码用 `app.py` 中的 `_server_cfg.get('key', default)` 读取配置

---

## License

MIT © anghaoyu16