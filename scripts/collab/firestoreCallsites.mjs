import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const FIRESTORE_PRIMITIVES = new Set([
  'addDoc',
  'deleteDoc',
  'getDoc',
  'getDocFromServer',
  'getDocs',
  'getDocsFromServer',
  'onSnapshot',
  'runTransaction',
  'setDoc',
  'updateDoc',
  'writeBatch',
]);

const LOW_LEVEL_COLLAB_IMPORT_RULES = [
  {
    targetPath: 'src/appSettingsDocStore.ts',
    forbiddenSymbols: [
      'deleteAppSettingsDocFields',
      'getAppSettingsDocData',
      'loadChunkedAppSettingsRows',
      'loadChunkedAppSettingsRowsLocalPreferred',
      'setAppSettingsDocData',
      'subscribeAppSettingsDocData',
      'writeChunkedAppSettingsRows',
    ],
    allowedImporters: [
      'src/appSettingsPersistence.ts',
    ],
    reason: 'App-facing shared app_settings access must route through appSettingsPersistence, not the low-level doc store.',
  },
  {
    targetPath: 'src/projectStorage.ts',
    forbiddenSymbols: [
      'loadProjectDataFromFirestore',
      'saveProjectDataToFirestore',
      'batchSetProjectsFolderId',
      'deleteProjectFromFirestore',
      'reviveProjectInFirestore',
      'saveProjectFoldersToFirestore',
      'saveProjectToFirestore',
      'softDeleteProjectInFirestore',
    ],
    allowedImporters: [
      'src/projectWorkspace.ts',
      'src/useProjectPersistence.ts',
      'src/projectMetadataCollab.ts',
    ],
    reason: 'App-facing project metadata writes must route through projectMetadataCollab, not low-level projectStorage helpers.',
  },
  {
    targetPath: 'src/projectWorkspace.ts',
    forbiddenSymbols: [
      'loadProjectDataForView',
    ],
    allowedImporters: [
      'src/useProjectPersistence.ts',
    ],
    reason: 'Shared project bootstrap must route through useProjectPersistence, not generic project workspace helpers.',
  },
];

function walkFiles(rootDir) {
  const results = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(resolved);
        continue;
      }
      if (resolved.endsWith('.ts') || resolved.endsWith('.tsx')) {
        results.push(resolved);
      }
    }
  }
  return results.sort();
}

function isAuditIgnoredPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized.includes('.test.') || normalized.includes('.spec.') || normalized.startsWith('src/qa/');
}

function collectImportedFirestoreNames(sourceFile) {
  const imported = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'firebase/firestore') continue;
    if (!statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    for (const element of statement.importClause.namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (!FIRESTORE_PRIMITIVES.has(importedName)) continue;
      imported.set(element.name.text, importedName);
    }
  }
  return imported;
}

function visitFirestoreCallsites(sourceFile, importedNames, relativePath, output) {
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const operation = importedNames.get(node.expression.text);
      if (operation) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.expression.getStart(sourceFile));
        output.push({
          path: relativePath.replace(/\\/g, '/'),
          line: line + 1,
          operation,
          snippet: sourceFile.text.slice(node.getStart(sourceFile), node.getEnd()).split(/\r?\n/, 1)[0]?.trim() ?? operation,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function collectFirestoreCallsites(repoRoot) {
  const srcRoot = path.join(repoRoot, 'src');
  const callsites = [];
  for (const absolutePath of walkFiles(srcRoot)) {
    const relativePath = path.relative(repoRoot, absolutePath);
    const sourceText = fs.readFileSync(absolutePath, 'utf8');
    const sourceFile = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true);
    const importedNames = collectImportedFirestoreNames(sourceFile);
    if (importedNames.size === 0) continue;
    visitFirestoreCallsites(sourceFile, importedNames, relativePath, callsites);
  }
  return callsites.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.line !== b.line) return a.line - b.line;
    return a.operation.localeCompare(b.operation);
  });
}

export function loadFirestoreCallsiteRules(repoRoot) {
  const rulesPath = path.join(repoRoot, 'scripts', 'collab', 'firestore-callsite-rules.json');
  const raw = fs.readFileSync(rulesPath, 'utf8');
  return JSON.parse(raw);
}

function matchesRule(callsite, rule) {
  if (callsite.path !== rule.path.replace(/\\/g, '/')) return false;
  if (rule.operations && !rule.operations.includes(callsite.operation)) return false;
  if (rule.startLine != null && callsite.line < rule.startLine) return false;
  if (rule.endLine != null && callsite.line > rule.endLine) return false;
  return true;
}

export function classifyFirestoreCallsites(callsites, rules) {
  return callsites.map((callsite) => ({
    ...callsite,
    classification: rules.find((rule) => matchesRule(callsite, rule)) ?? null,
  }));
}

export function detectUnscopedGenerateDocLiterals(repoRoot) {
  const findings = [];
  const srcRoot = path.join(repoRoot, 'src');
  const allowedPathSuffixes = [
    'src/generateWorkspaceScope.ts',
    'src/qa/contentPipelineQaRuntime.ts',
    'src/qa/ContentPipelineQaHarness.tsx',
  ].map((item) => item.replace(/\\/g, '/'));

  for (const absolutePath of walkFiles(srcRoot)) {
    const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
    if (allowedPathSuffixes.includes(relativePath)) continue;
    const sourceText = fs.readFileSync(absolutePath, 'utf8');
    const sourceFile = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'docId' && ts.isStringLiteralLike(node.initializer)) {
        if (node.initializer.text.startsWith('generate_')) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.initializer.getStart(sourceFile));
          findings.push({
            path: relativePath,
            line: line + 1,
            text: node.initializer.text,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return findings.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.line - b.line;
  });
}

function resolveRelativeImportTarget(importerPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const importerDir = path.posix.dirname(importerPath.replace(/\\/g, '/'));
  const resolvedBase = path.posix.normalize(path.posix.join(importerDir, specifier));
  for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = `${resolvedBase}${suffix}`.replace(/\\/g, '/');
    if (candidate.startsWith('src/')) return candidate;
  }
  return `${resolvedBase}.ts`.replace(/\\/g, '/');
}

export function detectLowLevelCollabImportBypasses(repoRoot) {
  const srcRoot = path.join(repoRoot, 'src');
  const findings = [];

  for (const absolutePath of walkFiles(srcRoot)) {
    const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
    if (isAuditIgnoredPath(relativePath)) continue;

    const sourceText = fs.readFileSync(absolutePath, 'utf8');
    const sourceFile = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true);

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

      const importPath = resolveRelativeImportTarget(relativePath, statement.moduleSpecifier.text);
      if (!importPath) continue;

      for (const rule of LOW_LEVEL_COLLAB_IMPORT_RULES) {
        if (importPath !== rule.targetPath.replace(/\\/g, '/')) continue;
        if (rule.allowedImporters.includes(relativePath)) continue;

        for (const element of statement.importClause.namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (!rule.forbiddenSymbols.includes(importedName)) continue;
          const { line } = sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile));
          findings.push({
            path: relativePath,
            line: line + 1,
            importPath,
            symbol: importedName,
            reason: rule.reason,
          });
        }
      }
    }
  }

  return findings.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.line !== b.line) return a.line - b.line;
    return a.symbol.localeCompare(b.symbol);
  });
}
