# WindowTabs 上游版本更新指南

用户只通过 uTools 应用市场安装和更新插件。发布时在 uTools 开发者工具选择 `dist/market`；不以离线安装包作为用户分发方式，也不要求用户安装或运行单独的 WindowTabs。

## 每次更新的执行步骤

1. 读取 `build/core-manifest.json`，确认当前官方 Tag、补丁编号、设置契约版本和必需能力。
2. 拉取 `standard-software/WindowTabs` 的目标正式 Tag，在干净源码上审阅从旧 Tag 到新 Tag 的差异。重点检查设置字段、默认值、范围、主题、应用规则、快捷键、工作区序列化、开机启动和窗口恢复。
3. 把现有集成补丁应用到目标 Tag。不能直接使用官方 exe，因为官方版本没有 uTools 的设置契约和命名管道接口。
4. 解决补丁冲突，并同步更新 `settings-schema.json` 与原生嵌入的同名文件、原生 IPC 控制器、前端字段与说明、迁移逻辑和 Windows 真实核心测试。
5. 给补丁使用新的唯一 `patchId`，更新核心 `hello.buildId`，再从干净官方 Tag 生成单一补丁文件。用 `git apply --check` 验证补丁可重放。
6. 更新 `build/core-manifest.json` 的 `coreTag`、`patch`、`patchId`。只有在数据契约不兼容时才提升 `contractVersion`。
7. 把源码提交到 GitHub，运行 `Build WindowTabs uTools plugin`。工作流必须先编译 Windows 核心，再用隔离设置文件测试，最后才生成市场目录。
8. 自动测试必须覆盖准确的请求编号、核心身份、全部设置字段、修改与回读、冲突拒绝、非法值拒绝、应用规则新增/删除、自定义主题新增/删除、工作区读写、独立设置路径和正常退出。
9. 下载同一次成功构建的 `dist/market` artifact。不要混用另一次构建的 exe、`current.json` 或设置字段表。
10. 可选：在 Windows uTools 中抽查应用规则、四边外观、颜色、操作习惯、快捷键、工作区捕获/编辑/恢复、开机启动、备份导入、暂停与停止、旧插件升级。未执行人工抽查不阻断发布；发现明确回归时应先修复并重跑自动测试。
11. 自动测试和 artifact 清单校验通过后，用该次成功构建的 artifact 市场目录替换本地 `dist/market`，并在 uTools 开发者工具选择该目录发布。
12. 市场目录必须同时包含 `LICENSES/WindowTabs-MIT.txt`、`THIRD-PARTY-NOTICES.md`、`SOURCE-BUILD.md`、`audit/source-manifest.json` 和对应的补丁副本。审计清单中的上游 commit、补丁哈希、schema 哈希、exe 哈希和运行时证明必须完全一致。

## 自动发布门槛

`helper/current.json` 必须同时匹配版本、上游 Tag 和 commit、`patchId`、`buildId`、exe 的 `sha256`、`contractVersion`、`integrated-settings-v1`、字段表 `schemaSha256`，以及同一个 exe/字段表/构建身份的 `runtimeVerification`。任何一项不一致，`package-plugin.sh` 都会停止，现有 `dist/market` 不会被删除。

市场目录使用白名单，包含插件页面、字段表、图标、preload、许可证/构建说明、审计补丁和一个经过验证的核心版本；开发期 `mock.js`、测试、源码工作树和旧核心不得进入市场目录。

## 可直接交给 Codex 的更新 Prompt

> 请把此工作区的 WindowTabs uTools 插件同步到 GitHub 官方仓库 `standard-software/WindowTabs` 的最新正式版本。用户只通过 uTools 应用市场安装，不考虑以离线安装包分发，也不能要求用户另行安装 WindowTabs。请先读取 `WINDOWTABS-UPDATE-GUIDE.md`、`build/core-manifest.json` 和现有集成补丁；比较新旧官方 Tag，核对所有有效设置、默认值、应用规则、主题、快捷键、工作区、开机启动和数据格式。把 uTools 内置中文设置界面与原生 IPC 契约同步到新版，生成可在干净官方 Tag 上重放的新补丁，并更新唯一 patchId、核心 buildId、字段表、测试和文档。使用 GitHub Actions 的 Windows 环境编译；用隔离设置文件完成真实 exe 的设置读写、冲突、非法值、应用规则、主题、工作区和退出测试。自动测试通过后生成只含一个最新核心和必要资源的 `dist/market` artifact，并核对 exe SHA-256、schema SHA-256、运行时测试证明和清单完全一致。保留当前可用的 `dist/market`，直到新版通过全部自动测试；Windows uTools 人工抽查为可选项。完成后告诉我新版本、构建链接、验证结果和市场目录内容。

## 已知回归记录

0.2.2 曾因原生核心把字符串请求编号重复编码而出现 `REQUEST_TIMEOUT`。新核心必须原样回传编号类型和值，生产 preload 测试中的兼容计数必须为 0。连接成功只证明通信可用，不能代替设置修改与回读测试。
