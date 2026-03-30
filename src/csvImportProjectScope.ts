/**
 * CSV import runs asynchronously (chunked parsing + rAF). The active project can
 * change mid-flight; persistence uses activeProjectIdRef while legacy code used
 * closure-captured activeProjectId — causing saves to land under the wrong project.
 * Pin the project id from import start and compare with the current ref.
 */
export function csvImportProjectMismatch(
  pinnedProjectId: string,
  currentProjectId: string | null,
): boolean {
  return currentProjectId !== pinnedProjectId;
}
