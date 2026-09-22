import { cp, mkdir, rm, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const run = promisify(execFile);
const root = resolve(import.meta.dirname);
const publicDir = resolve(root, 'public');
const dist = resolve(root, 'dist');
const sourceApp = resolve(publicDir, 'app.js');

// Fail the build on malformed browser JavaScript before copying artifacts.
await run(process.execPath, ['--check', sourceApp]);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(publicDir, dist, { recursive: true });

const html = await readFile(resolve(dist, 'index.html'), 'utf8');
const app = await readFile(resolve(dist, 'app.js'), 'utf8');
if (!html.includes('/app.js') || !app.includes('React.createElement')) {
  throw new Error('Production UI validation failed');
}

await run(process.execPath, ['--check', resolve(dist, 'app.js')]);
console.log('Helios frontend production build created at dist/ and JavaScript syntax validated.');
