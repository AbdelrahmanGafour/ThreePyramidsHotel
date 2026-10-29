// Hostinger's Node.js publisher flattens `.next/standalone/apps/web` into the
// app root and leaves the traced `.next/standalone/node_modules` behind. Copy
// those modules next to the flattened server so `require('next')` resolves.
const fs = require('node:fs');
const path = require('node:path');

const standalone = path.resolve(__dirname, '../apps/web/.next/standalone');
const from = path.join(standalone, 'node_modules');
const to = path.join(standalone, 'apps/web/node_modules');

if (fs.existsSync(from)) {
  fs.cpSync(from, to, { recursive: true, dereference: true });
  console.log('postbuild: copied standalone node_modules into apps/web');
} else {
  console.log('postbuild: no standalone node_modules found, nothing to copy');
}
