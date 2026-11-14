import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || new URL('../dist/market', import.meta.url).pathname);
const readJson = name => JSON.parse(readFileSync(resolve(root, name), 'utf8').replace(/^\uFEFF/, ''));
const hash = name => createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex');
const manifest = readJson('audit/source-manifest.json');
const current = readJson('helper/current.json');
const plugin = readJson('plugin.json');
if (manifest.pluginVersion !== plugin.version) throw Error('Audit manifest plugin version mismatch');
if (manifest.upstream?.releaseTag !== current.sourceTag || manifest.upstream?.sourceCommit !== current.sourceCommit ||
    manifest.upstream?.releaseUrl !== current.source) throw Error('Audit manifest upstream source mismatch');
if (manifest.patch?.id !== current.patchId || manifest.buildId !== current.buildId ||
    manifest.executableSha256 !== current.sha256 || manifest.schemaSha256 !== current.schemaSha256) {
  throw Error('Audit manifest core identity mismatch');
}
const patch = String(manifest.patch?.file || '');
if (!patch.startsWith('audit/') || patch.includes('..') || !patch.endsWith('.txt')) throw Error('Invalid audit patch path');
const patchPath = resolve(root, patch);
if (!patchPath.startsWith(root + sep) || !statSync(patchPath).isFile()) throw Error('Audit patch is missing');
if (hash(patch) !== manifest.patch.sha256) throw Error('Audit patch SHA-256 mismatch');
if (hash('settings-schema.json') !== manifest.schemaSha256) throw Error('Audit schema SHA-256 mismatch');
if (hash(`helper/${current.path}`) !== current.sha256) throw Error('Helper SHA-256 mismatch');
if (!manifest.runtimeVerification?.passed || manifest.runtimeVerification.sha256 !== current.sha256 ||
    manifest.runtimeVerification.schemaSha256 !== current.schemaSha256 ||
    manifest.runtimeVerification.buildId !== current.buildId) throw Error('Runtime proof does not match helper');
console.log(`Verified audit manifest: ${manifest.buildId}`);
