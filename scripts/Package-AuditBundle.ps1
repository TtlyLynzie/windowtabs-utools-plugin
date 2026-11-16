$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$bundle = Join-Path $root 'audit-bundle'
if (Test-Path $bundle) { Remove-Item $bundle -Recurse -Force }
New-Item -ItemType Directory -Force -Path $bundle | Out-Null
Copy-Item (Join-Path $root 'WindowTabs-source') (Join-Path $bundle 'upstream-source') -Recurse -Force
foreach ($excluded in @('.git', 'packages', 'bin', 'obj')) {
    Get-ChildItem (Join-Path $bundle 'upstream-source') -Recurse -Force -Directory -Filter $excluded |
        Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $bundle 'patches') | Out-Null
$manifest = Get-Content (Join-Path $root 'build\core-manifest.json') -Raw | ConvertFrom-Json
Copy-Item (Join-Path $root $manifest.patch) (Join-Path $bundle 'patches') -Force
Copy-Item (Join-Path $root 'patches\upstream-disable-runtime-updater-v1.patch') (Join-Path $bundle 'patches') -Force
Copy-Item (Join-Path $root 'SOURCE-BUILD.md') (Join-Path $bundle 'SOURCE-BUILD.md') -Force
Copy-Item (Join-Path $root 'THIRD-PARTY-NOTICES.md') (Join-Path $bundle 'THIRD-PARTY-NOTICES.md') -Force
Copy-Item (Join-Path $root 'LICENSES\WindowTabs-MIT.txt') (Join-Path $bundle 'WindowTabs-MIT.txt') -Force
Copy-Item (Join-Path $root 'helper\current.json') (Join-Path $bundle 'current.json') -Force
Copy-Item (Join-Path $root 'settings-schema.json') (Join-Path $bundle 'settings-schema.json') -Force
node (Join-Path $root 'scripts\generate-source-hashes.mjs') (Join-Path $bundle 'upstream-source') (Join-Path $bundle 'source-file-hashes.json')
if (-not (Test-Path (Join-Path $root 'build-record.json'))) { throw 'build-record.json is required for audit bundle' }
Copy-Item (Join-Path $root 'build-record.json') (Join-Path $bundle 'build-record.json') -Force
$patchHash = (Get-FileHash (Join-Path $root $manifest.patch) -Algorithm SHA256).Hash.ToLowerInvariant()
$exeHash = (Get-Content (Join-Path $root 'helper\current.json') -Raw | ConvertFrom-Json).sha256
[ordered]@{
    pluginVersion = (Get-Content (Join-Path $root 'plugin.json') -Raw | ConvertFrom-Json).version
    upstream = @{ releaseTag = $manifest.coreTag; releaseAsset = $manifest.upstreamReleaseAsset; upstreamReleaseSha256 = $manifest.upstreamReleaseSha256 }
    patches = @(@{ file = "patches/$([IO.Path]::GetFileName($manifest.patch))"; sha256 = $patchHash }, @{ file = 'patches/upstream-disable-runtime-updater-v1.patch'; sha256 = (Get-FileHash (Join-Path $root 'patches\upstream-disable-runtime-updater-v1.patch') -Algorithm SHA256).Hash.ToLowerInvariant() })
    executableSha256 = $exeHash
    buildRecord = 'build-record.json'
    sourceFileHashes = 'source-file-hashes.json'
    runtimeUpdatePolicy = 'disabled-runtime-download'
} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $bundle 'source-manifest.json') -Encoding UTF8
Write-Host "Audit bundle ready: $bundle"
