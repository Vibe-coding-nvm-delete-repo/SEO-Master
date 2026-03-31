import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_SCHEMA_VERSION,
  PROJECT_BASE_COMMITS_COLLECTION,
  PROJECT_BASE_COMMIT_CHUNKS_SUBCOLLECTION,
  PROJECT_BLOCKED_TOKENS_SUBCOLLECTION,
  PROJECT_COLLAB_META_COLLECTION,
  PROJECT_COLLAB_META_DOC,
  PROJECT_GROUPS_SUBCOLLECTION,
  PROJECT_LABEL_SECTIONS_SUBCOLLECTION,
  PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION,
  PROJECT_OPERATIONS_SUBCOLLECTION,
  PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION,
} from './projectCollabV2';

const rulesSource = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const hookSource = readFileSync(resolve(process.cwd(), 'src/useProjectPersistence.ts'), 'utf8');

function normalizeWhitespace(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

function extractMatchBlock(source: string, matchPath: string): string {
  const matchToken = `match ${matchPath}`;
  const matchStart = source.indexOf(matchToken);
  expect(matchStart).toBeGreaterThanOrEqual(0);

  const blockStart = source.indexOf('{', matchStart + matchToken.length);
  expect(blockStart).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(matchStart, index + 1);
      }
    }
  }

  throw new Error(`Unclosed rules block for ${matchPath}`);
}

describe('V2 contract parity', () => {
  it('keeps canonical collection constants aligned with the V2 storage contract', () => {
    expect(CLIENT_SCHEMA_VERSION).toBe(2);
    expect(PROJECT_BASE_COMMITS_COLLECTION).toBe('base_commits');
    expect(PROJECT_BASE_COMMIT_CHUNKS_SUBCOLLECTION).toBe('chunks');
    expect(PROJECT_COLLAB_META_COLLECTION).toBe('collab');
    expect(PROJECT_COLLAB_META_DOC).toBe('meta');
    expect(PROJECT_GROUPS_SUBCOLLECTION).toBe('groups');
    expect(PROJECT_BLOCKED_TOKENS_SUBCOLLECTION).toBe('blocked_tokens');
    expect(PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION).toBe('manual_blocked_keywords');
    expect(PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION).toBe('token_merge_rules');
    expect(PROJECT_LABEL_SECTIONS_SUBCOLLECTION).toBe('label_sections');
    expect(PROJECT_OPERATIONS_SUBCOLLECTION).toBe('project_operations');
  });

  it('requires CAS revision checks for all revisioned V2 entity collections in firestore.rules', () => {
    const revisionedCollections = [
      ['/groups/{groupId}', 'groups'],
      ['/blocked_tokens/{tokenId}', 'blocked_tokens'],
      ['/manual_blocked_keywords/{keywordId}', 'manual_blocked_keywords'],
      ['/token_merge_rules/{ruleId}', 'token_merge_rules'],
      ['/label_sections/{sectionId}', 'label_sections'],
    ] as const;

    for (const [matchPath] of revisionedCollections) {
      const collectionBlock = normalizeWhitespace(extractMatchBlock(rulesSource, matchPath));
      expect(collectionBlock).toContain('validRevisionedCreate(projectId)');
      expect(collectionBlock).toContain('validRevisionedUpdate(projectId)');
    }
  });

  it('blocks meta and lock delete bypasses and validates base commit chunk epoch fields in rules', () => {
    const collabMetaBlock = normalizeWhitespace(extractMatchBlock(rulesSource, '/collab/meta'));
    const operationsBlock = normalizeWhitespace(extractMatchBlock(rulesSource, '/project_operations/{operationId}'));
    const baseCommitsBlock = extractMatchBlock(rulesSource, '/base_commits/{commitId}');
    const baseCommitChunksBlock = normalizeWhitespace(extractMatchBlock(baseCommitsBlock, '/chunks/{chunkId}'));

    expect(collabMetaBlock).toContain('allow delete: if false;');
    expect(operationsBlock).toContain('allow delete: if false;');
    expect(baseCommitChunksBlock).toContain('isInt(request.resource.data.datasetEpoch)');
    expect(baseCommitChunksBlock).toContain(
      'get(/databases/$(database)/documents/projects/$(projectId)/base_commits/$(commitId)).data.datasetEpoch == request.resource.data.datasetEpoch;',
    );
  });

  it('keeps V2 epoch-changing writes routed through lock-required persistence calls in the hook', () => {
    const lockRequiredCalls = hookSource.match(/requireOwnedLock:\s*true/g) ?? [];
    expect(lockRequiredCalls.length).toBeGreaterThanOrEqual(5);
    expect(hookSource).toContain('Shared state is still recovering');
    expect(hookSource).toContain('requires a newer client version');
  });
});
