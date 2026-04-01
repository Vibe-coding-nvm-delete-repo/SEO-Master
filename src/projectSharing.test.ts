import { describe, expect, it } from 'vitest';
import { isSharedProject, SHARED_PROJECT_DESCRIPTION } from './projectSharing';

describe('projectSharing', () => {
  it('detects shared projects from the collab description', () => {
    expect(isSharedProject({ description: SHARED_PROJECT_DESCRIPTION })).toBe(true);
    expect(isSharedProject({ description: '  collab  ' })).toBe(true);
    expect(isSharedProject({ description: 'CoLlAb' })).toBe(true);
  });

  it('rejects non-shared or missing descriptions', () => {
    expect(isSharedProject({ description: '' })).toBe(false);
    expect(isSharedProject({ description: 'notes' })).toBe(false);
    expect(isSharedProject(null)).toBe(false);
    expect(isSharedProject(undefined)).toBe(false);
  });
});
