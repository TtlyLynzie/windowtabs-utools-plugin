param(
  [Parameter(Mandatory = $true)]
  [string] $Executable,
  [int] $TimeoutSeconds = 20
)

$ErrorActionPreference = 'Stop'
$pipeName = "windowtabs-smoke-$([Guid]::NewGuid().ToString('N'))"
$process = $null
$client = $null
$reader = $null
$writer = $null
$settingsDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("windowtabs-core-smoke-" + [Guid]::NewGuid().ToString('N'))
$settingsPath = Join-Path $settingsDirectory 'WindowTabsSettings.json'

try {
  Write-Host "Starting IPC smoke-test core: $Executable"
  New-Item -ItemType Directory -Force -Path $settingsDirectory | Out-Null
  $arguments = @("--windowtabs-ipc-pipe=\\.\pipe\$pipeName", "--windowtabs-settings=$settingsPath")
  $process = Start-Process -FilePath $Executable -ArgumentList $arguments -PassThru
  Write-Host "Connecting to named pipe: $pipeName"
  $client = New-Object System.IO.Pipes.NamedPipeClientStream('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
  $client.Connect($TimeoutSeconds * 1000)
  Write-Host 'Named pipe connected.'
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $reader = New-Object System.IO.StreamReader($client, $utf8, $false, 65536, $true)
  $writer = New-Object System.IO.StreamWriter($client, $utf8, 65536, $true)
  $writer.AutoFlush = $true

  function Read-IpcResponse {
    $read = $reader.ReadLineAsync()
    if (-not $read.Wait($TimeoutSeconds * 1000)) {
      throw "IPC core did not respond within $TimeoutSeconds seconds."
    }
    $line = $read.Result
    if ([string]::IsNullOrWhiteSpace($line)) { throw 'IPC core closed the pipe without a response.' }
    try { return ($line | ConvertFrom-Json) }
    catch { throw "IPC core returned invalid JSON: $line" }
  }

  $id = 'req-smoke-hello-1'
  Write-Host 'Sending IPC hello request.'
  $writer.WriteLine((@{ id = $id; version = 1; method = 'hello'; params = @{} } | ConvertTo-Json -Compress))
  $writer.Flush()
  $hello = Read-IpcResponse
  if ($hello.id -isnot [string] -or $hello.id -cne $id) { throw 'hello response ID must equal the original string ID.' }
  $helloProtocol = if ($null -ne $hello.result) { $hello.result.protocolVersion } else { $hello.protocolVersion }
  if ($hello.ok -ne $true -or [int]$helloProtocol -ne 1) {
    throw ("IPC hello smoke test failed: " + ($hello | ConvertTo-Json -Compress -Depth 10))
  }
  Write-Host 'IPC hello response validated.'

  $id = 'req-smoke-status-2-"quoted"-\path'
  Write-Host 'Sending IPC status request.'
  $writer.WriteLine((@{ id = $id; version = 1; method = 'status'; params = @{} } | ConvertTo-Json -Compress))
  $writer.Flush()
  $status = Read-IpcResponse
  if ($status.id -isnot [string] -or $status.id -cne $id) { throw 'status response ID must preserve quotes and backslashes.' }
  $statusRunning = if ($null -ne $status.result) { $status.result.running } else { $status.running }
  if ($status.ok -ne $true -or $statusRunning -ne $true) {
    throw ("IPC status smoke test failed: " + ($status | ConvertTo-Json -Compress -Depth 10))
  }
  Write-Host 'IPC status response validated.'
  $writer.WriteLine((@{ id = 3; version = 1; method = 'hello'; params = @{} } | ConvertTo-Json -Compress))
  $writer.Flush()
  $numeric = Read-IpcResponse
  if ($numeric.id -is [string] -or $numeric.id -ne 3 -or $numeric.ok -ne $true) { throw 'Numeric response ID must retain its type and value.' }
  Write-Host "IPC smoke test passed for $Executable"
}
finally {
  # Kill the GUI process before releasing pipe objects. StreamWriter.Dispose()
  # may flush synchronously and can hang forever if the native peer is already
  # shutting down, so CI deliberately lets process teardown close these handles.
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit(5000) | Out-Null
  }
  if ($process) { $process.Dispose() }
  if (Test-Path $settingsDirectory) { Remove-Item $settingsDirectory -Recurse -Force -ErrorAction SilentlyContinue }
}

$parentTestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("windowtabs-parent-exit-" + [Guid]::NewGuid().ToString('N'))
$pluginHelperDirectory = Join-Path $parentTestRoot 'uTools\local-data\plugins\test-plugin\helper'
$parentSettingsPath = Join-Path $parentTestRoot 'WindowTabsSettings.json'
$parentPidProcess = $null
$parentCore = $null
$parentPipe = $null
$parentReader = $null
$parentWriter = $null
try {
  New-Item -ItemType Directory -Force -Path $pluginHelperDirectory | Out-Null
  $markerPath = Join-Path $pluginHelperDirectory 'must-remain.txt'
  Set-Content -Path $markerPath -Value 'helper files remain after plugin process exit' -NoNewline

  $parentPidProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 30') -PassThru -WindowStyle Hidden
  $parentPipeName = "windowtabs-parent-exit-$([Guid]::NewGuid().ToString('N'))"
  $parentPipeAddress = "\\.\pipe\$parentPipeName"
  $parentArguments = @(
    "--windowtabs-ipc-pipe=$parentPipeAddress",
    "--windowtabs-settings=$parentSettingsPath",
    "--windowtabs-parent-pid=$($parentPidProcess.Id)",
    "--windowtabs-cleanup-path=$pluginHelperDirectory"
  )
  $parentCore = Start-Process -FilePath $Executable -ArgumentList $parentArguments -PassThru -WindowStyle Hidden
  $parentPipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $parentPipeName, [System.IO.Pipes.PipeDirection]::InOut)
  $parentPipe.Connect($TimeoutSeconds * 1000)
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $parentReader = New-Object System.IO.StreamReader($parentPipe, $utf8, $false, 65536, $true)
  $parentWriter = New-Object System.IO.StreamWriter($parentPipe, $utf8, 65536, $true)
  $parentWriter.AutoFlush = $true
  $parentWriter.WriteLine((@{ id = 'parent-exit-ready'; version = 1; method = 'hello'; params = @{} } | ConvertTo-Json -Compress))
  $parentResponse = $parentReader.ReadLineAsync()
  if (-not $parentResponse.Wait($TimeoutSeconds * 1000)) { throw 'Parent-exit test core did not complete its IPC handshake.' }
  if (-not $parentCore.HasExited) { Stop-Process -Id $parentPidProcess.Id -Force }
  if (-not $parentCore.WaitForExit($TimeoutSeconds * 1000)) {
    throw 'WindowTabs did not exit after its uTools parent process ended.'
  }
  if (-not (Test-Path $markerPath)) {
    throw 'Helper files were removed when the uTools parent process ended.'
  }
  Write-Host 'Parent-exit test passed: core exited and plugin helper files remained.'
}
finally {
  if ($parentCore -and -not $parentCore.HasExited) {
    Stop-Process -Id $parentCore.Id -Force -ErrorAction SilentlyContinue
    $parentCore.WaitForExit(5000) | Out-Null
  }
  if ($parentPidProcess -and -not $parentPidProcess.HasExited) {
    Stop-Process -Id $parentPidProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if ($parentReader) { try { $parentReader.Dispose() } catch {} }
  if ($parentWriter) { try { $parentWriter.Dispose() } catch {} }
  if ($parentPipe) { try { $parentPipe.Dispose() } catch {} }
  if (Test-Path $parentTestRoot) { Remove-Item $parentTestRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
