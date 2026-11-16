import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] || new URL('..', import.meta.url).pathname);
const readJson = name => JSON.parse(readFileSync(resolve(root, name), 'utf8').replace(/^\uFEFF/, ''));
const hash = name => createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex');
const core = readJson('helper/current.json');
const plugin = readJson('plugin.json');
const build = readJson('build/core-manifest.json');
const buildRecord = readJson('build-record.json');
const patchPaths = [build.patch, build.updaterPatch];
const manifest = {
  formatVersion: 2,
  pluginVersion: plugin.version,
  upstream: {
    repository: 'https://github.com/standard-software/WindowTabs',
    releaseTag: core.sourceTag,
    sourceCommit: core.sourceCommit,
    releaseUrl: core.source,
    releaseAsset: 'WindowTabs.zip',
    upstreamReleaseSha256: build.upstreamReleaseSha256
  },
  patches: patchPaths.map(file => ({
    file: `patches/${file.split('/').at(-1)}`,
    sha256: hash(file)
  })),
  patchId: core.patchId,
  contractVersion: core.contractVersion,
  capabilities: core.capabilities,
  schemaSha256: hash('settings-schema.json'),
  executableSha256: core.sha256,
  buildId: core.buildId,
  updatePolicy: core.updatePolicy,
  runtimeVerification: core.runtimeVerification,
  build: {
    record: 'build-record.json',
    sourceFileHashes: 'source-file-hashes.json',
    buildOutputFileHashes: 'build-output-file-hashes.json',
    distributionHelperFileHashes: 'distribution-helper-file-hashes.json',
    configuration: buildRecord.buildConfiguration,
    platform: buildRecord.platform,
    msbuildVersion: buildRecord.msbuildVersion,
    arguments: buildRecord.arguments
  },
  completePatchedSourceTree: 'upstream-source',
  buildOutputTree: 'build-output',
  buildWorkflow: '.github/workflows/build-plugin.yml'
};
const output = process.argv[3] || resolve(root, 'audit/source-manifest.json');
writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`Wrote ${output}`);
