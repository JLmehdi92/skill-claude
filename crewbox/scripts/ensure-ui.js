// Build the web UI before starting when it is missing or older than its sources.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const built = path.join(web, 'dist', 'index.html');

function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

const stale = !fs.existsSync(built) || Math.max(newest(path.join(web, 'src')), fs.statSync(path.join(web, 'index.html')).mtimeMs) > fs.statSync(built).mtimeMs;
if (stale) {
  let vite;
  try { vite = await import('vite'); } catch {
    if (fs.existsSync(built)) process.exit(0);
    console.error('The web UI is not built and Vite is not installed. Run `npm install` first.');
    process.exit(1);
  }
  console.log('Building the web UI…');
  await vite.build({ configFile: path.join(web, 'vite.config.js'), logLevel: 'warn' });
}
