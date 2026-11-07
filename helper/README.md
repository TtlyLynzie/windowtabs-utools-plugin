# WindowTabs 原生 helper

当前 helper 目录按版本保存编译产物：

```text
helper/
├─ current.json
└─ ss_2026.11.06/
   ├─ WindowTabs.exe
   ├─ WindowTabs.exe.config
   └─ Settings/
```

当前随插件分发的上游版本为 `ss_2026.11.06`。将来更新版本时新增版本目录，再更新上级 `current.json`，不要覆盖正在运行的 EXE。

插件会通过以下参数启动 helper：

```text
--windowtabs-ipc-pipe=\\.\pipe\windowtabs-...
```

WindowTabs 原生核心需要在该命名管道上提供 JSON Lines 协议。协议细节见上级目录的 `README.md` 和工作区中的 `WindowTabs-uTools-设计方案.md`。
