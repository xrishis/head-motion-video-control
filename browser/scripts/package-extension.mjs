import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync } from 'fflate';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = join(root, 'extension-dist');
const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
const files = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) files[relative(source, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
    else throw new Error('Unexpected nonregular file in extension package');
  }
}
await collect(source);
if (!files['manifest.json'] || !files['content.js'] || !files['background.js'] || !files['models/face_landmarker.task']) throw new Error('Extension package is incomplete');
const archive = zipSync(files, { level: 6 });
const check = unzipSync(archive);
if (JSON.parse(new TextDecoder().decode(check['manifest.json'])).version !== manifest.version) throw new Error('ZIP verification failed');
await mkdir(join(root, 'artifacts'), { recursive: true });
const output = join(root, 'artifacts', `stillpoint-extension-v${manifest.version}.zip`);
await writeFile(output, archive);
console.log(JSON.stringify({ output, files: Object.keys(check).length, bytes: archive.byteLength, version: manifest.version }));
