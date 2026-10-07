import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : join(directory, entry.name)))).flat().sort();
}
const hash = createHash('sha256');
for (const path of await files('dist')) if (!path.endsWith('/sw.js')) hash.update(await readFile(path));
const worker = await readFile('public/sw.js', 'utf8');
await writeFile('dist/sw.js', worker.replace('bluekite-public-v1', `bluekite-public-${hash.digest('hex').slice(0, 12)}`));
