# WindowTabs 更新指南

以后每次跟随官方 WindowTabs 更新时，先检查上游变更与 IPC 补丁是否兼容，再修改目标 Tag 和补丁编号，让 GitHub Actions 完成 Windows 构建。不能只替换官方 exe：官方版本不包含插件通信桥。

## 更新流程

1. 检查官方仓库的正式 Tag：
   `https://github.com/standard-software/WindowTabs`
2. 修改 `build/core-manifest.json`：
   - `coreTag`：新的官方 Tag；
   - `patch`：当前 IPC 补丁路径；
   - `patchId`：新的补丁版本号。
3. 提交并推送到插件仓库。
4. 在 GitHub Actions 运行 `Build WindowTabs uTools plugin`。
5. 构建必须通过下文的自动验收，任何失败都必须阻止产物上传。下载同一次成功构建的产物，将验证过的 `helper` 和市场目录同步到本地，不能混用不同构建的清单和 exe。
6. 检查 `helper/current.json`：确认 `buildId`（由官方版本和 `patchId` 生成）、`sourceTag`、`sourceCommit`、`supportsIpc`、`sha256` 和 `path` 均对应本次构建。发布目录内 exe 的实际 SHA-256 必须匹配清单。
7. 在 Windows 测试旧插件升级场景：保留旧版 WindowTabs 进程运行，然后安装新插件，确认插件可以切换到新核心。
8. 在 uTools 开发者工具中选择 `dist/market`，提交应用市场审核。

## 自动验收门槛

- `tests/ipc-transport.cjs` 执行实际 `preload.js`，验证字符串编号、并发回复匹配、BOM/分片、旧版带引号编号兼容、未知编号不能误匹配、超时诊断包含方法名。
- `scripts/Smoke-TestCore.ps1` 在 Windows 运行新 exe，严格检查响应编号的值和类型（普通字符串、含引号与反斜杠的字符串、数字）。不能仅检查 `ok: true`。
- `scripts/Smoke-TestClient.cjs dist/market` 使用 Node 20 执行市场目录内的真实 preload，与新编译 exe 通信，检查 `hello/status/getConfig/updateConfig` 空补丁、错误回复、`shutdown` 和进程退出。使用独立管道和临时核心副本，不修改发布文件。必须连接本次启动的 PID，且旧编号兼容次数必须为 0。
- 保留源代码检查、SHA-256 校验、市场目录检查。测试失败不得绕过测试或使用旧构建的 exe 顶替。

这些检查证明自动测试环境里的通信链可用，不能代替 Windows uTools 内的交互验收。

## Windows uTools 发布前人工验收

- `dist/market` 只有一个 `WindowTabs.exe`；
- `current.json` 指向当前版本目录；
- `supportsIpc` 和 `ipc` 都是 `true`；
- 核心可以响应 `hello`、`status`、`getConfig`、`updateConfig` 和 `shutdown`；
- IPC 响应使用无 BOM UTF-8；插件客户端也会剥离首帧 BOM，兼容已发布的旧核心；
- 诊断中的插件版本、核心 `helperBuildId/helperPatchId` 与打包清单一致，实际 exe 哈希匹配清单；目前 hello 不回传 buildId，不能声称已经核验运行中核心的 buildId；
- 插件显示 READY，设置可读取，修改一项设置可保存并在重启后保持，再还原该设置；
- `ipcTrace` 没有持续超时或无法匹配的回复；新核心 `legacyResponseIdCount` 为 0（旧 v9 核心可能大于 0，表示客户端正在兼容旧编号）；
- 旧进程不会被误杀；
- 新核心启动失败时显示 IPC 启动失败，不得伪装成兼容模式；
- 市场目录不包含旧核心、源码、测试、补丁和构建脚本。

用户只从 uTools 应用市场安装和更新插件，不需要单独安装 WindowTabs，也不需要执行命令。

## 0.2.2 超时的回归记录

原生桥曾把字符串请求编号先序列化，再封装为 JSON 字符串。`req-123` 被回传成包含额外引号的编号，插件无法匹配，最终报 REQUEST_TIMEOUT。原测试仅使用数字编号且未核对响应编号，因而误判通过。0.2.3 客户端兼容已发布核心；v10 补丁原样回传 JToken；新增真实客户端与严格编号测试防止再次漏检。诊断现在保留方法名、错误消息、构建编号和最近 30 条通信摘要，不记录设置内容。
