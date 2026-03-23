/**
 * patch-wasm.js — Patches native Node dependencies to use WASM fallbacks.
 * Required because WDAC (Windows Defender Application Control) blocks all .node native binaries.
 *
 * Run after: npm install --ignore-scripts && npm install --ignore-scripts esbuild-wasm @rollup/wasm-node @tailwindcss/oxide-wasm32-wasi --force
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const nm = path.join(root, 'node_modules');

let patched = 0;

// 1. Patch esbuild → esbuild-wasm
const esbuildMain = path.join(nm, 'esbuild/lib/main.js');
if (fs.existsSync(esbuildMain)) {
  const backup = esbuildMain + '.original';
  if (!fs.existsSync(backup)) fs.copyFileSync(esbuildMain, backup);
  fs.writeFileSync(esbuildMain, 'module.exports = require("esbuild-wasm");\n');
  console.log('  [1/3] esbuild → esbuild-wasm');
  patched++;
}

// 2. Patch rollup → @rollup/wasm-node
const wasmDist = path.join(nm, '@rollup/wasm-node/dist');
if (fs.existsSync(wasmDist)) {
  // CJS native.js
  fs.copyFileSync(path.join(wasmDist, 'native.js'), path.join(nm, 'rollup/dist/native.js'));
  // CJS wasm-node bindings
  const srcDir = path.join(wasmDist, 'wasm-node');
  const dstDir = path.join(nm, 'rollup/dist/wasm-node');
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
  if (fs.existsSync(srcDir)) fs.readdirSync(srcDir).forEach(f => fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f)));
  // ESM parseAst.js
  const esmSrc = path.join(wasmDist, 'es/shared');
  const esmDst = path.join(nm, 'rollup/dist/es/shared');
  if (fs.existsSync(path.join(esmSrc, 'parseAst.js'))) {
    fs.copyFileSync(path.join(esmSrc, 'parseAst.js'), path.join(esmDst, 'parseAst.js'));
  }
  // ESM wasm-node bindings
  const esmWasmSrc = path.join(esmSrc, 'wasm-node');
  const esmWasmDst = path.join(esmDst, 'wasm-node');
  if (!fs.existsSync(esmWasmDst)) fs.mkdirSync(esmWasmDst, { recursive: true });
  if (fs.existsSync(esmWasmSrc)) fs.readdirSync(esmWasmSrc).forEach(f => fs.copyFileSync(path.join(esmWasmSrc, f), path.join(esmWasmDst, f)));
  console.log('  [2/3] rollup → @rollup/wasm-node');
  patched++;
}

// 3. Patch lightningcss with no-op stub
const lcss = path.join(nm, 'lightningcss/node/index.js');
if (fs.existsSync(lcss)) {
  const backup = lcss + '.original';
  if (!fs.existsSync(backup)) fs.copyFileSync(lcss, backup);
  fs.writeFileSync(lcss, `let native;
try {
  const parts = [process.platform, process.arch];
  if (process.platform === 'win32') parts.push('msvc');
  native = require('lightningcss-' + parts.join('-'));
} catch (err) {
  native = {
    transform: () => ({ code: Buffer.from(''), map: null }),
    transformStyleAttribute: () => ({ code: Buffer.from(''), map: null }),
    bundle: () => ({ code: Buffer.from(''), map: null }),
    bundleAsync: async () => ({ code: Buffer.from(''), map: null }),
  };
}
const wrap = (fn) => fn;
module.exports.transform = wrap(native.transform);
module.exports.transformStyleAttribute = wrap(native.transformStyleAttribute);
module.exports.bundle = wrap(native.bundle);
module.exports.bundleAsync = wrap(native.bundleAsync);
module.exports.browserslistToTargets = require('./browserslistToTargets');
module.exports.composeVisitors = require('./composeVisitors');
module.exports.Features = require('./flags').Features;
`);
  console.log('  [3/3] lightningcss → no-op stub');
  patched++;
}

console.log(`\nDone! ${patched}/3 patches applied.`);
if (patched < 3) {
  console.log('WARNING: Some patches failed. Run: npm install --ignore-scripts esbuild-wasm @rollup/wasm-node --force');
}
