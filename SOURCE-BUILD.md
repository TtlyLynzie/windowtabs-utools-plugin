# WindowTabs core source and build record

The helper in this plugin is a modified build of the MIT-licensed
`standard-software/WindowTabs` project. It is not the unmodified upstream
release executable: the build adds a versioned named-pipe IPC server and the
`integrated-settings-v1` contract used by the uTools plugin.

The exact source commit, upstream release asset digest, patch digests, schema
digest, executable digest, per-file source hashes, MSBuild version, build
arguments, and runtime proof are recorded in the audit artifact's
`source-manifest.json`. The complete patched source tree is included there.

## Rebuild procedure

1. Clone the upstream repository at the exact `sourceCommit` recorded in
   `audit/source-manifest.json`.
2. Verify the downloaded upstream release asset against
   `upstreamReleaseSha256` in that manifest.
3. Apply the recorded patch with `git apply --check` first, then `git apply`.
4. Apply the updater-disable patch, which removes the update menu action and
   all WebClient download/install paths.
5. Restore the pinned NuGet packages from `WtProgram/packages.config`.
6. Build `WtProgram/WtProgram.fsproj` with Visual Studio MSBuild, Release and
   AnyCPU configuration. The exact MSBuild path/version and arguments are
   recorded in `build-record.json`.
7. Run the Windows IPC smoke test and the integrated settings contract test.
8. Compare the resulting `WindowTabs.exe` and `settings-schema.json` hashes
   with the manifest before packaging.

The GitHub Actions workflow `.github/workflows/build-plugin.yml` performs this
sequence on `windows-latest`. A market package is accepted only when the
runtime proof belongs to the same executable and schema hashes recorded in
`helper/current.json`.

The same workflow uploads a separate source audit artifact containing the
complete pinned source tree after all patches, per-file SHA-256 hashes, patch
files, license, schema, `current.json`, `build-record.json`, and the generated
source manifest. Submit that audit artifact alongside the uTools market
package.

## Contract scope

The plugin exposes a fixed whitelist of methods. Read-only methods return the
current settings, applications, workspaces, or storage information. Mutating
methods are limited to settings changes with before-value conflict checks,
application and window rules, custom themes, workspace capture/update/restore,
enable/disable state, and storage location transfer. The preload and native
IPC layers both validate method parameters, field names, sizes, and ranges.
