// HELIOS_EVENT_P0_2026_AR: self-contained production frontend
import { cp, mkdir, rm, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const run = promisify(execFile);
const root = resolve(import.meta.dirname);
const publicDir = resolve(root, 'public');
const dist = resolve(root, 'dist');
const sourceApp = resolve(publicDir, 'app.js');
const outputApp = resolve(dist, 'app.js');

await run(process.execPath, ['--check', sourceApp]);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(publicDir, dist, { recursive: true });

// public/app.js intentionally uses bare React imports. Bundle them into one
// browser artifact so the presentation has no runtime JavaScript CDN dependency.
await build({
  entryPoints: [sourceApp],
  outfile: outputApp,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: false,
  sourcemap: false,
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  logLevel: 'info'
});

const html = await readFile(resolve(dist, 'index.html'), 'utf8');
const app = await readFile(outputApp, 'utf8');

if (!html.includes('/app.js')) {
  throw new Error('Production UI validation failed: index.html does not load /app.js');
}

const forbiddenRuntimeCdns = [
  'https://esm.sh',
  'http://esm.sh',
  'https://unpkg.com',
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com'
];

for (const origin of forbiddenRuntimeCdns) {
  if (app.includes(origin)) {
    throw new Error(`Production UI validation failed: bundled app still references ${origin}`);
  }
}

await run(process.execPath, ['--check', outputApp]);
console.log('Helios frontend production build created at dist/: React/ReactDOM are locally bundled and JavaScript syntax is valid.');
