import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, 'extension-dist');
if (out !== join(root, 'extension-dist')) throw new Error('Invalid extension output directory');
await mkdir(out, { recursive: true });
await build({ entryPoints: [join(root, 'src/extension/content.ts')], outfile: join(out, 'content.js'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome116', minify: true });
for (const directory of ['mediapipe', 'models', 'licenses']) await cp(join(root, 'public', directory), join(out, directory), { recursive: true });
await cp(join(root, 'extension-assets'), out, { recursive: true });
const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
await writeFile(join(out, 'INSTALL.txt'), 'Stillpoint ' + manifest.version + '\n\nExtract this ZIP into a folder. In desktop Chrome open chrome://extensions, enable Developer mode, choose Load unpacked, and select the extracted folder containing manifest.json. In Edge use edge://extensions.\n\nOpen a video page and start its video once so the browser permits later playback. Click the Stillpoint toolbar icon (or Alt+Shift+S). Keep its side panel open. Click Enable camera and calibrate, or use the labelled simulation. Grant site access only when you want it. Automatic resume is off by default; manual pauses stay paused.\n\nThis is a developer-install package, not a Chrome Web Store listing. Standard top-level HTML video is supported; cross-origin players and streaming sites require individual validation. Netflix playback has not been account-tested. Camera processing stays local.\n\nSource and documentation: https://github.com/xrishis/head-motion-video-control\n');
console.log(`Built unpacked Stillpoint ${manifest.version}: ${out}`);
