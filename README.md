# Xi Zip 📁

<div align="center">
本地压缩包管理器 · 7-Zip 内核 · 纯本地处理

[![version](https://img.shields.io/badge/version-1.1.0-e8a33a?style=flat-square)]() [![7-zip](https://img.shields.io/badge/7--zip-26.06-orange?style=flat-square)]() [![platform](https://img.shields.io/badge/platform-Windows-blue?style=flat-square)]() [![python](https://img.shields.io/badge/python-3.14%2B-blue?style=flat-square)]() [![dotnet](https://img.shields.io/badge/.NET-10-512BD4?style=flat-square)]() [![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)]()

XiZip 是一个以 **7-Zip** 为内核的本地压缩包管理器，采用「原生桌面窗口 + Web 前端」的双层架构：暖色调毛玻璃界面，提供 **MINI / MAX 双视图**、拖拽打开、内嵌预览、解压进度动画、可取消的新建压缩包等功能。所有处理均在本地完成，不上传任何文件。

本仓库包含两个等价实现，共用同一套 Web 前端，界面与交互完全一致：

| 版本 | 目录 | 技术栈 | 推荐场景 |
| :---: | :--- | :--- | :--- |
| **Python 版** | [`python版`](./python版) | Python 3.14 · Flask · pywebview | 已有 Python 环境、快速调试 |
| **Visual Studio 版** | [`Visual Studio版`](./Visual Studio版) | .NET 10 · WPF · WebView2 · ASP.NET Core | 发布独立 exe、长期使用 |

---

## 📇目录

- [功能特性](#功能特性)
- [配置要求](#配置要求)
- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [本地服务接口](#本地服务接口两版一致)
- [使用说明与注意事项](#使用说明与注意事项)
- [开发指南](#开发指南)
- [版本与兼容性](#版本与兼容性)
- [开源协议](#开源协议)

---

## 功能特性

| 功能 | 说明 |
| :--- | :--- |
| 📦 **拖拽打开** | 把压缩包拖入主窗口即可打开 |
| 🪟 **双视图** | MINI（快速浏览/解压）与 MAX（文件树 + 列表 + 预览面板）随时切换 |
| 👁️ **内嵌预览** | 文本、图片、PDF、音视频直接在预览板块查看，无需解压 |
| 📤 **智能解压** | 支持「解压全部」与「仅解压选中文件」；自动创建与压缩包同名的子文件夹 |
| 📊 **进度动画** | 实时百分比 + 当前文件名；落盘字节数补齐 7-Zip 块缓冲延迟 |
| 🆕 **可取消新建** | 先选文件与保存位置，再调用 7z 打包；过程有进度弹窗，随时取消并清理半成品 |
| ➕ **追加 / 删除** | MAX 视图拖拽追加文件、删除选中条目 |
| 🎁 **演示包** | 首页一键生成演示压缩包，快速体验全部功能 |
| ⚙️ **个性化设置** | 主题、玻璃强度、动效、密度等可自定义并持久化到 `localStorage` |

---

## 配置要求

### 硬件要求

| 项目 | 最低配置 | 推荐配置 |
| :--- | :--- | :--- |
| 操作系统 | Windows 10 64 位 | Windows 11 64 位 |
| 处理器 | x64 双核 1.0 GHz | x64 四核 2.0 GHz 以上 |
| 内存 | 4 GB | 8 GB 以上 |
| 硬盘空间 | 200 MB（含 7-Zip 内核与前端资源） | 500 MB 以上 |
| 显示器 | 1280 × 720 | 1920 × 1080 及以上 |
| GPU | 无硬性要求 | 支持硬件加速的 GPU（用于 WebView2 合成） |

### 软件要求

#### Python 版

| 组件 | 版本要求 | 说明 |
| :--- | :--- | :--- |
| Python | ≥ 3.14 | 需将 `python` 加入 PATH |
| Flask | 最新稳定版 | `pip install flask` |
| pywebview | ≥ 6.0 | `pip install pywebview`（提供桌面窗口与 WebView2 绑定） |
| WebView2 运行时 | 已随 Windows 11 内置 | Windows 10 需[手动安装](https://developer.microsoft.com/microsoft-edge/webview2/) |
| 7-Zip 内核 | 已内置 | 位于 `python版/7z/`，无需单独安装 |

#### Visual Studio 版（.NET）

| 组件 | 版本要求 | 说明 |
| :--- | :--- | :--- |
| .NET SDK | ≥ 10.0 | [下载地址](https://dotnet.microsoft.com/download/dotnet/10.0) |
| Windows | 10 / 11 64 位 | WPF 与 WebView2 仅限 Windows |
| WebView2 运行时 | 已随 Windows 11 内置 | Windows 10 需[手动安装](https://developer.microsoft.com/microsoft-edge/webview2/) |
| 7-Zip 内核 | 已内置 | 位于 `Visual Studio版/XiZip/XiZip/7z/` |
| NuGet 包 | `Microsoft.Web.WebView2` | 首次构建自动恢复 |

### 运行时说明

- 两个版本的本地服务均仅监听 `127.0.0.1`，不对外开放。
- Python 版使用随机端口（8765–8790）；.NET 版固定从 8790 起探测可用端口，保证 `localStorage` 跨启动持久化。
- WebView2 用户数据目录：`%LOCALAPPDATA%\XiZip`。
- 临时解压目录：`%TEMP%\xizip_*`，正常退出自动清理。

---

## 快速开始

### Python 版

```powershell
# 1. 安装依赖
pip install flask pywebview

# 2. 启动（弹出独立桌面窗口，不经过浏览器）
python "e:\python项目\XiZip\python版\main.py"
```

### Visual Studio 版（.NET）

**方式 A：Visual Studio**

1. 双击打开 [`Visual Studio版/XiZip/XiZip.slnx`](./Visual Studio版/XiZip/XiZip.slnx)
2. 按 `F5` 运行（首次会从 NuGet 恢复 `Microsoft.Web.WebView2` 包，需联网）

**方式 B：命令行**

```powershell
dotnet run --project "e:\python项目\XiZip\Visual Studio版\XiZip\XiZip\XiZip.csproj"
```

**方式 C：发布成独立 exe**

```powershell
dotnet publish "e:\python项目\XiZip\Visual Studio版\XiZip\XiZip\XiZip.csproj" `
  -c Release -r win-x64 --self-contained false
```

> ⚠️ 发布产物中须保持 `web/` 与 `7z/` 文件夹与 `XiZip.exe` **同级**，否则无法加载界面与内核。

---

## 目录结构

```
XiZip/
├─ python版/
│  ├─ main.py                 # Flask 后端 + 7-Zip 调用 + pywebview 启动
│  ├─ 7z/                     # 内置 7-Zip 内核（7z.exe / 7z.dll 等）
│  └─ web/                    # 前端：index.html / style.css / app.js
│
└─ Visual Studio版/
   └─ XiZip/
      ├─ XiZip.slnx           # Visual Studio 解决方案
      ├─ XiZip.csproj         # .NET 10 WPF 项目
      ├─ app.manifest         # PerMonitorV2 DPI / 长路径支持
      ├─ App.xaml(.cs)        # 应用入口：启动本地服务 + 创建窗口
      ├─ MainWindow.xaml(.cs) # WPF 窗口 + WebView2 渲染 + 系统对话框
      ├─ Services/
      │  ├─ SevenZip.cs       # 7-Zip 列表/预览/解压/新增/删除封装
      │  ├─ ArchiveStore.cs   # 会话、任务、临时目录、进度辅助
      │  └─ ApiServer.cs      # 本地 HTTP 接口（ASP.NET Core Minimal API）
      ├─ 7z/                  # 内置 7-Zip 内核（7z.exe / 7z.dll）
      └─ web/                 # 前端（与 Python 版同源）
```

> `bin/`、`obj/`、`__pycache__/`、`.vs/` 为构建缓存，可安全忽略。

---

## 本地服务接口（两版一致）

应用启动后在本机起一个 HTTP 服务，前端通过以下接口调用 7-Zip：

| 方法 | 路径 | 说明 |
| :---: | :--- | :--- |
| POST | `/api/open` | 上传压缩包并解析（multipart 字段 `file`） |
| POST | `/api/demo` | 生成演示压缩包 |
| GET  | `/api/archives/{sid}/info` | 获取目录、大小、压缩率等 |
| GET  | `/api/archives/{sid}/preview?path=...` | 流式预览单个文件（>40 MB 返回 413） |
| POST | `/api/archives/{sid}/extract` | 解压；`paths` 为空即解压全部 |
| POST | `/api/archives/{sid}/add` | 追加文件（multipart 字段 `files`、`folder`） |
| POST | `/api/archives/{sid}/delete` | 删除条目（JSON `{"paths":[...]}`） |
| POST | `/api/create` | 新建压缩包（JSON `{files, folder, name}`） |
| GET  | `/api/jobs/{id}` | 查询任务状态 / 进度 |
| POST | `/api/jobs/{id}/cancel` | 取消进行中的新建任务 |
| POST | `/api/pick/files` | 弹出系统「选择文件」对话框 |
| POST | `/api/pick/folder` | 弹出系统「选择文件夹」对话框 |
| POST | `/api/window/size` | 切换 MINI/MAX 窗口尺寸 |
| GET  | `/api/gpu` | 主显示适配器信息 |
| GET  | `/api/about` | 版本、内核、WebView2、运行时信息 |

### 任务模型

`/api/extract` 与 `/api/create` 立即返回 `jobId`；前端轮询 `/api/jobs/{id}`，返回字段：

```
state / percent / current / files / total / bytes / target / name / sid
```

解压进度采用「7-Zip 输出百分比」与「目标目录落盘字节数」取大值，避免大文件解压时进度卡在 0。新建任务可通过 `/api/jobs/{id}/cancel` 终止 7-Zip 进程并删除半成品。

---

## 使用说明与注意事项

1. **解压目录规则**：解压时会在目标位置下创建与压缩包同名的文件夹（如 `demo.zip` → `demo/`），再将内容解压进去。复合后缀 `.tar.gz`、`.tar.bz2`、`.tar.xz`、`.tgz`、`.tbz2`、`.txz` 只去掉一次外层。
2. **新建压缩包扩展名**：若名称未带扩展名，默认补 `.zip`；支持 `.zip / .7z / .tar / .gz / .bz2 / .xz` 及其组合。同名文件已存在时返回冲突。
3. **新建可取消**：点击取消会终止 7-Zip 进程并删除半成品压缩包。
4. **预览上限**：单文件超过 40 MB 不支持在线预览，请先解压。
5. **单文件大小上限**：上传/解压单文件最大 600 MB（由后端 `MAX_CONTENT_LENGTH` / Kestrel 限制）。
6. **临时目录**：打开的压缩包会被复制到系统临时目录（`xizip_*`）。正常退出自动清理；异常退出可能遗留，可手动删除 `%TEMP%` 下 `xizip_` 前缀的目录。
7. **WebView2**：.NET 版需要 WebView2 运行时；若未安装会在窗口初始化时失败。用户数据目录为 `%LOCALAPPDATA%\XiZip`。
8. **GPU 信息**：通过 Windows `EnumDisplayDevices` 读取主显示适配器，仅用于界面展示，不影响功能。
9. **目录结构约束**：`7z/` 与 `web/` 必须与可执行文件（或 `main.py`）同级，内核与前端均以相对路径加载，移动时请保持目录结构。
10. **两版数据不互通**：Python 版与 .NET 版各自维护临时目录与本地存储，互不影响。

---

## 开发指南

- 修改前端只需改 `web/` 下的文件，两个版本共享；保存后刷新窗口即可。
- .NET 版首次构建会下载 `Microsoft.Web.WebView2` NuGet 包，需联网。
- 内核路径：
  - Python 版：`python版/7z/7z.exe`
  - .NET 版：`Visual Studio版/XiZip/XiZip/7z/7z.exe`
- 替换 7-Zip 内核：只需覆盖对应目录中的 `7z.exe` 与 `7z.dll`。
- 端口策略：Python 版随机 8765–8790；.NET 版从 8790 起探测。若需固定端口，修改对应源文件中的端口常量。

---

## 版本与兼容性

| 项目 | 当前版本 |
| :--- | :--- |
| XiZip | 1.1.0 |
| 7-Zip 内核 | 26.06 |
| Python 版运行时 | Python ≥ 3.14 |
| .NET 版运行时 | .NET 10 |
| 前端资源 | 两版同源 |

- 两个版本的接口契约完全一致，前端可在两者间无缝切换。
- 仅支持 Windows；WPF、WebView2 与 7-Zip（Windows 版）均不跨平台。
- 解压格式支持由 7-Zip 内核决定，包括 ZIP、7Z、RAR、TAR、GZ、BZ2、XZ、CAB、ISO、APK、JAR 等。

---

## 开源协议

本项目采用多协议组合：

### 项目代码（MIT License）

除 7-Zip 内核外，本仓库的所有源代码（Python、C#、Web 前端等）均采用 **MIT License** 开源。

```
MIT License

Copyright (c) 2026 Xiaochen911-code

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 7-Zip 内核（GNU LGPL + 其他）

本项目内置的 7-Zip 内核（`7z.exe`、`7z.dll` 等）遵循 7-Zip 官方授权，主要为 **GNU Lesser General Public License (LGPL)**，部分代码附带以下协议：

- **GNU LGPL** — 7-Zip 主体代码
- **GNU LGPL + unRAR 许可限制** — RAR 解压相关代码（RAR 解压遵循 unRAR 许可，不得用于创建 RAR 压缩）
- **BSD 3-Clause License** — `7z.dll` 中部分代码
- **BSD 2-Clause License** — 部分代码

> 7-Zip 官方完整许可文本见各版本 `7z/License.txt`。以二进制形式再分发时，须保留相关许可信息。

### 第三方依赖

- **Flask** — BSD License
- **pywebview** — BSD License
- **Microsoft.Web.WebView2** — 微软软件许可条款

---

<div align="center">

Made with ❤️ — XiZip
