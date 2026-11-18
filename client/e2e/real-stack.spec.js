import { expect, test } from '@playwright/test';

// Runs against the real Docker Compose stack (client on :8080, API on :4000, PostgreSQL + MongoDB).
//   REAL_STACK=1 npx playwright test e2e/real-stack.spec.js
// Uses the sample student imported from db/seed/students.sample.csv and the dev users from seed.js.
test.skip(process.env.REAL_STACK !== '1', 'set REAL_STACK=1 to run against the Docker Compose stack');

async function signIn(page, username, password) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tap card' })).toBeVisible();
}

test('staff taps a real card, records a visit (and confirms a duplicate on a rerun)', async ({ page }) => {
  await signIn(page, 'staff', 'staff123');

  await page.keyboard.type('SAMPLE0001');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'Sample Alpha' })).toBeVisible();
  await expect(page.getByText('251210801')).toBeVisible();

  await page.getByLabel('Health issue').selectOption({ label: 'Fever' });
  await page.getByLabel('Remedy (medicine)').fill('Paracetamol 500mg');
  await page.getByRole('button', { name: 'Save visit' }).click();

  // A second run within the duplicate window asks first.
  const dialog = page.getByRole('alertdialog', { name: 'Possible duplicate visit' });
  await dialog.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: 'Save another' }).click();
  }

  await expect(page.getByText('Visit saved for Sample Alpha')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tap card' })).toBeVisible();
});

test('admin searches the real patient, opens the record and the visit history', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await page.getByRole('link', { name: 'Patients' }).click();

  await page.getByLabel('Search by name, roll number or phone').fill('Sample Alpha');
  await expect(page.getByRole('link', { name: 'Sample Alpha' })).toBeVisible();
  await page.getByRole('link', { name: 'Sample Alpha' }).click();

  await expect(page.getByRole('heading', { name: 'Patient record' })).toBeVisible();
  await expect(page.getByText('Card ID: SAMPLE0001')).toBeVisible();

  await page.getByRole('link', { name: 'View visit history' }).click();
  await expect(page.getByRole('heading', { name: 'Visit history' })).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
});

test('admin sees every report rendered from the real databases', async ({ page }) => {
  await signIn(page, 'admin', 'admin123');
  await page.getByRole('link', { name: 'Reports' }).click();

  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  for (const title of [
    'Most common health issues', 'Peak hours', 'Visits over time', 'Visits by branch', 'Visits by admission batch', 'Most frequent visitors',
  ]) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
  await expect(page.getByRole('img', { name: 'Visits by hour of day, 24-hour clock' })).toBeVisible();
});
