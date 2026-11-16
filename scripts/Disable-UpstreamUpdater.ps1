$ErrorActionPreference = 'Stop'
$path = Join-Path $env:GITHUB_WORKSPACE 'WindowTabs-source\WtProgram\DesktopPlugins\NotifyIconPlugin.fs'
$source = Get-Content $path -Raw
$sections = @(
    @{
        Start = '// Auto-update: checks the GitHub releases of this repository and installs a'
        End = 'type NotifyIconPlugin() as this ='
        Replacement = ''
        Name = 'UpdateChecker module'
    },
    @{
        Start = '    // Check the latest GitHub release and report the result.'
        End = '    // Restart application using normal shutdown'
        Replacement = ''
        Name = 'tray updater methods'
    },
    @{
        Start = '            let updateMenuItem = new MenuItem(Localization.getString("CheckForUpdates"))'
        End = '            // Both ask first:'
        Replacement = ''
        Name = 'tray updater menu item'
    }
)

foreach ($section in $sections) {
    $startMatches = [regex]::Matches($source, [regex]::Escape($section.Start))
    $endMatches = [regex]::Matches($source, [regex]::Escape($section.End))
    if ($startMatches.Count -ne 1 -or $endMatches.Count -ne 1 -or $startMatches[0].Index -ge $endMatches[0].Index) {
        throw "Expected one ordered start/end marker for $($section.Name)."
    }
    $start = $startMatches[0].Index
    $end = $endMatches[0].Index
    $source = $source.Substring(0, $start) + $section.Replacement + $source.Substring($end)
}

foreach ($forbidden in @('WebClient', 'AsyncDownloadString', 'AsyncDownloadFile', 'api.github.com/repos/standard-software/WindowTabs/releases/latest', 'windowtabs.uservoice.com', 'this.checkForUpdates()', 'this.startUpdate')) {
    if ($source.Contains($forbidden)) { throw "Updater code remains in patched source: $forbidden" }
}
Set-Content -Path $path -Value $source -Encoding utf8
Write-Host 'Removed tray updater, network check and download/install implementation.'
