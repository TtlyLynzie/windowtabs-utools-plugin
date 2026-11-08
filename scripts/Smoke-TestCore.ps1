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
  $writer.AutoFlush = $true

  $id = 1
  $writer.WriteLine((@{ id = $id; version = 1; method = 'hello'; params = @{} } | ConvertTo-Json -Compress))
  $hello = $reader.ReadLine() | ConvertFrom-Json
  if ($hello.ok -ne $true -or $hello.result.protocolVersion -ne 1) { throw 'IPC hello smoke test failed.' }

  $id++
  $writer.WriteLine((@{ id = $id; version = 1; method = 'status'; params = @{} } | ConvertTo-Json -Compress))
  $status = $reader.ReadLine() | ConvertFrom-Json
  if ($status.ok -ne $true -or $status.result.running -ne $true) { throw 'IPC status smoke test failed.' }

  $id++
  $writer.WriteLine((@{ id = $id; version = 1; method = 'shutdown'; params = @{} } | ConvertTo-Json -Compress))
  $shutdown = $reader.ReadLine() | ConvertFrom-Json
  if ($shutdown.ok -ne $true) { throw 'IPC shutdown smoke test failed.' }
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
