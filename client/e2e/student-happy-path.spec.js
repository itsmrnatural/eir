import { expect, test } from '@playwright/test';

// Runs against `npm run dev:mock` (MSW answers the API), so no server or database is needed.
test('student happy path: sign in, tap card, record visit, ready for the next patient', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('staff');
  await page.getByLabel('Password').fill('staff123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Tap card' })).toBeVisible();
  await expect(page.getByText('Reader ready')).toBeVisible();

  // A USB reader types the tag very fast and presses Enter. Playwright's keyboard does the same.
  await page.keyboard.type('RFID-0001');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Aanya Demo' })).toBeVisible();
  await expect(page.getByText('251210001')).toBeVisible();

  await page.getByLabel('Health issue').selectOption({ label: 'Fever' });
  await page.getByLabel('Remedy (medicine)').fill('Paracetamol 500mg');
  await page.getByRole('button', { name: 'Save visit' }).click();

  await expect(page.getByText('Visit saved for Aanya Demo')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tap card' })).toBeVisible();
});
