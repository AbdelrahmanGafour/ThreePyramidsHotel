// Prepares `.next/standalone` for Hostinger's Node.js publisher, which
// flattens `.next/standalone/apps/web` into the app root:
//
//  1. Copy the traced `node_modules` (left one level up) next to the flattened
//     server so `require('next')` resolves.
//  2. Embed the API: copy its compiled output plus its production dependencies
//     into `apps/web/embedded-api`. The host cannot run a second server (see
//     apps/web/shared/server/embeddedApi.ts), so the web process loads it.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const standalone = path.join(root, 'apps/web/.next/standalone');
const webDir = path.join(standalone, 'apps/web');

const tracedModules = path.join(standalone, 'node_modules');
if (fs.existsSync(tracedModules)) {
  fs.cpSync(tracedModules, path.join(webDir, 'node_modules'), { recursive: true, dereference: true });
  console.log('postbuild: copied standalone node_modules into apps/web');
}

const apiDir = path.join(root, 'apps/api');
const target = path.join(webDir, 'embedded-api');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(apiDir, 'dist'), path.join(target, 'dist'), { recursive: true });
// The web package is ESM; the compiled API is CommonJS.
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ type: 'commonjs' }));

// Install the API's production dependencies in a scratch directory (outside any
// workspace) and move the result in, so npm never hoists them elsewhere.
const apiPackage = JSON.parse(fs.readFileSync(path.join(apiDir, 'package.json'), 'utf8'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'embedded-api-'));
fs.writeFileSync(
  path.join(scratch, 'package.json'),
  JSON.stringify({ name: 'embedded-api', version: '0.0.0', private: true, dependencies: apiPackage.dependencies }),
);
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts=false'], {
  cwd: scratch,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
fs.cpSync(path.join(scratch, 'node_modules'), path.join(target, 'node_modules'), { recursive: true, dereference: true });
fs.rmSync(scratch, { recursive: true, force: true });
console.log('postbuild: embedded the API into apps/web/embedded-api');
