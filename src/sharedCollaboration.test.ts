import { describe, expect, it } from 'vitest';
import {
  getSharedActionRegistryEntry,
  isProjectScopedDocId,
  requireAppSettingsRegistryEntry,
} from './sharedCollaboration';

describe('sharedCollaboration registry', () => {
  it('resolves global shared app-settings docs', () => {
    const entry = requireAppSettingsRegistryEntry('group_review_settings', 'doc');
    expect(entry.id).toBe('settings.group_review');
    expect(entry.scope).toBe('global_shared');
  });

  it('resolves project-scoped generate rows docs', () => {
    const entry = requireAppSettingsRegistryEntry('project_proj-1__generate_rows_page_names', 'rows');
    expect(entry.id).toBe('generate.rows');
    expect(entry.scope).toBe('project_generate_content');
    expect(isProjectScopedDocId('project_proj-1__generate_rows_page_names')).toBe(true);
  });

  it('rejects unregistered docs', () => {
    expect(() => requireAppSettingsRegistryEntry('unknown_doc_id', 'doc')).toThrow(
      'Unregistered app settings doc',
    );
  });

  it('exposes registered shared actions by id', () => {
    const entry = getSharedActionRegistryEntry('project.metadata');
    expect(entry.label).toBe('Project metadata');
  });
});
