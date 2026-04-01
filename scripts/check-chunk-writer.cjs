/**
 * Ensures saveProjectDataToFirestore is only referenced from useProjectPersistence
 * (and definition/tests). Part of multi-user persistence hardening.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const NEEDLE = 'saveProjectDataToFirestore';

const ALLOW_SUBSTR = [
  'useProjectPersistence.ts',
  'projectStorage.ts',
  '.test.ts',
  '.test.tsx',
  'App.shared-projects.integration.test.tsx',
];

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

const bad = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');
  if (ALLOW_SUBSTR.some((s) => rel.includes(s))) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(NEEDLE)) bad.push(rel);
}

if (bad.length) {
  console.error(
    '[check-chunk-writer] saveProjectDataToFirestore must only be used from useProjectPersistence / projectStorage / tests. Offenders:\n',
    bad.join('\n'),
  );
  process.exit(1);
}
console.log('[check-chunk-writer] OK');
