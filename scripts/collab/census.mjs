import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  classifyFirestoreCallsites,
  collectFirestoreCallsites,
  loadFirestoreCallsiteRules,
} from './firestoreCallsites.mjs';

const repoRoot = process.cwd();
const outputArgIndex = process.argv.findIndex((arg) => arg === '--write');
const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : null;

const callsites = collectFirestoreCallsites(repoRoot);
const rules = loadFirestoreCallsiteRules(repoRoot);
const classified = classifyFirestoreCallsites(callsites, rules);

const payload = {
  generatedAt: new Date().toISOString(),
  callsiteCount: classified.length,
  unknownCount: classified.filter((entry) => !entry.classification).length,
  callsites: classified.map((entry) => ({
    path: entry.path,
    line: entry.line,
    operation: entry.operation,
    snippet: entry.snippet,
    classification: entry.classification,
  })),
};

if (outputPath) {
  const resolved = path.resolve(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
