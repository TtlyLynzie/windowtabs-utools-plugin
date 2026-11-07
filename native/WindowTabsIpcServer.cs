// Reference implementation for the WindowTabs .NET Framework 4.7.2 core.
// Add this file to the native WindowTabs project and route Dispatch to the
// existing Program/Settings services. It requires Newtonsoft.Json, which is
// already used by the upstream project.

using System;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace WindowTabs.Ipc
{
    public sealed class WindowTabsIpcServer : IDisposable
    {
        private readonly string pipeName;
        private readonly Func<JObject, JObject> dispatch;
        private readonly Action<string> log;
        private readonly CancellationTokenSource cancellation = new CancellationTokenSource();
        private Task acceptTask;

        public WindowTabsIpcServer(
            string requestedPipeName,
            Func<JObject, JObject> dispatch,
            Action<string> log = null)
        {
            if (dispatch == null) throw new ArgumentNullException("dispatch");
            this.pipeName = NormalizePipeName(requestedPipeName);
            this.dispatch = dispatch;
            this.log = log ?? (_ => { });
        }

        public void Start()
        {
            if (acceptTask != null) return;
            acceptTask = Task.Run(AcceptLoop);
        }

        private async Task AcceptLoop()
        {
            while (!cancellation.IsCancellationRequested)
            {
                NamedPipeServerStream server = null;
                try
                {
                    server = new NamedPipeServerStream(
                        pipeName,
                        PipeDirection.InOut,
                        1,
                        PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous,
                        4096,
                        4096,
                        BuildPipeSecurity());

                    await server.WaitForConnectionAsync(cancellation.Token).ConfigureAwait(false);
                    _ = Task.Run(() => ServeClient(server), cancellation.Token);
                }
                catch (OperationCanceledException)
                {
                    server?.Dispose();
                    break;
                }
                catch (Exception error)
                {
                    server?.Dispose();
                    log("IPC accept failed: " + error);
                    if (!cancellation.IsCancellationRequested)
                        await Task.Delay(250, cancellation.Token).ConfigureAwait(false);
                }
            }
        }

        private void ServeClient(NamedPipeServerStream server)
        {
            using (server)
            using (var reader = new StreamReader(server, Encoding.UTF8, false, 4096, true))
            using (var writer = new StreamWriter(server, new UTF8Encoding(false), 4096, true)
            {
                AutoFlush = true,
                NewLine = "\n"
            })
            {
                try
                {
                    string line;
                    while (!cancellation.IsCancellationRequested && (line = reader.ReadLine()) != null)
                    {
                        if (String.IsNullOrWhiteSpace(line)) continue;
                        writer.WriteLine(Handle(line));
                    }
                }
                catch (IOException)
                {
                    // The uTools client may close the pipe while the helper is stopping.
                }
                catch (Exception error)
                {
                    log("IPC client failed: " + error);
                }
            }
        }

        private string Handle(string line)
        {
            JObject request;
            string id = null;
            try
            {
                request = JObject.Parse(line);
                id = (string)request["id"];
                var version = (int?)request["version"] ?? 0;
                if (version != 1)
                    return Error(id, "PROTOCOL_MISMATCH", "Unsupported IPC protocol version");

                var result = dispatch(request) ?? new JObject();
                return new JObject
                {
                    ["id"] = id,
                    ["ok"] = true,
                    ["result"] = result
                }.ToString(Formatting.None);
            }
            catch (ArgumentException error)
            {
                return Error(id, "INVALID_REQUEST", error.Message);
            }
            catch (JsonException error)
            {
                return Error(id, "INVALID_REQUEST", error.Message);
            }
            catch (Exception error)
            {
                log("IPC dispatch failed: " + error);
                return Error(id, "CORE_ERROR", "WindowTabs core failed to process the request");
            }
        }

        private static string Error(string id, string code, string message)
        {
            return new JObject
            {
                ["id"] = id,
                ["ok"] = false,
                ["error"] = new JObject
                {
                    ["code"] = code,
                    ["message"] = message
                }
            }.ToString(Formatting.None);
        }

        private static PipeSecurity BuildPipeSecurity()
        {
            var security = new PipeSecurity();
            var currentUser = WindowsIdentity.GetCurrent().User;
            security.AddAccessRule(new PipeAccessRule(
                currentUser,
                PipeAccessRights.ReadWrite,
                AccessControlType.Allow));
            return security;
        }

        private static string NormalizePipeName(string requested)
        {
            if (String.IsNullOrWhiteSpace(requested))
                throw new ArgumentException("Pipe name is required", "requested");

            const string prefix = @"\\.\pipe\";
            return requested.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                ? requested.Substring(prefix.Length)
                : requested;
        }

        public void Dispose()
        {
            cancellation.Cancel();
            try { acceptTask?.Wait(1000); } catch { }
            cancellation.Dispose();
        }
    }
}
