import type { Project } from './types';

/** Whether this project id can be restored as the active project (exists and not soft-deleted). */
export function isUsableActiveProjectId(
  projectId: string | null | undefined,
  projects: Project[],
): projectId is string {
  return !!projectId && projects.some(p => p.id === projectId && !p.deletedAt);
}
