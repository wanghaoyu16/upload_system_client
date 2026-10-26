# 作业上传系统

一个基于 **Electron + Python Flask** 的作业提交与管理客户端，支持多后端自动切换、学习通聊天集成、AI 辅助答题等功能。

---

## 前置要求

| 环境 | 版本要求 |
|------|----------|
| Node.js | ≥ 18 |
| Python | ≥ 3.9 |
| pip | 最新即可 |

---

## 快速上手

### 第一步：克隆并安装依赖

```bash
git clone https://github.com/wanghaoyu16/upload_system_client.git
cd upload_system_client

npm install                         # 安装 Electron
```

### 第二步：配置服务器

```bash
# 进入后端目录，复制配置模板
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

> **每个字段的含义见下方 [配置说明](#配置说明)**

### 第三步：放入学习通数据（可选）

如果你的场景不需要学习通，跳过此步。

将班级 Excel 放到 `server_python/file/xxt/`，确保文件名和 `config.json` 里写的一致。

Excel 里至少要有这两列：

| 姓名 | 学号 | 学习通账号 | 密码 |
|------|------|-----------|------|
| 张三 | 2024001 | 138xxxx | abc123 |

密码为空时自动使用 `config.json` 中的 `xxt_default_password`。

### 第四步：启动

```bash
# 终端 1：启动后端服务器
cd server_python
pip install flask openpyxl          # 首次需要
python app.py                       # 主服务 → http://127.0.0.1:5000
python admin_app.py                 # 管理后台 → http://127.0.0.1:50

# 终端 2：启动客户端
cd ..                               # 回到项目根目录
npm start                           # 启动 Electron 窗口
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
| `update_version_url` | string | 客户端检查更新的 JSON 地址（返回 `{ "version", "url", "desc" }`） |
| `data_dir` | string | 数据存储根目录。`"./data"` 表示 `server_python/data/`，也可填绝对路径如 `D:\server_data` |

> `config.json` **已被 .gitignore 忽略**，不会提交到仓库。不用担心泄露自己的 IP 和密码。

---

## 目录说明

```
项目根目录/
├── main.js                 # Electron 主进程
├── preload.js              # 预加载脚本（安全桥接）
├── index.html              # 主界面
├── js/
│   ├── app.js              # 前端核心逻辑
│   └── mmd_ai.js           # AI 辅助答题
├── css/                    # 样式
├── server_python/
│   ├── app.py              # Flask 主服务（端口 5000）
│   ├── admin_app.py        # Flask 管理后台（端口 50）
│   ├── config.example.json # 配置模板（可提交）
│   ├── config.json         # 你的配置（不提交）
│   ├── data/               # 运行时数据（不提交）
│   └── file/xxt/           # 学习通 Excel（不提交）
└── package.json
```

---

## 常见问题

**Q：启动报错 `No module named 'flask'`？**

```bash
pip install flask openpyxl werkzeug
```

**Q：客户端连不上服务器？**

- 检查 `config.json` 中 `backends` 地址是否正确
- 确认 Python 服务已启动，端口未被占用
- 防火墙是否放行了对应端口

**Q：学习通显示"未找到您的学习通数据"？**

- 确认 Excel 已放到 `server_python/file/xxt/` 下
- 确认 Excel 中有你的姓名/学号对应的行
- 确认 `config.json` 中 `xxt_excel_filename` 文件名正确

**Q：如何更新客户端？**

修改 `version.json` 中的版本号大于当前版本，客户端会自动提示更新。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面客户端 | Electron |
| 前端 | 原生 HTML / CSS / JS |
| 后端 | Python Flask |
| Excel 处理 | openpyxl |
| 即时通讯 | 环信 (Easemob) |
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