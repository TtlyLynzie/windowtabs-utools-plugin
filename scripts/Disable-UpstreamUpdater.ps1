$ErrorActionPreference = 'Stop'
$path = Join-Path $env:GITHUB_WORKSPACE 'WindowTabs-source\WtProgram\DesktopPlugins\NotifyIconPlugin.fs'
$source = Get-Content $path -Raw
$source = [regex]::Replace($source, '(?s)// Auto-update:.*?(?=type NotifyIconPlugin\(\))', '')
$source = [regex]::Replace($source, '(?s)    // Check the latest GitHub release.*?(?=    // Restart application using normal shutdown)', '')
$source = [regex]::Replace($source, '(?s)            let updateMenuItem = new MenuItem\(Localization\.getString\("CheckForUpdates"\)\).*?            this\.contextMenuItems\.Add\(updateMenuItem\) |> ignore\r?\n', '')
foreach ($forbidden in @('WebClient', 'AsyncDownloadString', 'AsyncDownloadFile', 'api.github.com/repos/standard-software/WindowTabs/releases/latest', 'windowtabs.uservoice.com', 'this.checkForUpdates()', 'this.startUpdate')) {
    if ($source.Contains($forbidden)) { throw "Updater code remains in patched source: $forbidden" }
}
Set-Content -Path $path -Value $source -Encoding utf8
Write-Host 'Removed tray updater, network check and download/install implementation.'
