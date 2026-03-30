import { test, expect } from '@playwright/test';
import {
  finalPagesRow,
  openQaScenario,
  switchToContentSubtab,
  waitForActionDisabled,
} from './contentPipelineQa';

test('downstream content stages stay blocked when upstream outputs are missing', async ({ page }) => {
  await openQaScenario(page, 'missing-upstream');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-quick-answer-html',
    subtab: 'quick-answer-html',
    panelTestId: 'content-panel-quick-answer-html',
  });
  const quickAnswerHtmlPanel = page.getByTestId('content-panel-quick-answer-html');
  await waitForActionDisabled(quickAnswerHtmlPanel, 'generate-action-generate-html');

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-metas-slug-ctas',
    subtab: 'metas-slug-ctas',
    panelTestId: 'content-panel-metas-slug-ctas',
  });
  const metasPanel = page.getByTestId('content-panel-metas-slug-ctas');
  await waitForActionDisabled(metasPanel, 'generate-action-generate-metas');
  await expect(metasPanel.getByRole('button', { name: /^Slug \(0\)$/ })).toBeDisabled();
  await expect(metasPanel.getByRole('button', { name: /^CTAs \(0\)$/ })).toBeDisabled();

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-tips-redflags',
    subtab: 'tips-redflags',
    panelTestId: 'content-panel-tips-redflags',
  });
  const tipsPanel = page.getByTestId('content-panel-tips-redflags');
  await waitForActionDisabled(tipsPanel, 'generate-action-generate-pro-tip');
  await expect(tipsPanel.getByRole('button', { name: /^Red Flag \(0\)$/ })).toBeDisabled();
  await expect(tipsPanel.getByRole('button', { name: /^Key Takeaways \(0\)$/ })).toBeDisabled();

  await switchToContentSubtab(page, {
    buttonTestId: 'content-view-final-pages',
    subtab: 'final-pages',
    panelTestId: 'content-panel-final-pages',
  });
  await expect(page.getByText('1 rows missing required fields')).toBeVisible();
  await expect(finalPagesRow(page, 'page_row_1')).toContainText('Can You Get Installment Loans?');
});
