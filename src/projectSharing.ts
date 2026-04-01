import type { Project } from './types';

export const SHARED_PROJECT_DESCRIPTION = 'collab';

export function isSharedProject(project: Pick<Project, 'description'> | null | undefined): boolean {
  return project?.description?.trim().toLowerCase() === SHARED_PROJECT_DESCRIPTION;
}
