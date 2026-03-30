import { test, expect } from '@playwright/test';
import {
  openQaScenario,
  openSharedLog,
  rowByText,
  waitForActionDrained,
  waitForActionEnabled,
  waitForRowStatus,
} from './contentPipelineQa';

test('content pipeline tabs share API key and log stream', async ({ page }) => {
  await openQaScenario(page, 'full-flow-actions');

  await page.getByTestId('content-view-h2-content').click();
  const h2Panel = page.getByTestId('content-panel-h2-content');
  await h2Panel.getByRole('button', { name: 'Settings' }).click();
  await h2Panel.getByTestId('openrouter-api-key').fill('sk-shared-qa-key');
  await h2Panel.getByRole('button', { name: 'Settings' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kwg_generate_cache:apiKeyShared'))).toBe('sk-shared-qa-key');
  await (await waitForActionEnabled(h2Panel, 'generate-action-generate')).click();
  await waitForRowStatus(rowByText(page, 'What Are Installment Loans?', 'content-panel-h2-content'), 'generated');
  await waitForActionDrained(h2Panel, 'generate-action-generate');

  await page.getByTestId('content-view-rating').click();
  const ratingPanel = page.getByTestId('content-panel-rating');
  await ratingPanel.getByRole('button', { name: 'Settings' }).click();
  await expect(ratingPanel.getByTestId('openrouter-api-key')).toHaveValue('sk-shared-qa-key');
  const generatedRatingRow = rowByText(page, 'What Are Installment Loans?', 'content-panel-rating');
  await (await waitForActionEnabled(ratingPanel, 'generate-action-rate')).click();
  await waitForRowStatus(generatedRatingRow, 'generated');
  await waitForActionDrained(ratingPanel, 'generate-action-rate');

  await page.getByTestId('content-view-h2-html').click();
  const htmlPanel = page.getByTestId('content-panel-h2-html');
  await htmlPanel.getByRole('button', { name: 'Settings' }).click();
  await expect(htmlPanel.getByTestId('openrouter-api-key')).toHaveValue('sk-shared-qa-key');
  await (await waitForActionEnabled(htmlPanel, 'generate-action-generate-html')).click();
  await waitForActionDrained(htmlPanel, 'generate-action-generate-html');

  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  const logTable = await openSharedLog(page);
  const completedRows = logTable.locator('tbody tr').filter({ hasText: 'generate complete' });
  expect(await completedRows.count()).toBeGreaterThanOrEqual(2);
});
