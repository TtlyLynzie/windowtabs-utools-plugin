# WindowTabs uTools 插件 MVP

这是“uTools 设置界面 + WindowTabs 原生核心”方案的集成工程。当前内置上游核心版本为 `ss_2026.11.06`；完整的 uTools 控制能力需要使用 `WindowTabs-source/WtProgram/WindowTabsIpc.fs` 重新编译核心。

## 目录

```text
windowtabs-utools-plugin/
├─ plugin.json       # uTools 插件配置
├─ index.html        # 主界面
├─ renderer.js       # 前端交互
├─ styles.css        # 页面样式
├─ preload.js        # helper 生命周期和 Named Pipe IPC
├─ logo.png          # Big Sur 风格插件图标（256×256 PNG）
└─ helper/
   └─ WindowTabs.exe # 需要放入编译后的原生核心
```

## 接入原生核心

当前工作区已经放入一份 WindowTabs `ss_2026.11.06` 编译产物，并整理为：

```text
windowtabs-utools-plugin/helper/
├─ current.json
└─ ss_2026.11.02/
   ├─ WindowTabs.exe
   ├─ WindowTabs.exe.config
   └─ Settings/
```

`current.json` 让插件按版本目录定位 helper，并记录上游 release 地址和真实 SHA-256。插件会在首次启动时校验并复制到 uTools 本地数据目录。

如果重新放置其他版本的 WindowTabs，请保持“版本目录 + `current.json`”结构。当前 `ss_2026.11.06` 官方 zip 本身还没有 uTools IPC，插件会显示兼容模式；加入 IPC Server 的自编译版本应使用相同版本目录结构替换它。

当前这份已编译的 WindowTabs 还没有我们设计的 Named Pipe Server。插件可以定位并启动它，并在 IPC 不可用时进入兼容模式；但要让 uTools 查询状态、重启核心和打开设置，原生核心需要：

1. 接收命令行参数 `--windowtabs-ipc-pipe=...`；
2. 在该命名管道上启动 JSON Lines 服务；
3. 实现 `status`、`stop`、`restart`、`openSettings`、`getConfig`、`updateConfig` 方法；
4. 按照方案中的 `hello`、请求、响应和 `event` 协议通信。

## 本地安装

在 uTools 开发者工具中，将本目录作为开发工程安装。正式打包时，打包目录必须包含 `plugin.json`、`index.html`、`preload.js`、前端资源和 `helper` 目录。

## 环境变量

开发联调时可以使用：

```text
WINDOWTABS_HELPER_PATH=C:\\path\\to\\WindowTabs.exe
WINDOWTABS_PIPE_NAME=\\\\.\\pipe\\windowtabs-dev
```

开发阶段可以把 `WINDOWTABS_HELPER_PATH` 指向 `dev/mock-helper.js`。插件会自动使用当前 Node.js 解释器启动 `.js` helper：

```text
WINDOWTABS_HELPER_PATH=<插件目录>\\dev\\mock-helper.js
WINDOWTABS_PIPE_NAME=\\\\.\\pipe\\windowtabs-dev
```

Mock helper 支持 `status`、`stop`、`restart`、`openSettings`、`getConfig` 和 `updateConfig`，用于验证 uTools 页面、状态机和 IPC 客户端。

这样可以在不修改插件代码的情况下指定 helper 和命名管道名称。

## 打包为 uTools 插件

在 macOS/Linux 或带有 `zip` 命令的 Windows 环境执行：

```sh
./package-plugin.sh
```

脚本会生成 `dist/windowtabs-utools-plugin.upx`。这个包已经包含 `WindowTabs.exe`、配置文件和语言资源，用户只需要在 uTools 中安装插件，不需要再单独安装 WindowTabs。第一次启动时，插件会把版本化 helper 复制到 `utools.getPluginLocalDataPath()/helper`，然后从该目录运行。

### 无 Windows 电脑时的构建

`.github/workflows/build-plugin.yml` 使用 GitHub Actions 的 `windows-latest` runner 自动完成以下工作：下载指定 WindowTabs tag、应用 `patches/upstream-ipc.patch`、恢复 NuGet 包、编译带 IPC 的核心、生成 `helper/current.json`，并上传 `.upx` 构建产物。将本目录作为 GitHub 仓库后，在 Actions 页面手动运行工作流即可，不需要本地 Windows 电脑。

如果使用的是当前旧版 exe，插件会自动进入“兼容模式”：核心仍然由 uTools 启动并在后台运行，但状态查询、重启和原生设置按钮需要带 IPC 的新版本核心。替换 `helper/<version>/WindowTabs.exe` 并同步更新 `helper/current.json` 后即可切换到完整集成模式。

## 当前范围

当前版本已实现：

- helper 定位；
- helper 启动、停止和重启；
- Named Pipe JSON IPC 客户端；
- 状态机和超时；
- 状态页和诊断信息；
- uTools `onPluginEnter` / `onPluginOut` 生命周期接入；
- helper 崩溃事件展示。
- 并发启动/停止/重启合并，避免重复创建 helper；
- IPC 帧大小限制、断管道快速失败和最近日志诊断；
- 兼容模式下等待旧版进程真正退出；
- 按运行状态自动启用或禁用操作按钮；
- 非 Windows 环境不会尝试启动 Windows helper。
- `getConfig` / `updateConfig` 会先确认 IPC 已就绪，旧版核心返回明确的 `IPC_UNAVAILABLE`。

`plugin.json` 没有把功能入口限制为 `win32`，这样在 macOS/Linux 的 uTools 开发者工具中也能正常安装和检查插件；运行时会显示“平台不支持”，只有 Windows 才会启动原生 WindowTabs helper。

当前尚未实现：

- 当前编译产物中的 Named Pipe Server（需要按 `native/` 说明重新编译原生核心）；
- 真实 EXE 的打包和代码签名；
- 配置字段的完整映射；
- 自动下载、升级和回滚 UI。
