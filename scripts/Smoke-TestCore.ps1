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

try {
  $process = Start-Process -FilePath $Executable -ArgumentList "--windowtabs-ipc-pipe=\\.\pipe\$pipeName" -PassThru
  $client = New-Object System.IO.Pipes.NamedPipeClientStream('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
  $client.Connect($TimeoutSeconds * 1000)
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $reader = New-Object System.IO.StreamReader($client, $utf8, $false, 65536, $true)
  $writer = New-Object System.IO.StreamWriter($client, $utf8, 65536, $true)
  $writer.AutoFlush = $true | Out-Null

  function Read-IpcResponse {
    $line = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($line)) { throw 'IPC core closed the pipe without a response.' }
    try { return ($line | ConvertFrom-Json) }
    catch { throw "IPC core returned invalid JSON: $line" }
  }

  function Get-ResultValue($response, [string] $name) {
    if ($null -ne $response.result -and $null -ne $response.result.$name) {
      return $response.result.$name
    }
    return $response.$name
  }

  $id = 1
  $writer.WriteLine((@{ id = $id; version = 1; method = 'hello'; params = @{} } | ConvertTo-Json -Compress))
  $hello = Read-IpcResponse
  $helloProtocol = Get-ResultValue $hello 'protocolVersion'
  if ($hello.ok -ne $true -or [int]$helloProtocol -ne 1) {
    throw ("IPC hello smoke test failed: " + ($hello | ConvertTo-Json -Compress -Depth 10))
  }

  $id++
  $writer.WriteLine((@{ id = $id; version = 1; method = 'status'; params = @{} } | ConvertTo-Json -Compress))
  $status = Read-IpcResponse
  $statusRunning = Get-ResultValue $status 'running'
  if ($status.ok -ne $true -or $statusRunning -ne $true) {
    throw ("IPC status smoke test failed: " + ($status | ConvertTo-Json -Compress -Depth 10))
  }

  $id++
  $writer.WriteLine((@{ id = $id; version = 1; method = 'shutdown'; params = @{} } | ConvertTo-Json -Compress))
  $shutdown = Read-IpcResponse
  if ($shutdown.ok -ne $true) {
    throw ("IPC shutdown smoke test failed: " + ($shutdown | ConvertTo-Json -Compress -Depth 10))
  }
  if (-not $process.WaitForExit(10000)) { throw 'WindowTabs did not exit after IPC shutdown.' }
  Write-Host "IPC smoke test passed for $Executable"
}
finally {
  if ($writer) { $writer.Dispose() }
  if ($reader) { $reader.Dispose() }
  if ($client) { $client.Dispose() }
  if ($process -and -not $process.HasExited) { $process.Kill(); $process.WaitForExit(5000) }
  if ($process) { $process.Dispose() }
}
