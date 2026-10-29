// Single-process-slot hosting (e.g. Hostinger Node.js app): start the Express
// API on an internal port, then Next.js on the public $PORT. The web app
// reaches the API over localhost via API_BASE_URL.
const { spawn } = require('node:child_process');
const path = require('node:path');

const apiPort = process.env.API_PORT || '4000';
const webPort = process.env.PORT || '3000';
const root = path.resolve(__dirname, '..');

const env = { ...process.env, API_BASE_URL: process.env.API_BASE_URL || `http://127.0.0.1:${apiPort}` };

const api = spawn(process.execPath, ['dist/server.js'], {
  cwd: path.join(root, 'apps/api'),
  env: { ...env, PORT: apiPort },
  stdio: 'inherit',
});
const web = spawn(process.execPath, [require.resolve('next/dist/bin/next', { paths: [path.join(root, 'apps/web')] }), 'start', '-p', webPort], {
  cwd: path.join(root, 'apps/web'),
  env,
  stdio: 'inherit',
});

const children = [api, web];
function stop(code) {
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
}
for (const c of children) c.on('exit', (code) => stop(code ?? 1));
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
