import { test, expect } from '@playwright/test';
import {
  openQaScenario,
  openSharedLog,
  rowByText,
  switchToContentSubtab,
  waitForActionDrained,
  waitForActionEnabled,
  waitForRowStatus,
} from './contentPipelineQa';

test('[generate-settings-two-session][generate-rows-two-session][generate-logs-two-session][generate-pipeline-settings-two-session] two QA pages converge on shared settings, rows, logs, and pipeline settings', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await openQaScenario(pageA, 'two-session-collab');
  await openQaScenario(pageB, 'two-session-collab');

  await switchToContentSubtab(pageA, {
    buttonTestId: 'content-view-h2-content',
    subtab: 'h2-body',
    panelTestId: 'content-panel-h2-content',
  });
  await switchToContentSubtab(pageB, {
    buttonTestId: 'content-view-h2-content',
    subtab: 'h2-body',
    panelTestId: 'content-panel-h2-content',
  });

  const h2PanelA = pageA.getByTestId('content-panel-h2-content');
  const h2PanelB = pageB.getByTestId('content-panel-h2-content');

  const rowA = rowByText(pageA, 'What Are Installment Loans?', 'content-panel-h2-content');
  const rowB = rowByText(pageB, 'What Are Installment Loans?', 'content-panel-h2-content');

  await (await waitForActionEnabled(h2PanelA, 'generate-action-generate')).click();
  await waitForRowStatus(rowA, 'generated');
  await waitForActionDrained(h2PanelA, 'generate-action-generate');
  await waitForRowStatus(rowB, 'generated');

  const logTableB = await openSharedLog(pageB);
  const completedRows = logTableB.locator('tbody tr').filter({ hasText: 'generate complete' });
  expect(await completedRows.count()).toBeGreaterThanOrEqual(1);

  await context.close();
});
