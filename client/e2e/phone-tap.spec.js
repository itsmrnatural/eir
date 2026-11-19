import { expect, test } from '@playwright/test';

// Demo only. The phone card reader, end to end, against the running stack:
//   phone page (Web NFC)  ->  POST /api/v1/demo/tap  ->  SSE  ->  Record visit screen  ->  real patient lookup.
//
// The server must run with DEMO_TAP=1 and DEMO_TAP_KEY=<key>; the card must exist in the database
// (the sample student from db/seed/students.sample.csv uses SAMPLE0001).
//
//   REAL_STACK=1 PHONE_TAP=1 DEMO_TAP_KEY=<key> npx playwright test e2e/phone-tap.spec.js
//
// A desktop browser has no NFC chip, so a stand-in NDEFReader is injected into the phone page.
// It behaves like Chrome's: scan() resolves, then the page receives 'reading' events with a serialNumber.
// What this cannot prove is the real chip and Chrome's permission prompt: test those once on the phone.
test.skip(process.env.PHONE_TAP !== '1', 'set PHONE_TAP=1 (and REAL_STACK=1) to run against a server started with DEMO_TAP=1');

const KEY = process.env.DEMO_TAP_KEY ?? '';
const CLIENT = process.env.REAL_STACK_URL ?? 'http://localhost:8080';
const API = process.env.API_URL ?? 'http://localhost:4000';
const CARD = process.env.TAP_RFID ?? 'SAMPLE0001';
const NAME = process.env.TAP_NAME ?? 'Sample Alpha';

function fakeNfc() {
  class NDEFReader extends EventTarget {
    async scan() {
      window.__nfc = this;
    }
    tap(serialNumber) {
      const event = new Event('reading');
      event.serialNumber = serialNumber;
      this.dispatchEvent(event);
    }
  }
  window.NDEFReader = NDEFReader;
}

async function openScreen(page) {
  await page.goto(`${CLIENT}/?demo=${KEY}`);
  await page.getByLabel('Username').fill('staff');
  await page.getByLabel('Password').fill('staff123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tap card' })).toBeVisible();
  await expect(page.getByText(/phone reader connected/i)).toBeVisible();
  expect(page.url()).not.toContain(KEY); // the key is removed from the address bar
}

async function openPhone(browser, { key = KEY, nfc = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  if (nfc) await context.addInitScript(fakeNfc);
  const phone = await context.newPage();
  await phone.goto(`${API}/demo/?key=${encodeURIComponent(key)}`);
  return { phone, context };
}

test('a card tapped on the phone appears on the Record visit screen', async ({ page, browser }) => {
  await openScreen(page);
  const { phone, context } = await openPhone(browser);

  await expect(phone.getByLabel('Demo key')).toHaveValue(KEY);
  expect(phone.url()).not.toContain(KEY);
  await phone.getByRole('button', { name: 'Start reader' }).click();
  await expect(phone.getByRole('status')).toContainText('Ready');

  await phone.evaluate((serial) => window.__nfc.tap(serial), CARD);
  await expect(phone.getByRole('status')).toContainText(`Sent ${CARD}`);
  await expect(phone.getByRole('status')).toContainText('1 screen');
  await expect(phone.locator('#recent li').first()).toContainText(CARD);

  // the laptop screen did the normal student lookup
  await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
  await expect(page.getByText(/recorded automatically/i)).toBeVisible();
  await context.close();
});

test('an unknown card gives the usual "card not registered" message on the laptop', async ({ page, browser }) => {
  await openScreen(page);
  const { phone, context } = await openPhone(browser);
  await phone.getByRole('button', { name: 'Start reader' }).click();
  await phone.evaluate(() => window.__nfc.tap('04:DE:AD:BE:EF:00:11'));
  await expect(page.getByText(/card not registered/i)).toBeVisible();
  await expect(page.getByText('Card ID: 04:DE:AD:BE:EF:00:11')).toBeVisible();
  await context.close();
});

test('the phone says so when no laptop screen is listening', async ({ browser }) => {
  const { phone, context } = await openPhone(browser);
  await phone.getByRole('button', { name: 'Start reader' }).click();
  await phone.evaluate((serial) => window.__nfc.tap(serial), CARD);
  await expect(phone.getByRole('status')).toContainText('no screen is listening');
  await context.close();
});

test('a wrong demo key is refused on the phone and on the laptop', async ({ page, browser }) => {
  const { phone, context } = await openPhone(browser, { key: 'definitely-wrong-key' });
  await phone.getByRole('button', { name: 'Start reader' }).click();
  await phone.evaluate((serial) => window.__nfc.tap(serial), CARD);
  await expect(phone.getByRole('status')).toContainText('Wrong demo key');
  await context.close();

  await page.goto(`${CLIENT}/?demo=definitely-wrong-key`);
  await page.getByLabel('Username').fill('staff');
  await page.getByLabel('Password').fill('staff123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/phone reader unavailable/i)).toBeVisible();
});

test('a browser without Web NFC gets a clear message instead of a broken page', async ({ browser }) => {
  const { phone, context } = await openPhone(browser, { nfc: false });
  await phone.getByRole('button', { name: 'Start reader' }).click();
  await expect(phone.getByRole('status')).toContainText('Web NFC is not available');
  await context.close();
});

test('the app does nothing about phone readers without a demo key', async ({ page }) => {
  await page.goto(`${CLIENT}/login`);
  await page.getByLabel('Username').fill('staff');
  await page.getByLabel('Password').fill('staff123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tap card' })).toBeVisible();
  await expect(page.getByText(/phone reader/i)).toHaveCount(0);
});
