param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,
    [string]$PluginRoot = (Split-Path -Parent $PSScriptRoot),
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'

$sourceRoot = (Resolve-Path $SourceRoot).Path
$pluginRoot = (Resolve-Path $PluginRoot).Path
$project = Join-Path $sourceRoot 'WtProgram\WtProgram.fsproj'
$programFs = Join-Path $sourceRoot 'WtProgram\Program.fs'

if (-not (Test-Path $project)) { throw "WtProgram.fsproj not found: $project" }
if (-not (Test-Path $programFs)) { throw "Program.fs not found: $programFs" }

$versionMatch = Select-String -Path $programFs -Pattern 'let version = "([^"]+)"' | Select-Object -First 1
if (-not $versionMatch) { throw 'Could not read the WindowTabs version from Program.fs.' }
$version = $versionMatch.Matches[0].Groups[1].Value

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw "vswhere.exe not found: $vswhere" }
$msbuild = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($msbuild)) { throw 'MSBuild was not found.' }

Write-Host "Building WindowTabs $version ($Configuration)"
& $msbuild $project /t:Rebuild /p:Configuration=$Configuration /p:Platform=AnyCPU /v:minimal
if ($LASTEXITCODE -ne 0) { throw "MSBuild failed with exit code $LASTEXITCODE" }

$buildDir = Join-Path $sourceRoot "WtProgram\bin\$Configuration"
$exe = Join-Path $buildDir 'WindowTabs.exe'
if (-not (Test-Path $exe)) { throw "Built WindowTabs.exe not found: $exe" }

$coreManifest = Get-Content (Join-Path $pluginRoot 'build\core-manifest.json') -Raw | ConvertFrom-Json
$targetName = "$version-$($coreManifest.patchId)"
$target = Join-Path $pluginRoot "helper\$targetName"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item $exe (Join-Path $target 'WindowTabs.exe') -Force
foreach ($file in @('WindowTabs.exe.config', 'version.md', 'README.txt')) {
    $source = if ($file -eq 'version.md') { Join-Path $sourceRoot $file } elseif ($file -eq 'README.txt') { Join-Path $sourceRoot 'WtSetup\README.txt' } else { Join-Path $buildDir $file }
    if (Test-Path $source) { Copy-Item $source (Join-Path $target $file) -Force }
}
if (Test-Path (Join-Path $buildDir 'Settings')) {
    Copy-Item (Join-Path $buildDir 'Settings') $target -Recurse -Force
}

$hash = (Get-FileHash (Join-Path $target 'WindowTabs.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    version = $version
    buildId = "$version-$($coreManifest.patchId)"
    sourceTag = $version
    path = "$targetName/WindowTabs.exe"
    protocol = 1
    ipc = $true
    supportsIpc = $true
    patchId = $coreManifest.patchId
    contractVersion = $coreManifest.contractVersion
    capabilities = $coreManifest.requiredCapabilities
    schemaSha256 = (Get-FileHash (Join-Path $pluginRoot 'settings-schema.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    source = 'local patched build'
    sha256 = $hash
}
$manifest | ConvertTo-Json | Set-Content (Join-Path $pluginRoot 'helper\current.json') -Encoding UTF8
Write-Host "Installed $version into $target"
Write-Host "SHA-256: $hash"
