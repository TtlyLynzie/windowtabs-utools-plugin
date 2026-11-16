import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
const root = resolve(process.argv[2] || 'upstream-source');
const out = resolve(process.argv[3] || 'source-file-hashes.json');
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'packages', 'bin', 'obj'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) files.push({ file: relative(root, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), bytes: statSync(path).size });
  }
}
walk(root);
files.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(out, JSON.stringify({ algorithm: 'sha256', root: 'upstream-source', files }, null, 2) + '\n');
console.log(`Hashed ${files.length} source files`);
