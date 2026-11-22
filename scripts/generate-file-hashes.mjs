import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
const label = process.argv[4] || '.';
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('Usage: generate-file-hashes.mjs <root> <output> [root-label]');
}

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const filePath = join(dir, entry.name);
    if (entry.isDirectory()) walk(filePath);
    else if (entry.isFile()) {
      files.push({
        file: relative(root, filePath).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(readFileSync(filePath)).digest('hex'),
        bytes: statSync(filePath).size
      });
    }
  }
}

walk(root);
files.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(out, JSON.stringify({ algorithm: 'sha256', root: label, files }, null, 2) + '\n');
console.log(`Hashed ${files.length} files under ${label}`);
