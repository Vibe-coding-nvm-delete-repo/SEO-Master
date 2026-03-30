import { test, expect } from '@playwright/test';
import { openQaScenario, rowByText } from './contentPipelineQa';

test('Redo Rated 3/4 resets only low-rated H2 rows', async ({ page }) => {
  await openQaScenario(page, 'rating-rewrite');
  await page.getByTestId('content-view-h2-content').click();
  const panel = 'content-panel-h2-content';

  const safeRow = rowByText(page, 'What Are Installment Loans?', panel);
  const rating3Row = rowByText(page, 'When Do Installment Loans Make Sense?', panel);
  const rating4Row = rowByText(page, 'What Risks Should You Watch For?', panel);

  await expect(safeRow).toContainText('2', { timeout: 15000 });
  await expect(rating3Row).toContainText('3', { timeout: 15000 });
  await expect(rating4Row).toContainText('4', { timeout: 15000 });

  await page.getByTestId('redo-rated-3-4').click();

  await expect(safeRow).toContainText('generated');
  await expect(rating3Row).toContainText('pending');
  await expect(rating4Row).toContainText('pending');
});
