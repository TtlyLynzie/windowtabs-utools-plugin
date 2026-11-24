# 原生 IPC 接入说明

`WindowTabsIpc.fs` 是针对 WindowTabs 的纯 F# IPC 实现，由对应的 `patches/upstream-integrated-v15.txt` 应用到官方源码，并加入 `WtProgram.fsproj`。`WindowTabsIpcServer.cs` 保留为独立 C# 管道服务的参考实现。

官方发布的原始 EXE 不含 uTools IPC。要获得完整控制能力，必须从官方 Tag 应用集成补丁后，在 Windows 上重新编译；市场版本通过 GitHub Actions 构建和运行验证。

## Windows 构建步骤

1. 安装 Visual Studio、F# 工具、.NET Framework 4.7.2 开发组件和项目需要的 NuGet 包；
2. 在 `WindowTabs-source/` 中打开 `WindowTabs.sln`；
3. 确认 `WtProgram/WtProgram.fsproj` 已包含 `WindowTabsIpc.fs`；
4. 使用 Release 配置构建 `WtProgram`；
5. 检查生成的 `WindowTabs.exe` 含有 `ss_2026.11.11` 版本和 IPC 代码；
6. 将生成文件复制到插件的 `helper/<version>-upstream-integrated-v15/`，更新 `helper/current.json` 的 SHA-256；
7. 使用 `package-plugin.sh` 重新生成 `.upx`。

## IPC 接入位置

`Program.run` 在服务注册、设置加载和设置窗口预加载完成后创建 `WindowTabsIpc.Server`，主入口从 `--windowtabs-ipc-pipe=...` 读取管道参数。`Application.Run()` 返回后释放服务。

普通桌面启动不带管道参数，因此仍保持 WindowTabs 原有行为；uTools 启动时会带上管道参数和插件父进程 PID。helper 会监测该父进程，发现插件进程退出后自动关闭 WindowTabs，但保留 helper 文件。只有插件内“卸载前停止并清理”操作会删除本插件数据目录中的 helper。

## 当前方法

- `hello`：返回核心版本、协议版本和能力列表；
- `status`：返回运行状态、禁用状态、版本和进程号；
- `getCapabilities`：返回可用功能；
- `getConfig`：读取白名单配置；
- `updateConfig`：按白名单更新并刷新配置；
- `reloadConfig`：重新刷新配置；
- `openSettings`：兼容模式下打开原生设置；
- `shutdown`：请求核心正常退出；
- `logTail`：保留接口，当前返回空日志列表。

配置更新不允许任意 JSON 路径或 shell 命令。后续新增 WindowTabs 功能时，应先加入能力列表和适配映射，再开放到 uTools 页面。
