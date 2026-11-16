import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const auditRoot = resolve(process.argv[2] || 'audit-bundle');
const marketRoot = resolve(process.argv[3] || 'dist/market');
const readJson = (root, name) => JSON.parse(readFileSync(resolve(root, name), 'utf8').replace(/^\uFEFF/, ''));
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function safeFile(root, name) {
  assert(typeof name === 'string' && name && !name.includes('\\') && !name.split('/').includes('..'), `Unsafe path: ${name}`);
  const file = resolve(root, name);
  assert(file.startsWith(root + sep) && statSync(file).isFile(), `Missing file: ${name}`);
  return file;
}

function walk(root) {
  const files = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(relative(root, file).replaceAll('\\', '/'));
    }
  }
  visit(root);
  return files.sort();
}

function verifyInventory(inventoryName, actualRoot) {
  const inventory = readJson(auditRoot, inventoryName);
  assert(inventory.algorithm === 'sha256' && Array.isArray(inventory.files), `Invalid hash inventory: ${inventoryName}`);
  const expectedNames = inventory.files.map(item => item.file).sort();
  const actualNames = walk(actualRoot);
  assert(JSON.stringify(expectedNames) === JSON.stringify(actualNames), `File list mismatch: ${inventoryName}`);
  for (const item of inventory.files) {
    const file = safeFile(actualRoot, item.file);
    assert(statSync(file).size === item.bytes, `File size mismatch: ${inventoryName}:${item.file}`);
    assert(sha256(file) === item.sha256, `SHA-256 mismatch: ${inventoryName}:${item.file}`);
  }
  return inventory;
}

const manifest = readJson(auditRoot, 'source-manifest.json');
const current = readJson(auditRoot, 'current.json');
const marketCurrent = readJson(marketRoot, 'helper/current.json');
const plugin = readJson(marketRoot, 'plugin.json');
const record = readJson(auditRoot, manifest.build?.record || 'build-record.json');

assert(manifest.formatVersion === 2, 'Unsupported audit manifest format');
assert(manifest.pluginVersion === plugin.version, 'Plugin version mismatch');
assert(JSON.stringify(current) === JSON.stringify(marketCurrent), 'Audit and marketplace helper manifests differ');
assert(manifest.upstream?.releaseTag === current.sourceTag, 'Source tag mismatch');
assert(manifest.upstream?.sourceCommit === current.sourceCommit, 'Source commit mismatch');
assert(manifest.upstream?.releaseUrl === current.source, 'Source URL mismatch');
assert(manifest.patchId === current.patchId && manifest.buildId === current.buildId, 'Build identity mismatch');
assert(manifest.executableSha256 === current.sha256, 'Executable identity mismatch');
assert(manifest.schemaSha256 === current.schemaSha256, 'Schema identity mismatch');
assert(manifest.updatePolicy === 'disabled-runtime-download' && current.updatePolicy === manifest.updatePolicy, 'Runtime update policy mismatch');

assert(Array.isArray(manifest.patches) && manifest.patches.length === 2, 'Both source patches must be recorded');
for (const patch of manifest.patches) {
  assert(sha256(safeFile(auditRoot, patch.file)) === patch.sha256, `Patch hash mismatch: ${patch.file}`);
}

assert(record.sourceTag === current.sourceTag && record.sourceCommit === current.sourceCommit, 'Build record source mismatch');
assert(record.executableSha256 === current.sha256 && record.updaterDisabled === true, 'Build record output mismatch');
assert(typeof record.msbuildVersion === 'string' && record.msbuildVersion.trim(), 'MSBuild version is missing');
assert(Array.isArray(record.arguments) && record.arguments.length > 0, 'MSBuild arguments are missing');
assert(manifest.build?.msbuildVersion === record.msbuildVersion, 'MSBuild version manifest mismatch');
assert(JSON.stringify(manifest.build?.arguments) === JSON.stringify(record.arguments), 'MSBuild arguments manifest mismatch');

const proof = manifest.runtimeVerification;
assert(proof?.passed && proof.updaterDisabled === true, 'Runtime verification did not prove updater disablement');
assert(proof.sha256 === current.sha256 && proof.schemaSha256 === current.schemaSha256 && proof.buildId === current.buildId,
  'Runtime verification identity mismatch');

assert(sha256(safeFile(auditRoot, 'settings-schema.json')) === current.schemaSha256, 'Audit schema hash mismatch');
assert(sha256(safeFile(marketRoot, 'settings-schema.json')) === current.schemaSha256, 'Marketplace schema hash mismatch');
const helperExe = safeFile(resolve(marketRoot, 'helper'), current.path);
assert(sha256(helperExe) === current.sha256, 'Marketplace executable hash mismatch');

verifyInventory(manifest.build.sourceFileHashes, resolve(auditRoot, manifest.completePatchedSourceTree));
const buildOutputs = verifyInventory(manifest.build.buildOutputFileHashes, resolve(auditRoot, manifest.buildOutputTree));
const helperDirectory = dirname(current.path).replaceAll('\\', '/');
const distribution = verifyInventory(manifest.build.distributionHelperFileHashes, resolve(marketRoot, 'helper', helperDirectory));

const builtExe = buildOutputs.files.find(item => item.file === 'WindowTabs.exe');
assert(builtExe?.sha256 === current.sha256, 'Build output WindowTabs.exe does not match the distributed executable');
assert(distribution.files.some(item => item.file === 'WindowTabs.exe' && item.sha256 === current.sha256), 'Distribution executable hash is missing');
assert(distribution.files.some(item => item.file === 'WindowTabs.exe.config'), 'Distribution config hash is missing');

const forbidden = [
  'WebClient', 'AsyncDownloadString', 'AsyncDownloadFile',
  'api.github.com/repos/standard-software/WindowTabs/releases/latest',
  'windowtabs.uservoice.com', 'this.checkForUpdates()', 'this.startUpdate', 'UpdateChecker'
];
const sourceRoot = resolve(auditRoot, manifest.completePatchedSourceTree);
for (const name of walk(sourceRoot).filter(name => /\.(?:fs|cs)$/.test(name))) {
  const text = readFileSync(resolve(sourceRoot, name), 'utf8');
  for (const token of forbidden) assert(!text.includes(token), `Forbidden runtime updater token remains: ${name}:${token}`);
}

console.log(`Verified complete audit bundle: ${manifest.buildId} (${manifest.executableSha256})`);
