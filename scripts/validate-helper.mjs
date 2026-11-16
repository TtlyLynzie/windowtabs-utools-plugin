import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
const root = resolve(process.argv[2] || new URL('..', import.meta.url).pathname);
const read = name => JSON.parse(readFileSync(resolve(root,name),'utf8').replace(/^\uFEFF/,''));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const manifest = read('helper/current.json');
const helperRoot = resolve(root,'helper');
if (typeof manifest.path !== 'string' || manifest.path.includes('\\') || manifest.path.split('/').includes('..')) throw Error('Invalid helper path');
const exe = resolve(helperRoot,manifest.path);
if (!exe.startsWith(helperRoot+sep) || !manifest.path.endsWith('/WindowTabs.exe')) throw Error('Invalid helper path');
const schemaHash = hash(resolve(root,'settings-schema.json'));
if (!manifest.version || manifest.buildId !== `${manifest.version}-${manifest.patchId}` ||
    manifest.patchId !== 'upstream-integrated-v12' || manifest.protocol !== 1 ||
    manifest.ipc !== true || manifest.supportsIpc !== true || manifest.contractVersion !== 1 ||
    !manifest.capabilities?.includes('integrated-settings-v1')) throw Error('IPC contract mismatch');
if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || hash(exe)!==manifest.sha256) throw Error('Core SHA256 mismatch');
if (manifest.schemaSha256 !== schemaHash || manifest.updatePolicy !== 'disabled-runtime-download') throw Error('Core policy mismatch');
const proof = manifest.runtimeVerification;
if (!proof?.passed || proof.updaterDisabled !== true || proof.sha256 !== manifest.sha256 ||
    proof.schemaSha256 !== schemaHash || proof.buildId !== manifest.buildId)
  throw Error('Runtime proof does not match helper');
console.log(`Verified IPC helper: ${manifest.buildId} (${manifest.sha256})`);
