$ErrorActionPreference = 'Stop'
$manifest = Get-Content (Join-Path $env:GITHUB_WORKSPACE 'build\core-manifest.json') -Raw | ConvertFrom-Json
$sourceRoot = Join-Path $env:GITHUB_WORKSPACE 'WindowTabs-source'
$patch = Join-Path $env:GITHUB_WORKSPACE $manifest.updaterPatch
if (-not (Test-Path $patch)) { throw "Updater-disable patch was not found: $patch" }
git -C $sourceRoot apply --check $patch
if ($LASTEXITCODE -ne 0) { throw "Updater-disable patch check failed: $LASTEXITCODE" }
git -C $sourceRoot apply $patch
if ($LASTEXITCODE -ne 0) { throw "Updater-disable patch failed: $LASTEXITCODE" }

$forbidden = @(
    'WebClient',
    'AsyncDownloadString',
    'AsyncDownloadFile',
    'api.github.com/repos/standard-software/WindowTabs/releases/latest',
    'windowtabs.uservoice.com',
    'this.checkForUpdates()',
    'this.startUpdate',
    'UpdateChecker'
)
$sources = Get-ChildItem $sourceRoot -Recurse -File -Include *.fs,*.cs
foreach ($token in $forbidden) {
    if ($sources | Select-String -SimpleMatch $token -Quiet) {
        throw "Runtime network updater token remains in patched source: $token"
    }
}
Write-Host 'Applied audited updater-disable patch; runtime checks, downloads, execution and feedback URL are absent.'
