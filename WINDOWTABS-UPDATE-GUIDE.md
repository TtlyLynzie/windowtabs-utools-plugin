# WindowTabs 更新指南

以后每次跟随官方 WindowTabs 更新时，只修改 `build/core-manifest.json` 的目标 Tag 和补丁编号，然后让 GitHub Actions 完成 Windows 构建。

## 更新流程

1. 检查官方仓库的正式 Tag：
   `https://github.com/standard-software/WindowTabs`
2. 修改 `build/core-manifest.json`：
   - `coreTag`：新的官方 Tag；
   - `patch`：当前 IPC 补丁路径；
   - `patchId`：新的补丁版本号。
3. 提交并推送到插件仓库。
4. 在 GitHub Actions 运行 `Build WindowTabs uTools plugin`。
5. 构建必须通过：补丁应用、Windows 编译、IPC `hello/status/shutdown` 运行时测试、SHA-256 校验和市场目录检查。运行时测试会验证真正生成的 exe 能建立命名管道并返回可解析的 JSON，避免只编译成功但运行时 `REQUEST_TIMEOUT`。
6. 检查 `helper/current.json`：确认 `buildId`、`sourceTag`、`supportsIpc`、`sha256` 和 `path` 均已更新。
7. 在 Windows 测试旧插件升级场景：保留旧版 WindowTabs 进程运行，然后安装新插件，确认插件可以切换到新核心。
8. 在 uTools 开发者工具中选择 `dist/market`，提交应用市场审核。

## 发布前检查

- `dist/market` 只有一个 `WindowTabs.exe`；
- `current.json` 指向当前版本目录；
- `supportsIpc` 和 `ipc` 都是 `true`；
- 核心可以响应 `hello`、`status`、`getConfig`、`updateConfig` 和 `shutdown`；
- IPC 响应使用无 BOM UTF-8；插件客户端也会剥离首帧 BOM，兼容已发布的旧核心；
- 运行中的核心 `buildId` 与清单一致；
- 旧进程不会被误杀；
- 新核心启动失败时显示 IPC 启动失败，不得伪装成兼容模式；
- 市场目录不包含旧核心、源码、测试、补丁和构建脚本。

用户只从 uTools 应用市场安装和更新插件，不需要单独安装 WindowTabs，也不需要执行命令。
