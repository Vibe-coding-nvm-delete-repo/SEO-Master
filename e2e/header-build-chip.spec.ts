import { test, expect } from '@playwright/test';
import { openQaScenario } from './contentPipelineQa';

test('build chip shows latest bulk update details', async ({ page }) => {
  await openQaScenario(page, 'build-chip');
  const chip = page.getByTestId('build-chip');
  await expect(chip).toBeVisible();
  await chip.hover();
  await expect(page.getByText('Build Info')).toBeVisible();
  await expect(page.getByText('Latest update:')).toBeVisible();
  await expect(page.getByText('Seeded content pipeline QA scenarios.')).toBeVisible();
});
