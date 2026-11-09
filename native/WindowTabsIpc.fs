namespace Bemo

open System
open System.IO
open System.IO.Pipes
open System.Text
open System.Threading
open System.Threading.Tasks
open System.Diagnostics
open System.Security.AccessControl
open System.Security.Principal
open Newtonsoft.Json
open Newtonsoft.Json.Linq

/// Small, versioned Named Pipe bridge used by the uTools host.
/// The bridge deliberately exposes a whitelist of settings instead of the
/// complete WindowTabs object graph. This keeps the public plugin contract
/// stable while the native settings model evolves upstream.
module WindowTabsIpc =

    [<Literal>]
    let protocolVersion = 1

    [<Literal>]
    let maxFrameBytes = 1024 * 1024

    // Keep the pipe protocol BOM-free. Node.js JSON.parse rejects a leading BOM.
    let private utf8NoBom = UTF8Encoding(false)

    let private exposedSettings =
        [| "IncludedPaths"; "ExcludedPaths"; "AutoGroupingPaths"
           "HideInactiveTabs"; "GroupTaskbarButtons"; "EnableTabbingByDefault"
           "EnableCtrlNumberHotKey"; "EnableAltNumberHotKey"; "EnableHoverActivate"
           "EnableTabPreview"; "TabPreviewDelay"; "TabPreviewSize"
           "TabCloseButton"; "TabPinButton"; "TabPositionByDefault"
           "TabVerticalDirection"; "HideTabsWhenDownByDefault"
           "HideTabsDelayMilliseconds"; "HideTabsOnFullscreen"
           "HideTabsWhileMoving"; "LockWindowPosition"; "SnapTabHeightMargin"
           "ChangeTabPositionOnSnap"; "SnapOnDragDetach"; "TabAppearance"
           "IsDisabled"; "EnableDarkMode" |]

    let private makeObject (properties: JProperty array) = JObject(properties)

    let private error (code: string) (message: string) : JObject =
        makeObject([| JProperty("ok", false);
                     JProperty("error", makeObject([| JProperty("code", code);
                                                       JProperty("message", message) |])) |])

    let private success (result: JObject) : JObject =
        makeObject([| JProperty("ok", true); JProperty("result", result) |])

    let private response (id: JToken) (body: JObject) : JObject =
        let result = body.DeepClone() :?> JObject
        // Echo the JSON value, including its type. Serializing a string ID
        // before wrapping it in JValue adds literal quotes and breaks Node's
        // pending-request lookup even though the response is valid JSON.
        result.["id"] <- if isNull id then JValue.CreateNull() :> JToken else id.DeepClone()
        result

    let private normalizePipeName (value: string) =
        if String.IsNullOrWhiteSpace(value) then invalidArg "pipeName" "IPC pipe name is empty."
        elif value.StartsWith("\\\\.\\pipe\\", StringComparison.OrdinalIgnoreCase) then
            value.Substring(9)
        else value

    let private pipeSecurity() =
        let security = PipeSecurity()
        let user = WindowsIdentity.GetCurrent().User
        security.AddAccessRule(PipeAccessRule(user, PipeAccessRights.ReadWrite, AccessControlType.Allow))
        security

    let private jsonValue (token: JToken) =
        if isNull token then null
        else
            match token.Type with
            | JTokenType.Boolean -> box(token.Value<bool>())
            | JTokenType.Integer -> box(token.Value<int64>())
            | JTokenType.Float -> box(token.Value<double>())
            | JTokenType.String -> box(token.Value<string>())
            | _ -> token.DeepClone() :> obj

    let private cloneExposedSettings() =
        let root = Services.settings.root
        let result = JObject()
        for key in exposedSettings do
            let value = root.[key]
            if not (isNull value) then result.[key] <- value.DeepClone()
        // runAtStartup is held by the Settings service because it controls the
        // Windows Startup-folder shortcut rather than the JSON settings file.
        result.["RunAtStartup"] <- JToken.FromObject(Services.settings.getValue("runAtStartup"))
        result

    let private validatePatch (patch: JObject) =
        let allowed = Set.ofArray (Array.append exposedSettings [| "RunAtStartup" |])
        let invalid =
            patch.Properties()
            |> Seq.map(fun p -> p.Name)
            |> Seq.filter(fun name -> not (allowed.Contains(name)))
            |> Seq.toArray
        if invalid.Length > 0 then
            invalidArg "patch" (sprintf "Unsupported settings: %s" (String.Join(", ", invalid :> seq<string>)))

    let private applyPatch (patch: JObject) =
        validatePatch patch
        // All mutations happen through the service proxy. Calls from the pipe
        // worker are marshalled to WindowTabs' owner thread by Services.
        let root = Services.settings.root
        for property in patch.Properties() do
            if property.Name = "RunAtStartup" then
                if property.Value.Type <> JTokenType.Boolean then
                    invalidArg "RunAtStartup" "RunAtStartup must be boolean."
                Services.settings.setValue("runAtStartup", box(unbox<bool>(property.Value.Value)))
            else
                root.[property.Name] <- property.Value.DeepClone()
        if patch.Properties() |> Seq.exists(fun p -> p.Name <> "RunAtStartup") then
            Services.settings.root <- root
            Services.program.refresh()
        cloneExposedSettings()

    // Handshake/status must never synchronously call a proxied UI service.
    // The IPC server starts before Application.Run(), so such a call can wait
    // forever for the main WinForms message loop and make every client time out.
    let private dispatch (coreVersion: string) (request: JObject) =
        match request.["version"] with
        | :? JValue as value when value.Type = JTokenType.Integer && Convert.ToInt32(value.Value) = protocolVersion -> ()
        | _ -> invalidArg "version" "Unsupported IPC protocol version."
        let methodName =
            match request.["method"] with
            | :? JValue as value when value.Type = JTokenType.String -> unbox<string>(value.Value)
            | _ -> invalidArg "method" "method is required."
        let parameters =
            match request.["params"] with
            | :? JObject as obj -> obj
            | _ -> JObject()
        match methodName with
        | "hello" ->
            success (makeObject([| JProperty("coreVersion", coreVersion);
                               JProperty("protocolVersion", protocolVersion);
                               JProperty("pid", Process.GetCurrentProcess().Id);
                               JProperty("groupCount", 0);
                               JProperty("capabilities", JArray([| JValue("status") :> JToken; JValue("config") :> JToken; JValue("settings") :> JToken |]));
                               JProperty("status", "ready") |]))
        | "status" ->
            success (makeObject([| JProperty("running", true);
                               JProperty("disabled", false);
                               JProperty("coreVersion", coreVersion);
                               JProperty("protocolVersion", protocolVersion);
                               JProperty("groupCount", 0);
                               JProperty("pid", Process.GetCurrentProcess().Id) |]))
        | "getCapabilities" ->
            success (makeObject([| JProperty("protocolVersion", protocolVersion);
                               JProperty("capabilities", JArray([| JValue("status") :> JToken; JValue("config") :> JToken; JValue("settings") :> JToken |])) |]))
        | "getConfig" -> success (cloneExposedSettings())
        | "updateConfig" ->
            match parameters.["patch"] with
            | :? JObject as patch -> success (applyPatch patch)
            | _ -> invalidArg "patch" "params.patch must be an object."
        | "reloadConfig" ->
            Services.program.refresh()
            success (cloneExposedSettings())
        | "openSettings" ->
            Services.managerView.show()
            success (makeObject([| JProperty("opened", true) |]))
        | "stop"
        | "shutdown" ->
            Services.program.shutdown()
            success (makeObject([| JProperty("accepted", true) |]))
        | "restart" ->
            Services.program.shutdown()
            success (makeObject([| JProperty("accepted", true); JProperty("restarting", true) |]))
        | "logTail" ->
            // Native diagnostics remain local. The first implementation has no
            // stable log ring, so return an empty list rather than exposing an
            // arbitrary file path over IPC.
            success (makeObject([| JProperty("lines", JArray()) |]))
        | _ -> invalidArg "method" (sprintf "Unsupported IPC method: %s" methodName)

    type Server(pipeName: string, coreVersion: string, log: string -> unit) =
        let pipeName = normalizePipeName pipeName
        let cancellation = new CancellationTokenSource()
        let mutable task: Task = null

        let handleClient (pipe: NamedPipeServerStream) =
            use reader = new StreamReader(pipe, utf8NoBom, false, 65536, true)
            use writer = new StreamWriter(pipe, utf8NoBom, 65536, true)
            writer.AutoFlush <- true
            let mutable connected = true
            while connected && not cancellation.IsCancellationRequested do
                let line = reader.ReadLine()
                if isNull line then connected <- false
                elif Encoding.UTF8.GetByteCount(line) > maxFrameBytes then
                    writer.WriteLine((error "FRAME_TOO_LARGE" "IPC frame exceeds the size limit.").ToString(Formatting.None))
                    connected <- false
                else
                    try
                        let request = JObject.Parse(line)
                        let id = request.["id"]
                        let body =
                            try dispatch coreVersion request
                            with
                            | :? ArgumentException as ex -> error "INVALID_REQUEST" ex.Message
                            | :? InvalidOperationException as ex -> error "CORE_NOT_READY" ex.Message
                            | ex ->
                                log (sprintf "IPC request failed: %O" ex)
                                error "INTERNAL_ERROR" ex.Message
                        writer.WriteLine((response id body).ToString(Formatting.None))
                    with
                    | ex ->
                        log (sprintf "IPC client disconnected after malformed request: %O" ex)
                        connected <- false

        let listen() =
            try
                while not cancellation.IsCancellationRequested do
                    use pipe = new NamedPipeServerStream(
                        pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous, 65536, 65536, pipeSecurity())
                    pipe.WaitForConnection()
                    if not cancellation.IsCancellationRequested then handleClient pipe
            with
            | :? OperationCanceledException -> ()
            | :? ObjectDisposedException -> ()
            | ex -> log (sprintf "IPC server stopped: %O" ex)

        member _.Start() =
            if isNull task then
                task <- Task.Factory.StartNew((fun () -> listen()), cancellation.Token,
                                              TaskCreationOptions.LongRunning, TaskScheduler.Default)

        member _.Dispose() =
            cancellation.Cancel()
            // Connecting once wakes a blocking WaitForConnection so the loop
            // can observe cancellation. The connection is local and carries no
            // request data.
            try
                use wake = new NamedPipeClientStream(".", pipeName, PipeDirection.Out)
                wake.Connect(100)
            with _ -> ()
            if not (isNull task) then
                try task.Wait(1000) |> ignore with _ -> ()
            cancellation.Dispose()

    let pipeArgument (argv: string array) =
        argv
        |> Array.tryPick(fun arg ->
            let prefix = "--windowtabs-ipc-pipe="
            if arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) then
                Some(arg.Substring(prefix.Length))
            else None)

    let start (argv: string array) (coreVersion: string) =
        match pipeArgument argv with
        | None -> None
        | Some pipe ->
            let server = Server(pipe, coreVersion, fun message -> Debug.WriteLine(message))
            server.Start()
            Some server
