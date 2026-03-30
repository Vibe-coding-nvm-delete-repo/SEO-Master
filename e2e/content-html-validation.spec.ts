import { test, expect } from '@playwright/test';
import { openQaScenario, rowByText } from './contentPipelineQa';

test('HTML generation validates output immediately and fails invalid rows', async ({ page }) => {
  await openQaScenario(page, 'html-validation');
  await page.getByTestId('content-view-h2-html').click();

  const validRow = rowByText(page, 'What Are Installment Loans?', 'content-panel-h2-html');
  const invalidRow = rowByText(page, 'When Do Installment Loans Make Sense?', 'content-panel-h2-html');

  await expect(validRow).toContainText('Pass', { timeout: 15000 });
  await expect(validRow).toContainText('generated', { timeout: 15000 });

  await expect(invalidRow).toContainText('Fail', { timeout: 15000 });
  await expect(invalidRow).toContainText('error', { timeout: 15000 });
  await expect(invalidRow).toContainText('<h4>bad html</h4>');
});
