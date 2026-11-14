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
Copy-Item (Join-Path $root 'SOURCE-BUILD.md') (Join-Path $bundle 'SOURCE-BUILD.md') -Force
Copy-Item (Join-Path $root 'THIRD-PARTY-NOTICES.md') (Join-Path $bundle 'THIRD-PARTY-NOTICES.md') -Force
Copy-Item (Join-Path $root 'LICENSES\WindowTabs-MIT.txt') (Join-Path $bundle 'WindowTabs-MIT.txt') -Force
Copy-Item (Join-Path $root 'dist\market\audit\source-manifest.json') (Join-Path $bundle 'source-manifest.json') -Force
Copy-Item (Join-Path $root 'helper\current.json') (Join-Path $bundle 'current.json') -Force
Copy-Item (Join-Path $root 'settings-schema.json') (Join-Path $bundle 'settings-schema.json') -Force
Write-Host "Audit bundle ready: $bundle"
