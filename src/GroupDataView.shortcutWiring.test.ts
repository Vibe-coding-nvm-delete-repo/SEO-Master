import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inputHasShortcutOptIn(source: string, placeholder: string): boolean {
  const escapedPlaceholder = escapeRegex(placeholder);
  const pattern = new RegExp(
    `<input(?=[^>]*\\{\\.\\.\\.groupingShortcutTargetProps\\})(?=[^>]*placeholder="${escapedPlaceholder}")[^>]*>`,
    's',
  );
  return pattern.test(source);
}

describe('GroupDataView shortcut wiring', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/GroupDataView.tsx'), 'utf8');

  it('keeps Shift+1 enabled from the Group name input', () => {
    expect(inputHasShortcutOptIn(source, 'Group name...')).toBe(true);
  });

  it('keeps Shift+1 enabled from the token search input', () => {
    expect(inputHasShortcutOptIn(source, 'Search tokens (comma-separated)...')).toBe(true);
  });
});
