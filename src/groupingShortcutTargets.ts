export const groupingShortcutTargetProps = {
  'data-allow-grouping-shortcuts': 'true',
} as const;

const GROUPING_SHORTCUT_TARGET_SELECTOR = '[data-allow-grouping-shortcuts="true"]';

export function isEditableShortcutTarget(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement;
}

export function shouldAllowGroupingShortcutFromTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(GROUPING_SHORTCUT_TARGET_SELECTOR));
}
