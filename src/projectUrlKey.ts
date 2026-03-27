import type { Project } from './types';

function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-') || 'project';
}

function stableProjectSuffix(projectId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < projectId.length; i++) {
    hash ^= projectId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `p${(hash >>> 0).toString(16).padStart(8, '0').slice(0, 6)}`;
}

export function projectUrlKey(project: Project): string {
  return `${slugifyProjectName(project.name)}--${stableProjectSuffix(project.id)}`;
}

/**
 * Extractable, name-independent portion of `projectUrlKey`.
 * Useful for resolving old links even if the project name changes.
 */
export function projectUrlKeySuffixFromId(projectId: string): string {
  return stableProjectSuffix(projectId);
}
