import type { Project, ProjectFolder } from './types';

/** Parse and validate folder list from Firestore / local cache. */
export function parseProjectFoldersFromFirestore(raw: unknown): ProjectFolder[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectFolder[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const order = typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : 0;
    if (!id || !name) continue;
    out.push({ id, name, order });
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Resolve folder id when the referenced folder was removed — treat as unassigned. */
export function effectiveProjectFolderId(project: Project, validFolderIds: Set<string>): string | null {
  if (project.deletedAt) return null;
  const fid = project.folderId ?? null;
  if (fid && validFolderIds.has(fid)) return fid;
  return null;
}

export function newFolderId(): string {
  return `fld_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
