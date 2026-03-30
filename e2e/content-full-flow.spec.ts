import { test, expect } from '@playwright/test';
import {
  expectContentPanelVisible,
  expectGenerateRowCount,
  expectSubtabQuery,
  finalPagesRow,
  openQaScenario,
  openSharedLog,
  rowByText,
  switchToContentSubtab,
  waitForActionDrained,
  waitForActionEnabled,
  waitForRowInputReady,
  waitForRowStatus,
} from './contentPipelineQa';

test('content pipeline happy path walks the subtabs and produces a ready final page', async ({ page }) => {
  await openQaScenario(page, 'full-flow-actions');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-overview',
    panelTestId: 'content-panel-overview',
  });
  await page.getByTestId('overview-stage-h2-body').click();
  await expectContentPanelVisible(page, 'content-panel-h2-content');
  await expectSubtabQuery(page, 'h2-body');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-primary',
    subtab: 'pages',
  });
  await expectGenerateRowCount(page, 1);
  await expect(rowByText(page, 'installment loans')).toContainText('generated');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-h2s',
    subtab: 'h2s',
  });
  await expect(rowByText(page, 'installment loans')).toContainText('generated');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-h2-qa',
    subtab: 'h2-qa',
  });
  await expect(rowByText(page, 'installment loans')).toContainText('generated');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-page-guide',
    subtab: 'page-guide',
  });
  await expect(rowByText(page, 'installment loans')).toContainText('generated');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-h2-content',
    subtab: 'h2-body',
    panelTestId: 'content-panel-h2-content',
  });
  const h2Panel = page.getByTestId('content-panel-h2-content');
  await h2Panel.getByRole('button', { name: 'Settings' }).click();
  await h2Panel.getByTestId('openrouter-api-key').fill('sk-shared-qa-key');
  await h2Panel.getByRole('button', { name: 'Settings' }).click();
  const h2Row = rowByText(page, 'What Are Installment Loans?', 'content-panel-h2-content');
  await expectGenerateRowCount(h2Panel, 5);
  await waitForRowStatus(h2Row, 'pending');
  await (await waitForActionEnabled(h2Panel, 'generate-action-generate')).click();
  await waitForRowStatus(h2Row, 'generated');
  await waitForActionDrained(h2Panel, 'generate-action-generate');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-rating',
    subtab: 'h2-rate',
    panelTestId: 'content-panel-rating',
  });
  const ratingPanel = page.getByTestId('content-panel-rating');
  const ratingRow = rowByText(page, 'What Are Installment Loans?', 'content-panel-rating');
  await (await waitForActionEnabled(ratingPanel, 'generate-action-rate')).click();
  await waitForRowStatus(ratingRow, 'generated');
  await expect(ratingRow.locator('[data-testid^="ratingScore-"]')).toHaveText('2');
  await waitForActionDrained(ratingPanel, 'generate-action-rate');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-h2-html',
    subtab: 'h2-body-html',
    panelTestId: 'content-panel-h2-html',
  });
  const h2HtmlPanel = page.getByTestId('content-panel-h2-html');
  const h2HtmlRow = rowByText(page, 'What Are Installment Loans?', 'content-panel-h2-html');
  await waitForRowInputReady(h2HtmlRow);
  await (await waitForActionEnabled(h2HtmlPanel, 'generate-action-generate-html')).click();
  await waitForRowStatus(h2HtmlRow, 'generated');
  await expect(h2HtmlRow.locator('[data-testid^="validationStatus-"]')).toHaveText('Pass');
  await waitForActionDrained(h2HtmlPanel, 'generate-action-generate-html');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-h2-summary',
    subtab: 'h2-summ',
    panelTestId: 'content-panel-h2-summary',
  });
  const summaryPanel = page.getByTestId('content-panel-h2-summary');
  const summaryRow = rowByText(page, 'What Are Installment Loans?', 'content-panel-h2-summary');
  await (await waitForActionEnabled(summaryPanel, 'generate-action-generate-summary')).click();
  await waitForRowStatus(summaryRow, 'generated');
  await waitForActionDrained(summaryPanel, 'generate-action-generate-summary');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-h1-body',
    subtab: 'h1-body',
    panelTestId: 'content-panel-h1-body',
  });
  const h1BodyPanel = page.getByTestId('content-panel-h1-body');
  const h1BodyRow = rowByText(page, 'Can You Get Installment Loans?', 'content-panel-h1-body');
  await expectGenerateRowCount(h1BodyPanel, 1);
  await (await waitForActionEnabled(h1BodyPanel, 'generate-action-generate-h1')).click();
  await waitForRowStatus(h1BodyRow, 'generated');
  await waitForActionDrained(h1BodyPanel, 'generate-action-generate-h1');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-h1-html',
    subtab: 'h1-body-html',
    panelTestId: 'content-panel-h1-html',
  });
  const h1HtmlPanel = page.getByTestId('content-panel-h1-html');
  const h1HtmlRow = rowByText(page, 'Can You Get Installment Loans?', 'content-panel-h1-html');
  await expectGenerateRowCount(h1HtmlPanel, 1);
  await waitForRowInputReady(h1HtmlRow);
  await (await waitForActionEnabled(h1HtmlPanel, 'generate-action-generate-html')).click();
  await waitForRowStatus(h1HtmlRow, 'generated');
  await expect(h1HtmlRow.locator('[data-testid^="validationStatus-"]')).toHaveText('Pass');
  await waitForActionDrained(h1HtmlPanel, 'generate-action-generate-html');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-quick-answer',
    subtab: 'quick-answer',
    panelTestId: 'content-panel-quick-answer',
  });
  const quickAnswerPanel = page.getByTestId('content-panel-quick-answer');
  const quickAnswerRow = rowByText(page, 'Can You Get Installment Loans?', 'content-panel-quick-answer');
  await expectGenerateRowCount(quickAnswerPanel, 1);
  await (await waitForActionEnabled(quickAnswerPanel, 'generate-action-generate-quick-answer')).click();
  await waitForRowStatus(quickAnswerRow, 'generated');
  await waitForActionDrained(quickAnswerPanel, 'generate-action-generate-quick-answer');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-quick-answer-html',
    subtab: 'quick-answer-html',
    panelTestId: 'content-panel-quick-answer-html',
  });
  const quickAnswerHtmlPanel = page.getByTestId('content-panel-quick-answer-html');
  const quickAnswerHtmlRow = rowByText(page, 'Can You Get Installment Loans?', 'content-panel-quick-answer-html');
  await expectGenerateRowCount(quickAnswerHtmlPanel, 1);
  await waitForRowInputReady(quickAnswerHtmlRow);
  await (await waitForActionEnabled(quickAnswerHtmlPanel, 'generate-action-generate-html')).click();
  await waitForRowStatus(quickAnswerHtmlRow, 'generated');
  await expect(quickAnswerHtmlRow.locator('[data-testid^="validationStatus-"]')).toHaveText('Pass');
  await waitForActionDrained(quickAnswerHtmlPanel, 'generate-action-generate-html');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-metas-slug-ctas',
    subtab: 'metas-slug-ctas',
    panelTestId: 'content-panel-metas-slug-ctas',
  });
  const metasPanel = page.getByTestId('content-panel-metas-slug-ctas');
  const metasRow = rowByText(page, 'Can You Get Installment Loans?', 'content-panel-metas-slug-ctas');
  await expectGenerateRowCount(metasPanel, 1);
  await (await waitForActionEnabled(metasPanel, 'generate-action-generate-metas')).click();
  await waitForRowStatus(metasRow, 'generated');
  await waitForActionDrained(metasPanel, 'generate-action-generate-metas');
  await (await waitForActionEnabled(metasPanel, 'generate-action-slug')).click();
  await waitForActionDrained(metasPanel, 'generate-action-slug');
  await metasPanel.getByTestId('content-view-slug').click();
  await waitForRowStatus(metasRow, 'generated');
  await expect(metasRow).toContainText('can-you-get-installment-loans');
  await (await waitForActionEnabled(metasPanel, 'generate-action-ctas')).click({ force: true });
  await waitForActionDrained(metasPanel, 'generate-action-ctas');
  await metasPanel.getByTestId('content-view-ctas').click();
  await waitForRowStatus(metasRow, 'generated');
  await expect(metasRow).toContainText('Review your options before you apply');
  await metasPanel.getByTestId('content-view-primary').click();

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-tips-redflags',
    subtab: 'tips-redflags',
    panelTestId: 'content-panel-tips-redflags',
  });
  const tipsPanel = page.getByTestId('content-panel-tips-redflags');
  const tipsRow = rowByText(page, 'Can You Get Installment Loans?', 'content-panel-tips-redflags');
  await expectGenerateRowCount(tipsPanel, 1);
  await (await waitForActionEnabled(tipsPanel, 'generate-action-generate-pro-tip')).click();
  await waitForRowStatus(tipsRow, 'generated');
  await waitForActionDrained(tipsPanel, 'generate-action-generate-pro-tip');
  await (await waitForActionEnabled(tipsPanel, 'generate-action-red-flag')).click();
  await waitForActionDrained(tipsPanel, 'generate-action-red-flag');
  await tipsPanel.getByTestId('content-view-red-flag').click();
  await waitForRowStatus(tipsRow, 'generated');
  await expect(tipsRow).toContainText('QA output');
  await (await waitForActionEnabled(tipsPanel, 'generate-action-key-takeaways')).click();
  await waitForActionDrained(tipsPanel, 'generate-action-key-takeaways');
  await tipsPanel.getByTestId('content-view-key-takeaways').click();
  await waitForRowStatus(tipsRow, 'generated');
  await expect(tipsRow).toContainText('QA output');
  await tipsPanel.getByTestId('content-view-primary').click();

  const logTable = await openSharedLog(page);
  const completedRows = logTable.locator('tbody tr').filter({ hasText: 'generate complete' });
  expect(await completedRows.count()).toBeGreaterThanOrEqual(11);

  await page.getByRole('button', { name: 'Final Pages', exact: true }).click();
  await expectSubtabQuery(page, 'final-pages');
  await expectContentPanelVisible(page, 'content-panel-final-pages');
  await expect(page.getByText('0 rows missing required fields')).toBeVisible();
  await expect(finalPagesRow(page, 'page_row_1')).toContainText('Can You Get Installment Loans?');
  await expect(finalPagesRow(page, 'page_row_1')).toContainText('Review your options before you apply');
});
