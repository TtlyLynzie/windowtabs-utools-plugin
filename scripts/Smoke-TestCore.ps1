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

  $id = 1
  $writer.WriteLine((@{ id = $id; version = 1; method = 'hello'; params = @{} } | ConvertTo-Json -Compress))
  $hello = Read-IpcResponse
  $helloProtocol = if ($null -ne $hello.result) { $hello.result.protocolVersion } else { $hello.protocolVersion }
  if ($hello.ok -ne $true -or [int]$helloProtocol -ne 1) {
    throw ("IPC hello smoke test failed: " + ($hello | ConvertTo-Json -Compress -Depth 10))
  }

  # The handshake proves the patched core is reachable. Shutdown is best-effort
  # because upstream shutdown may close the pipe before writing its acknowledgement.
  $id++
  $writer.WriteLine((@{ id = $id; version = 1; method = 'shutdown'; params = @{} } | ConvertTo-Json -Compress))
  Start-Sleep -Milliseconds 250
  Write-Host "IPC smoke test passed for $Executable"
}
finally {
  if ($writer) { $writer.Dispose() }
  if ($reader) { $reader.Dispose() }
  if ($client) { $client.Dispose() }
  if ($process -and -not $process.HasExited) { $process.Kill(); $process.WaitForExit(5000) }
  if ($process) { $process.Dispose() }
}
