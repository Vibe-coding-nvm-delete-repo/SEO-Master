import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  classifyFirestoreCallsites,
  collectFirestoreCallsites,
  detectLowLevelCollabImportBypasses,
  detectUnscopedGenerateDocLiterals,
  loadFirestoreCallsiteRules,
} from './firestoreCallsites.mjs';

const repoRoot = process.cwd();
const outputArgIndex = process.argv.findIndex((arg) => arg === '--write');
const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : null;

const callsites = collectFirestoreCallsites(repoRoot);
const rules = loadFirestoreCallsiteRules(repoRoot);
const classified = classifyFirestoreCallsites(callsites, rules);
const unknown = classified.filter((entry) => !entry.classification);
const toMigrate = classified.filter((entry) => entry.classification?.status === 'to_migrate');
const unscopedGenerateDocLiterals = detectUnscopedGenerateDocLiterals(repoRoot);
const lowLevelCollabBypasses = detectLowLevelCollabImportBypasses(repoRoot);

const signoff = {
  generatedAt: new Date().toISOString(),
  summary: {
    callsiteCount: classified.length,
    unknownCount: unknown.length,
    toMigrateCount: toMigrate.length,
    unscopedGenerateDocLiteralCount: unscopedGenerateDocLiterals.length,
    lowLevelCollabBypassCount: lowLevelCollabBypasses.length,
  },
  inScopeContractManagedCount: classified.filter((entry) => {
    const status = entry.classification?.status;
    const scope = entry.classification?.scope;
    return status === 'contract_managed' && scope !== 'out_of_scope' && scope !== 'test_only';
  }).length,
  outOfScopeOrSupportCount: classified.filter((entry) => {
    const status = entry.classification?.status;
    return status === 'out_of_scope_non_collab' || status === 'internal_admin_or_support' || status === 'test_or_qa_only';
  }).length,
  unknown,
  toMigrate,
  unscopedGenerateDocLiterals,
  lowLevelCollabBypasses,
};

if (outputPath) {
  const resolved = path.resolve(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(signoff, null, 2) + '\n', 'utf8');
}

if (unknown.length > 0 || toMigrate.length > 0 || unscopedGenerateDocLiterals.length > 0 || lowLevelCollabBypasses.length > 0) {
  if (unknown.length > 0) {
    console.error('[collab:audit] Unclassified Firestore callsites:');
    for (const entry of unknown) {
      console.error(`  ${entry.path}:${entry.line} ${entry.operation}`);
    }
  }
  if (toMigrate.length > 0) {
    console.error('[collab:audit] Callsites still marked to_migrate:');
    for (const entry of toMigrate) {
      console.error(`  ${entry.path}:${entry.line} ${entry.operation}`);
    }
  }
  if (unscopedGenerateDocLiterals.length > 0) {
    console.error('[collab:audit] Unscoped generate doc literals:');
    for (const entry of unscopedGenerateDocLiterals) {
      console.error(`  ${entry.path}:${entry.line} ${entry.text}`);
    }
  }
  if (lowLevelCollabBypasses.length > 0) {
    console.error('[collab:audit] Low-level collaboration store bypasses:');
    for (const entry of lowLevelCollabBypasses) {
      console.error(`  ${entry.path}:${entry.line} imports ${entry.symbol} from ${entry.importPath}`);
    }
  }
  process.exit(1);
}

process.stdout.write(JSON.stringify(signoff, null, 2) + '\n');
