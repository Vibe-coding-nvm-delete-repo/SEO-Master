import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function readStringLiteral(node) {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function readBooleanLiteral(node) {
  if (!node) return null;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

function getObjectProperty(objectLiteral, name) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName =
      ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
        ? property.name.text
        : null;
    if (propertyName === name) return property.initializer;
  }
  return undefined;
}

function collectRegistryEntries(repoRoot) {
  const registryPath = path.resolve(repoRoot, 'src/sharedCollaboration.ts');
  const sourceText = fs.readFileSync(registryPath, 'utf8');
  const sourceFile = ts.createSourceFile(registryPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let registryLiteral = null;

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'registryEntries' &&
      node.initializer &&
      ts.isSatisfiesExpression(node.initializer) &&
      ts.isAsExpression(node.initializer.expression) &&
      ts.isObjectLiteralExpression(node.initializer.expression.expression)
    ) {
      registryLiteral = node.initializer.expression.expression;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (!registryLiteral) {
    throw new Error('Unable to locate registryEntries in src/sharedCollaboration.ts');
  }

  const entries = [];
  for (const property of registryLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) continue;
    const entryLiteral = property.initializer;
    const id = readStringLiteral(getObjectProperty(entryLiteral, 'id'));
    const userVisibleSharedState = readBooleanLiteral(getObjectProperty(entryLiteral, 'userVisibleSharedState'));
    const testIdsLiteral = getObjectProperty(entryLiteral, 'testIds');
    if (!id || userVisibleSharedState == null || !testIdsLiteral || !ts.isObjectLiteralExpression(testIdsLiteral)) {
      throw new Error(`Registry entry "${property.name.getText(sourceFile)}" is missing required coverage fields.`);
    }
    const contract = readStringLiteral(getObjectProperty(testIdsLiteral, 'contract'));
    const browser = readStringLiteral(getObjectProperty(testIdsLiteral, 'browser'));
    const rules = readStringLiteral(getObjectProperty(testIdsLiteral, 'rules')) ?? undefined;
    if (!contract || !browser) {
      throw new Error(`Registry entry "${id}" is missing contract/browser test ids.`);
    }
    entries.push({
      id,
      userVisibleSharedState,
      testIds: { contract, browser, rules },
    });
  }

  return entries;
}

function isRequiredCoverage(value) {
  return value && Object.prototype.hasOwnProperty.call(value, 'id');
}

function ensureFileContainsId(repoRoot, coverage, kind, actionId) {
  const resolvedPath = path.resolve(repoRoot, coverage.file);
  if (!fs.existsSync(resolvedPath)) {
    return `${actionId} ${kind} file is missing: ${coverage.file}`;
  }
  const source = fs.readFileSync(resolvedPath, 'utf8');
  if (!source.includes(coverage.id)) {
    return `${actionId} ${kind} id "${coverage.id}" was not found in ${coverage.file}`;
  }
  return null;
}

function validateRequiredCoverageId(actionId, kind, expectedId, coverage) {
  if (coverage.id !== expectedId) {
    return `${actionId} ${kind} id mismatch: registry="${expectedId}" manifest="${coverage.id}"`;
  }
  return null;
}

function validateBrowserHarness(actionId, coverage) {
  const normalized = coverage.file.replace(/\\/g, '/');
  const requiresBrowserHarness = actionId.startsWith('generate.');
  if (!requiresBrowserHarness) return null;
  if (normalized.startsWith('e2e/')) return null;
  return `${actionId} browser coverage must live in e2e/ for isolated-runtime verification (found ${coverage.file})`;
}

const repoRoot = process.cwd();
const outputArgIndex = process.argv.findIndex((arg) => arg === '--write');
const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : null;

const manifestPath = path.resolve(repoRoot, 'scripts/collab/shared-action-coverage.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const registryEntries = collectRegistryEntries(repoRoot);
const manifestByAction = new Map(manifest.actions.map((entry) => [entry.actionId, entry]));
const errors = [];

for (const entry of registryEntries) {
  const manifestEntry = manifestByAction.get(entry.id);
  if (!manifestEntry) {
    errors.push(`Missing coverage manifest entry for ${entry.id}`);
    continue;
  }

  const contractIdError = validateRequiredCoverageId(entry.id, 'contract', entry.testIds.contract, manifestEntry.contract);
  if (contractIdError) errors.push(contractIdError);
  const contractFileError = ensureFileContainsId(repoRoot, manifestEntry.contract, 'contract', entry.id);
  if (contractFileError) errors.push(contractFileError);

  if (isRequiredCoverage(manifestEntry.browser)) {
    const browserIdError = validateRequiredCoverageId(entry.id, 'browser', entry.testIds.browser, manifestEntry.browser);
    if (browserIdError) errors.push(browserIdError);
    const browserHarnessError = validateBrowserHarness(entry.id, manifestEntry.browser);
    if (browserHarnessError) errors.push(browserHarnessError);
    const browserFileError = ensureFileContainsId(repoRoot, manifestEntry.browser, 'browser', entry.id);
    if (browserFileError) errors.push(browserFileError);
  } else if (entry.userVisibleSharedState) {
    errors.push(`${entry.id} browser coverage is marked not_required despite being user-visible shared state`);
  }

  if (entry.testIds.rules) {
    if (!isRequiredCoverage(manifestEntry.rules)) {
      errors.push(`${entry.id} rules coverage is required but manifest marks it not_required`);
    } else {
      const rulesIdError = validateRequiredCoverageId(entry.id, 'rules', entry.testIds.rules, manifestEntry.rules);
      if (rulesIdError) errors.push(rulesIdError);
      const rulesFileError = ensureFileContainsId(repoRoot, manifestEntry.rules, 'rules', entry.id);
      if (rulesFileError) errors.push(rulesFileError);
    }
  }
}

for (const manifestEntry of manifest.actions) {
  if (!registryEntries.some((entry) => entry.id === manifestEntry.actionId)) {
    errors.push(`Coverage manifest contains unknown action id ${manifestEntry.actionId}`);
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  actionCount: registryEntries.length,
  manifestCount: manifest.actions.length,
  missingCoverageCount: errors.length,
  errors,
};

if (outputPath) {
  const resolved = path.resolve(repoRoot, outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[collab:coverage] ${error}`);
  }
  process.exit(1);
}

process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
