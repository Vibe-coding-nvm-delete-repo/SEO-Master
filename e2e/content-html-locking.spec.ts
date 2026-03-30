import { test, expect } from '@playwright/test';
import { expectGenerateRowCount, expectRowLocked, expectRowUnlocked, openQaScenario, rowByText } from './contentPipelineQa';

test('H2 Content HTML locks only rows with unacceptable or missing ratings', async ({ page }) => {
  await openQaScenario(page, 'html-locking');
  await page.getByTestId('content-view-h2-html').click();
  const panel = page.getByTestId('content-panel-h2-html');

  await expectGenerateRowCount(panel, 5);

  const acceptedRow = rowByText(page, 'What Are Installment Loans?', 'content-panel-h2-html');
  const alsoAcceptedRow = rowByText(page, 'When Do Installment Loans Make Sense?', 'content-panel-h2-html');
  const autoAcceptedRow = rowByText(page, 'What Risks Should You Watch For?', 'content-panel-h2-html');
  const blockedRow = rowByText(page, 'How Can You Compare Lenders Safely?', 'content-panel-h2-html');
  const missingRatingRow = rowByText(page, 'What Should You Check Before Applying?', 'content-panel-h2-html');

  await expectRowUnlocked(acceptedRow);
  await expectRowUnlocked(alsoAcceptedRow);
  await expectRowUnlocked(autoAcceptedRow);
  await expectRowLocked(blockedRow);
  await expectRowLocked(missingRatingRow);
});
