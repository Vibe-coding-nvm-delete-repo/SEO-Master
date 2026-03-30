import { expect, Locator, Page } from '@playwright/test';

export async function openQaScenario(page: Page, scenario = 'default') {
  const baseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://127.0.0.1:3000';
  await page.goto(`${baseUrl}/__qa/content-pipeline?scenario=${scenario}`);
  await expect(page).toHaveURL(new RegExp(`/__qa/content-pipeline\\?scenario=${scenario}`));
  await expect(page.getByText('Preparing content pipeline QA harness...')).toBeHidden({ timeout: 15000 });
  await expect(page.getByTestId('content-view-h2-content')).toBeVisible();
}

export async function expectSubtabQuery(page: Page, subtab?: string) {
  await expect.poll(() =>
    page.evaluate(() => new URLSearchParams(window.location.search).get('subtab')),
  ).toBe(subtab ?? null);
}

export async function switchToContentSubtab(page: Page, opts: {
  buttonTestId: string;
  subtab?: string;
  panelTestId?: string;
}) {
  const button = page.getByTestId(opts.buttonTestId).first();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expectSubtabQuery(page, opts.subtab);
  if (opts.panelTestId) {
    await expectContentPanelVisible(page, opts.panelTestId);
  }
}

export async function expectContentPanelVisible(page: Page, panelTestId: string) {
  const panel = page.getByTestId(panelTestId);
  await expect(panel).toBeVisible();
}

export function generateRows(scope: Page | Locator) {
  return scope.locator('tr[data-testid^="generate-row-"]:visible:not([data-testid^="generate-row-row_"])');
}

export async function expectGenerateRowCount(scope: Page | Locator, count: number) {
  await expect(generateRows(scope)).toHaveCount(count);
}

export function rowByText(page: Page, text: string, scope?: string) {
  const root = scope ? page.getByTestId(scope) : page;
  return root.locator('tr[data-testid^="generate-row-"]:visible').filter({ hasText: text }).first();
}

export async function waitForRowStatus(row: ReturnType<typeof rowByText>, status: 'pending' | 'generated' | 'error') {
  await expect(row.locator('[data-testid^="row-status-"]')).toHaveText(status, { timeout: 15000 });
}

export async function waitForRowInputReady(row: ReturnType<typeof rowByText>) {
  await expect(row.locator('input')).toHaveValue(/.+/, { timeout: 15000 });
}

export async function expectRowUnlocked(row: ReturnType<typeof rowByText>) {
  await expect(row.locator('[data-testid^="locked-row-"]')).toHaveCount(0);
  await expect(row.locator('input')).toHaveValue(/.+/);
}

export async function expectRowLocked(row: ReturnType<typeof rowByText>) {
  await expect(row.locator('[data-testid^="locked-row-"]')).toBeVisible();
  await expect(row.locator('input')).toHaveValue('');
}

export async function waitForActionEnabled(scope: Page | Locator, testId: string) {
  const button = scope.getByTestId(testId);
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled({ timeout: 15000 });
  return button;
}

export async function waitForActionDisabled(scope: Page | Locator, testId: string) {
  const button = scope.getByTestId(testId);
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  return button;
}

export async function waitForActionDrained(scope: Page | Locator, testId: string) {
  const button = scope.getByTestId(testId);
  await expect(button).toBeVisible({ timeout: 15000 });
  await expect(button).toBeDisabled({ timeout: 15000 });
  return button;
}

export async function openSharedLog(page: Page) {
  const tab = page.locator('[data-testid="shared-log-tab"]:visible').first();
  await tab.click();
  const table = page.locator('[data-testid="generate-log-table"]:visible').first();
  await expect(table).toBeVisible();
  return table;
}

export function finalPagesRow(page: Page, rowId: string) {
  return page.getByTestId(`final-pages-row-${rowId}`);
}
