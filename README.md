# WindowTabs uTools 插件

后续跟随官方版本更新时，请先阅读 [WindowTabs 更新指南](WINDOWTABS-UPDATE-GUIDE.md)。

这是“uTools 设置界面 + WindowTabs 原生核心”方案的集成工程。当前核心版本和补丁入口统一记录在 `build/core-manifest.json`。

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
   ├─ current.json
   └─ <version>/WindowTabs.exe
```

## 接入原生核心

当前工作区已经放入一份带 uTools IPC 的 WindowTabs `ss_2026.11.06` 编译产物，并整理为：

```text
windowtabs-utools-plugin/helper/
├─ current.json
└─ ss_2026.11.06-ipc/
   ├─ WindowTabs.exe
   ├─ WindowTabs.exe.config
   └─ Settings/
```

`current.json` 让插件按版本目录定位 helper，并记录上游 release 地址和真实 SHA-256。插件会在首次启动和插件升级后校验，并把新版本同步到 uTools 本地数据目录。

如果重新放置其他版本的 WindowTabs，请保持“版本目录 + `current.json`”结构。官方原始 exe 没有 uTools IPC 时，插件会显示兼容模式；当前内置版本已经是带 IPC 的自编译版本。

带 IPC 的核心包含我们设计的 Named Pipe Server。插件可以定位并启动它，并在 IPC 不可用时进入兼容模式；要让 uTools 查询状态、重启核心和打开设置，原生核心需要：

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

## 准备 uTools 应用市场版本

在 macOS/Linux 或带有 `zip` 命令的 Windows 环境执行：

```sh
./package-plugin.sh
```

维护者可以使用脚本校验 `helper/current.json` 和核心 SHA-256，并生成提交 uTools 应用市场所需的构建文件。发布构建采用白名单，只包含当前版本核心及其运行所需的 `Settings`，不会包含旧版核心、源码、补丁、测试、构建脚本或文档。生成的 `dist/market` 是干净的市场发布目录，提交 uTools 应用市场时应选择这个目录，不要选择包含开发文件的项目根目录。用户通过 uTools 应用市场安装插件，不需要单独安装 WindowTabs。插件首次启动和升级时会比较内置版本与 uTools 本地缓存，版本变化时自动同步新核心。

### 无 Windows 电脑时的构建

`.github/workflows/build-plugin.yml` 使用 GitHub Actions 的 `windows-latest` runner 自动完成以下工作：读取 `build/core-manifest.json`、下载指定 WindowTabs tag、应用补丁、恢复 NuGet 包、编译带 IPC 的核心、生成 `helper/current.json`，运行 JavaScript 和安装包检查，并上传构建产物。将本目录作为 GitHub 仓库后，在 Actions 页面手动运行工作流即可，不需要本地 Windows 电脑。

如果用户已有旧版插件缓存，插件启动时会比较 SHA-256 并自动同步 `current.json` 指向的新核心。只有在核心不支持 IPC 或校验失败时，插件才会进入兼容模式。

## 开发检查

```sh
node --check preload.js
node --check renderer.js
node tests/smoke-test.mjs
./package-plugin.sh
```

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

- 自动下载、升级和回滚 UI；
- 真实 EXE 的打包和代码签名；
- 配置字段的完整映射；
