# WindowTabs core source and build record

The helper in this plugin is a modified build of the MIT-licensed
`standard-software/WindowTabs` project. It is not the unmodified upstream
release executable: the build adds a versioned named-pipe IPC server and the
`integrated-settings-v1` contract used by the uTools plugin.

The exact source commit, upstream release asset digest, patch digest, schema
digest, executable digest, and runtime proof are recorded in
`audit/source-manifest.json`. The complete patch is included at
`audit/patches/upstream-integrated-v12.txt` in the audit package.

## Rebuild procedure

1. Clone the upstream repository at the exact `sourceCommit` recorded in
   `audit/source-manifest.json`.
2. Verify the downloaded upstream release asset against
   `upstreamReleaseSha256` in that manifest.
3. Apply the recorded patch with `git apply --check` first, then `git apply`.
4. Restore the pinned NuGet packages from `WtProgram/packages.config`.
5. Build `WtProgram/WtProgram.fsproj` with Visual Studio MSBuild, Release and
   AnyCPU configuration.
6. Run the Windows IPC smoke test and the integrated settings contract test.
7. Compare the resulting `WindowTabs.exe` and `settings-schema.json` hashes
   with the manifest before packaging.

The GitHub Actions workflow `.github/workflows/build-plugin.yml` performs this
sequence on `windows-latest`. A market package is accepted only when the
runtime proof belongs to the same executable and schema hashes recorded in
`helper/current.json`.

The same workflow uploads a separate source audit artifact containing the
pinned upstream source tree after the patch, the patch file, license, schema,
`current.json`, and the generated source manifest. Submit that audit artifact
alongside the uTools market package so the bundled executable can be reviewed
against the exact source and build record.

## Contract scope

The plugin exposes a fixed whitelist of methods. Read-only methods return the
current settings, applications, workspaces, or storage information. Mutating
methods are limited to settings changes with before-value conflict checks,
application and window rules, custom themes, workspace capture/update/restore,
enable/disable state, and storage location transfer. The preload and native
IPC layers both validate method parameters, field names, sizes, and ranges.
