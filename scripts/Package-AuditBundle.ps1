$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$bundle = Join-Path $root 'audit-bundle'
$buildOutput = Join-Path $root 'WindowTabs-source\WtProgram\bin\Release'
if (-not (Test-Path $buildOutput)) { throw "Build output was not found: $buildOutput" }
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
Copy-Item (Join-Path $root $manifest.updaterPatch) (Join-Path $bundle 'patches') -Force
Copy-Item (Join-Path $root 'SOURCE-BUILD.md') (Join-Path $bundle 'SOURCE-BUILD.md') -Force
Copy-Item (Join-Path $root 'THIRD-PARTY-NOTICES.md') (Join-Path $bundle 'THIRD-PARTY-NOTICES.md') -Force
Copy-Item (Join-Path $root 'LICENSES\WindowTabs-MIT.txt') (Join-Path $bundle 'WindowTabs-MIT.txt') -Force
Copy-Item (Join-Path $root 'helper\current.json') (Join-Path $bundle 'current.json') -Force
Copy-Item (Join-Path $root 'settings-schema.json') (Join-Path $bundle 'settings-schema.json') -Force
node (Join-Path $root 'scripts\generate-source-hashes.mjs') (Join-Path $bundle 'upstream-source') (Join-Path $bundle 'source-file-hashes.json')
if (-not (Test-Path (Join-Path $root 'build-record.json'))) { throw 'build-record.json is required for audit bundle' }
Copy-Item (Join-Path $root 'build-record.json') (Join-Path $bundle 'build-record.json') -Force

Copy-Item $buildOutput (Join-Path $bundle 'build-output') -Recurse -Force
node (Join-Path $root 'scripts\generate-file-hashes.mjs') (Join-Path $bundle 'build-output') (Join-Path $bundle 'build-output-file-hashes.json') 'build-output'

$current = Get-Content (Join-Path $root 'helper\current.json') -Raw | ConvertFrom-Json
$helperDirectory = Split-Path $current.path -Parent
$distributionHelper = Join-Path $root (Join-Path 'helper' $helperDirectory)
if (-not (Test-Path $distributionHelper)) { throw "Distribution helper directory was not found: $distributionHelper" }
node (Join-Path $root 'scripts\generate-file-hashes.mjs') $distributionHelper (Join-Path $bundle 'distribution-helper-file-hashes.json') "helper/$($helperDirectory.Replace('\', '/'))"

node (Join-Path $root 'scripts\generate-audit-manifest.mjs') $root (Join-Path $bundle 'source-manifest.json')
Write-Host "Audit bundle ready: $bundle"
