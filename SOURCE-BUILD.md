# WindowTabs core source and build record

The helper in this plugin is a modified build of the MIT-licensed
`standard-software/WindowTabs` project. It is not the unmodified upstream
release executable: the build adds a versioned named-pipe IPC server and the
`integrated-settings-v1` contract used by the uTools plugin.

The exact source commit, upstream release asset digest, patch digests, schema
digest, executable digest, per-file source hashes, per-file build-output
hashes, per-file distribution-helper hashes, MSBuild version, build arguments,
and runtime proof are recorded in the separate audit artifact. The complete
patched source tree and the complete `WtProgram/bin/Release` output tree are
included there.

## Rebuild procedure

1. Clone the upstream repository at the exact `sourceCommit` recorded in the
   audit artifact's `source-manifest.json`.
2. Verify the downloaded upstream release asset against
   `upstreamReleaseSha256` in that manifest.
3. Apply the recorded patch with `git apply --check` first, then `git apply`.
4. Apply `patches/upstream-disable-runtime-updater-v1.patch` with `git apply`.
   This exact audited patch removes the update checker, update menu action,
   WebClient download/install paths, replacement-executable launch paths, and
   external feedback URL. No script performs unrecorded source rewrites.
5. Restore the pinned NuGet packages from `WtProgram/packages.config`.
6. Build `WtProgram/WtProgram.fsproj` with Visual Studio MSBuild, Release and
   AnyCPU configuration. The exact MSBuild path/version and arguments are
   recorded in `build-record.json`.
7. Run the Windows IPC smoke test and the integrated settings contract test.
8. Compare every file in `WtProgram/bin/Release` with
   `build-output-file-hashes.json`, and every distributed helper file with
   `distribution-helper-file-hashes.json`. The executable and schema hashes
   must also match `current.json` and `source-manifest.json`.

The GitHub Actions workflow `.github/workflows/build-plugin.yml` performs this
sequence on `windows-latest`. A market package is accepted only when the
runtime proof belongs to the same executable and schema hashes recorded in
`helper/current.json`.

The same workflow validates and uploads a separate source audit artifact
containing the complete pinned source tree after all patches, complete build
output tree, both per-file SHA-256 inventories, patch files, license, schema,
`current.json`, `build-record.json`, and the generated source manifest. Submit
that audit artifact alongside the uTools market package.

## Contract scope

The plugin exposes a fixed whitelist of methods. Read-only methods return the
current settings, applications, workspaces, or storage information. Mutating
methods are limited to settings changes with before-value conflict checks,
application and window rules, custom themes, workspace capture/update/restore,
enable/disable state, and storage location transfer. The preload and native
IPC layers both validate method parameters, field names, sizes, and ranges.
