namespace Bemo

open System
open System.IO
open System.Drawing
open System.Reflection
open System.Security.Cryptography
open System.Text
open System.Text.RegularExpressions
open Microsoft.FSharp.Reflection
open Newtonsoft.Json
open Newtonsoft.Json.Linq

/// This contract is intentionally independent of the native settings dialog.
module IntegratedSettings =
    exception ContractError of string * string
    let fail code message = raise (ContractError(code, message))
    let private jsonNull() = JValue(null : obj) :> JToken
    let private token (x: obj) = if isNull x then jsonNull() else JToken.FromObject(x)
    let private obj (items: (string * obj) list) =
        let o = JObject()
        for k,v in items do o.[k] <- token v
        o
    let private prop (o: JObject) key =
        o.Properties() |> Seq.tryFind(fun p -> String.Equals(p.Name,key,StringComparison.OrdinalIgnoreCase))
    let private at (o: JObject) key = prop o key |> Option.map(fun p -> p.Value) |> Option.defaultWith jsonNull
    let private str (t: JToken) = if isNull t || t.Type = JTokenType.Null then "" else t.Value<string>()
    let private bool (t: JToken) = t.Value<bool>()
    let private int (t: JToken) = t.Value<int>()
    let private put (o: JObject) key (value: JToken) =
        match prop o key with
        | Some p -> if value.Type = JTokenType.Null then p.Remove() else p.Value <- value.DeepClone()
        | None -> if value.Type <> JTokenType.Null then o.[key] <- value.DeepClone()
    let private pathGet (o: JObject) (path: string) =
        path.Split('.') |> Array.fold(fun (t: JToken) key -> match t with :? JObject as x -> at x key | _ -> jsonNull()) (o :> JToken)
    let private pathPut (o: JObject) (path: string) value =
        let keys = path.Split('.')
        let mutable parent = o
        for key in keys |> Array.take (keys.Length - 1) do
            match at parent key with
            | :? JObject as child -> parent <- child
            | _ -> let child = JObject() in parent.[key] <- child; parent <- child
        put parent keys.[keys.Length-1] value
    let private revision (value: JToken) =
        use sha = SHA256.Create()
        sha.ComputeHash(Encoding.UTF8.GetBytes(value.ToString(Formatting.None)))
        |> Array.map(fun b -> b.ToString("x2")) |> String.concat ""
    let private openSchemaStream() =
        let assemblies =
            [ Assembly.GetEntryAssembly(); Assembly.GetExecutingAssembly() ]
            |> List.filter(fun assembly -> not (isNull assembly))
        let resource =
            assemblies
            |> Seq.collect(fun assembly ->
                assembly.GetManifestResourceNames()
                |> Seq.map(fun name -> assembly, name))
            |> Seq.tryFind(fun (_, name) ->
                String.Equals(name, "WindowTabs.SettingsSchema.json", StringComparison.OrdinalIgnoreCase)
                || String.Equals(name, "SettingsSchema.json", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith(".SettingsSchema.json", StringComparison.OrdinalIgnoreCase))
        match resource with
        | Some (assembly, name) ->
            let stream = assembly.GetManifestResourceStream(name)
            if isNull stream then fail "SCHEMA_RESOURCE_MISSING" (sprintf "Unable to open embedded settings schema: %s" name)
            stream
        | None ->
            let available =
                assemblies
                |> Seq.collect(fun assembly -> assembly.GetManifestResourceNames())
                |> String.concat ", "
            fail "SCHEMA_RESOURCE_MISSING" (sprintf "Embedded settings schema was not found. Available resources: %s" available)
    let private schema = lazy (
        use stream = openSchemaStream()
        use reader = new StreamReader(stream)
        JObject.Parse(reader.ReadToEnd()))
    let private fields() = schema.Value.["fields"] :?> JArray |> Seq.cast<JObject> |> Seq.toArray
    let private appearance (value: TabAppearanceInfo) =
        let result = JObject()
        let fields = FSharpType.GetRecordFields(typeof<TabAppearanceInfo>)
        let values = FSharpValue.GetRecordFields(value)
        for index in 0 .. fields.Length - 1 do
            result.[fields.[index].Name] <-
                match values.[index] with
                | :? Color as c -> token (sprintf "%02X%02X%02X" c.R c.G c.B)
                | item -> token item
        result
    let private validate (field: JObject) (value: JToken) =
        let kind = str field.["type"]
        let nullable = not (isNull field.["inherit"]) && bool field.["inherit"]
        let invalid() = fail "INVALID_SETTING" (str field.["label"])
        if isNull value then invalid()
        elif value.Type = JTokenType.Null && nullable then ()
        else
            match kind with
            | "boolean" -> if value.Type <> JTokenType.Boolean then invalid()
            | "number" | "hotkey" ->
                if value.Type <> JTokenType.Integer then invalid()
                let n = value.Value<int64>()
                if n < field.["min"].Value<int64>() || n > field.["max"].Value<int64>() then invalid()
            | "select" ->
                if value.Type <> JTokenType.String || not (field.["options"] |> Seq.exists(fun o -> JToken.DeepEquals(o.["value"],value))) then invalid()
            | "color" -> if value.Type <> JTokenType.String || not (Regex.IsMatch(str value,"\\A[0-9a-fA-F]{6}\\z")) then invalid()
            | "edges" ->
                match value with
                | :? JArray as a when a.Count > 0 && a.Count <= 4 ->
                    let names = a |> Seq.map str |> Seq.toArray
                    if names |> Array.exists(fun n -> not (List.contains n ["Top";"Left";"Right";"Bottom"])) then invalid()
                    if (Array.distinct names).Length <> names.Length then invalid()
                | _ -> invalid()
            | _ -> invalid()

    type Controller(owner: Invoker) =
        let workspace = lazy (let m = WorkspaceModel() in m.init(); m)
        let mutable jobId = ""
        let presets() =
            let p = Services.program
            let values = ["浅蓝",p.defaultTabAppearanceInfo; "浅灰",p.lightMonoTabAppearanceInfo;
                          "深色",p.darkModeTabAppearanceInfo; "深蓝",p.darkModeBlueTabAppearanceInfo;
                          "深灰一",p.darkMonoTabAppearanceInfo; "深灰二",p.darkMono2TabAppearanceInfo;
                          "深灰三",p.darkMono3TabAppearanceInfo; "夜色",p.nightHorizonTabAppearanceInfo; "暗红边框",p.darkRedFrameTabAppearanceInfo]
            JArray(values |> List.map(fun (name,colors) -> obj ["name",box name;"colors",box (appearance colors)] :> JToken) |> List.toArray)
        let ensureTrusted() = if not Services.settings.trusted then fail "SETTINGS_UNTRUSTED" "Settings could not be loaded safely."
        let values() =
            let root = Services.settings.root
            let result = JObject()
            let a = appearance Services.program.tabAppearanceInfo
            for f in fields() do
                let path = str f.["path"]
                let raw = pathGet root path
                let value =
                    if path = "RunAtStartup" then token (Services.settings.getValue("runAtStartup"))
                    elif path.StartsWith("TabAppearance.") then at a (path.Substring(14))
                    elif path.StartsWith("HotKeys.") then token (Services.program.getHotKey(path.Substring(8)))
                    elif not (isNull f.["inherit"]) && bool f.["inherit"] then raw
                    elif path = "TabEdges" then
                        JArray(TabEdgeSettings.listedOf root |> List.map(fun e -> token (TabEdgeSettings.edgeName e)) |> List.toArray) :> JToken
                    else
                        try Services.settings.getValue(path.Substring(0,1).ToLowerInvariant()+path.Substring(1)) |> token
                        with _ -> if raw.Type <> JTokenType.Null then raw else f.["default"].DeepClone()
                result.[path] <- value
            result
        let snapshot() =
            ensureTrusted()
            obj ["contractVersion",box 1; "values",box (values()); "presets",box (presets());
                 "customThemes",box (match at Services.settings.root "CustomColorThemes" with :? JArray as a -> a | _ -> JArray());
                 "revision",box (revision (Services.settings.root)); "disabled",box Services.program.isDisabled]
        let commit root =
            ensureTrusted()
            if not (PortableSettings.canWrite Services.settings.activePath) then fail "SAVE_FAILED" "Settings file is not writable."
            Services.settings.commitRoot root
            Services.program.refresh()
        let checkRevision (parameters: JObject) =
            if str parameters.["revision"] <> revision Services.settings.root then fail "SETTINGS_CONFLICT" "Settings changed since they were loaded."
        let applications() =
            let os = OS()
            let live = Services.program.appWindows.list |> List.choose(fun h ->
                try let w = os.windowFromHwnd h in if w.isWindow then Some(w.pid.processPath,w) else None with _ -> None)
            let paths = (Services.program.getAllConfiguredProcessPaths().list @ (live |> List.map fst)) |> List.distinct
            let apps = JArray()
            for path in paths do
                let windows = JArray()
                for p,w in live do
                    if String.Equals(p,path,StringComparison.OrdinalIgnoreCase) then
                        windows.Add(obj ["id",box (w.hwnd.ToInt64().ToString());"title",box w.text;
                                         "enabled",box (Services.filter.getIsTabbingEnabledForWindow w.hwnd)])
                apps.Add(obj ["path",box path;"name",box (Path.GetFileNameWithoutExtension path);"running",box (windows.Count > 0);
                              "enabled",box (Services.filter.getIsTabbingEnabledForProcess path);
                              "autoGroup",box (Services.program.getAutoGroupingEnabled path);
                              "category",box (Services.program.getCategoryNumber path);"windows",box windows])
            obj ["apps",box apps;"groupCount",box Services.desktop.groups.length]
        let workspaceState() =
            let restoring,matched,total,errors = workspace.Value.restoreProgress
            obj ["jobId",box jobId;"running",box restoring;"matched",box matched;"total",box total;"errors",box errors]
        let workspaceList() =
            let data = match at Services.settings.root "workspaces" with :? JArray as a -> a | _ -> JArray()
            obj ["items",box data;"revision",box (revision Services.settings.root)]
        let checkNotRestoring() =
            let restoring,_,_,_ = workspace.Value.restoreProgress
            if restoring then fail "BUSY" "Workspace restoration is still in progress."
        let storageInfo() =
            obj ["location",box (if StartupRegistration.samePath Services.settings.activePath (PortableSettings.exePath()) then "portable" else "user");
                 "path",box Services.settings.activePath;"writable",box (PortableSettings.canWrite Services.settings.activePath)]
        let validateThemes (themes: JArray) =
            if themes.Count > 100 then fail "INVALID_SETTING" "Too many themes."
            for t in themes do
                if str t.["name"] = "" || (str t.["name"]).Length > 80 then fail "INVALID_SETTING" "Invalid theme name."
                for f in fields() |> Array.filter(fun f -> str f.["type"] = "color") do
                    let name = (str f.["path"]).Substring(17)
                    let key = name.Substring(0,1).ToLowerInvariant()+name.Substring(1)
                    if isNull t.[key] || t.[key].Type <> JTokenType.Integer then fail "INVALID_SETTING" "Theme is missing a color."
                    let n = t.[key].Value<int64>()
                    if n < -2147483648L || n > 2147483647L then fail "INVALID_SETTING" "Invalid theme color."
        let handle methodName (p: JObject) =
            match methodName with
            | "settingsSnapshot" -> snapshot()
            | "settingsApply" ->
                ensureTrusted()
                let current = values()
                let root = Services.settings.root
                let changes = p.["changes"] :?> JArray
                let seen = Collections.Generic.HashSet<string>()
                // Validate the entire batch and every before-value before any mutation.
                for c in changes do
                    let path = str c.["path"]
                    if not (seen.Add path) then fail "INVALID_SETTING" "Duplicate field."
                    let f = fields() |> Array.tryFind(fun f -> str f.["path"] = path)
                    match f with
                    | None -> fail "INVALID_SETTING" "Unknown setting."
                    | Some f -> validate f c.["value"]
                    if not (JToken.DeepEquals(current.[path], c.["before"])) then fail "SETTINGS_CONFLICT" path
                    if path <> "RunAtStartup" then pathPut root path c.["value"]
                let ctrl,alt = pathGet root "EnableCtrlNumberHotKey", pathGet root "EnableAltNumberHotKey"
                if ctrl.Type = JTokenType.Boolean && alt.Type = JTokenType.Boolean && bool ctrl && bool alt then fail "INVALID_SETTING" "Number key modes must be exclusive."
                // Validate duplicate effective shortcuts using the upstream policy.
                let mode = HotKeyPolicy.numberKeyMode (ctrl.Type = JTokenType.Boolean && bool ctrl) (alt.Type = JTokenType.Boolean && bool alt)
                let bindings = HotKeyPolicy.bindings mode (fun key -> let t = pathGet root ("HotKeys."+key) in if t.Type = JTokenType.Integer then int t else 0)
                let _,duplicates = HotKeyPolicy.dedupe bindings
                if not (List.isEmpty duplicates) then fail "HOTKEY_CONFLICT" "Two actions use the same shortcut."
                if changes.Count > 0 then
                    commit root
                    for c in changes do
                        if str c.["path"] = "RunAtStartup" then
                            try Services.settings.setValue("runAtStartup",box (bool c.["value"]))
                            with StartupRegistration.ChangeFailed -> fail "STARTUP_FAILED" "开机启动设置未能生效。"
                            if not (JToken.DeepEquals(token (Services.settings.getValue("runAtStartup")),c.["value"])) then fail "STARTUP_FAILED" "开机启动设置未能生效。"
                snapshot()
            | "themesUpdate" ->
                checkRevision p
                let themes = p.["items"] :?> JArray
                validateThemes themes
                let root = Services.settings.root
                put root "CustomColorThemes" themes
                commit root
                snapshot()
            | "setEnabled" ->
                if isNull p.["enabled"] || p.["enabled"].Type <> JTokenType.Boolean then fail "INVALID_SETTING" "Expected enabled flag."
                Services.program.setDisabled(not (bool p.["enabled"]))
                obj ["enabled",box (not Services.program.isDisabled)]
            | "applications" -> applications()
            | "applicationUpdate" ->
                ensureTrusted()
                let path = str p.["path"]
                if not (PortableSettings.canWrite Services.settings.activePath) then fail "SAVE_FAILED" "Settings file is not writable."
                if String.IsNullOrWhiteSpace path || path.Length > 32768 then fail "INVALID_SETTING" "Invalid application."
                if not (isNull p.["remove"]) && bool p.["remove"] then
                    Services.program.removeProcessSettings path
                    commit Services.settings.root
                else
                    let enabled = bool p.["enabled"]
                    let grouping = bool p.["autoGroup"]
                    let category = int p.["category"]
                    if category < 0 || category > 10 || (grouping && not enabled) then fail "INVALID_SETTING" "Invalid application rule."
                    Services.filter.setIsTabbingEnabledForProcess path enabled
                    Services.program.setAutoGroupingEnabled path grouping
                    if category = 0 then
                        for n in 1..10 do Services.program.setCategoryEnabled path n false
                    else Services.program.setCategoryEnabled path category true
                    // Native setters can report disk failures indirectly; force a checked commit.
                    commit Services.settings.root
                    if not enabled then Services.program.forgetClosedTabsOfUntabbedApps()
                applications()
            | "windowUpdate" ->
                let hwnd = IntPtr(Int64.Parse(str p.["id"]))
                if not (Services.program.appWindows.list |> List.contains hwnd) then fail "WINDOW_CLOSED" "The window closed."
                let path = (OS().windowFromHwnd hwnd).pid.processPath
                if not (Services.filter.getIsTabbingEnabledForProcess path) then fail "APP_DISABLED" "Enable tabs for this application first."
                Services.filter.setIsTabbingEnabledForWindows (List2([hwnd])) (bool p.["enabled"])
                applications()
            | "workspaces" -> workspaceList()
            | "workspaceCapture" ->
                ensureTrusted(); checkNotRestoring(); checkRevision p
                workspace.Value.reload()
                workspace.Value.beginSettingsSession()
                workspace.Value.create(bool p.["allDesktops"])
                commit Services.settings.root
                workspaceList()
            | "workspaceUpdate" ->
                ensureTrusted(); checkNotRestoring(); checkRevision p
                let items = p.["items"] :?> JArray
                if items.Count > 200 then fail "INVALID_SETTING" "Too many workspaces."
                for item in items do
                    let ws = Workspace.deserialize(item :?> JObject)
                    if String.IsNullOrWhiteSpace ws.name || ws.name.Length > 100 then fail "INVALID_SETTING" "Invalid workspace name."
                    if ws.groups.length > 200 then fail "INVALID_SETTING" "Too many groups."
                    for g in ws.groups.list do
                        let group = g :?> WorkspaceGroup
                        if group.windows.length > 1000 then fail "INVALID_SETTING" "Too many windows."
                        for w in group.windows.list do
                            let w = w :?> WorkspaceWindow
                            let pattern = w.title
                            if Microsoft.FSharp.Core.Operators.int w.matchType < 0 || Microsoft.FSharp.Core.Operators.int w.matchType > 4 || pattern.Length > 1024 then fail "INVALID_SETTING" "Invalid window matching."
                            if Microsoft.FSharp.Core.Operators.int w.matchType = 4 then Regex(pattern,RegexOptions.None,TimeSpan.FromMilliseconds(100.0)) |> ignore
                let root = Services.settings.root
                put root "workspaces" items
                commit root
                workspace.Value.reload()
                workspaceList()
            | "workspaceRestore" ->
                checkNotRestoring(); checkRevision p
                workspace.Value.reload()
                let index = int p.["index"]
                if index < 0 || index >= workspace.Value.workspaces.length then fail "SETTINGS_CONFLICT" "Workspace no longer exists."
                jobId <- Guid.NewGuid().ToString("N")
                workspace.Value.selected <- box (workspace.Value.workspaces.at index)
                workspace.Value.restore()
                workspaceState()
            | "workspaceRestoreStatus" ->
                if str p.["jobId"] <> jobId then fail "SETTINGS_CONFLICT" "Restore session has changed."
                workspaceState()
            | "storageInfo" -> storageInfo()
            | "storageTransfer" ->
                ensureTrusted(); checkNotRestoring(); checkRevision p
                Services.program.saveTabGroupsBeforeExit()
                Services.settings.transferSettings(bool p.["toPortable"],bool p.["move"])
                storageInfo()
            | _ -> fail "INVALID_REQUEST" "Unknown integrated method."
        member _.TryHandle(methodName, parameters) =
            let methods = ["settingsSnapshot";"settingsApply";"themesUpdate";"setEnabled";"applications";"applicationUpdate";"windowUpdate";
                           "workspaces";"workspaceCapture";"workspaceUpdate";"workspaceRestore";"workspaceRestoreStatus";"storageInfo";"storageTransfer"]
            if List.contains methodName methods then Some(owner.invoke(fun () -> handle methodName parameters)) else None
