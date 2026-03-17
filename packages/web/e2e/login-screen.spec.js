import { expect, test } from '@playwright/test';

test('shows a responsive login screen for signed-out users', async ({ page }) => {
  const pageErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('crash', () => {
    pageErrors.push('Page crashed');
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#auth-gate')).toBeVisible();
  await expect(page.locator('#login-panel')).toBeVisible();
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#login-username')).toBeEditable();
  await expect(page.locator('#app-shell')).toBeHidden();

  await page.locator('#login-username').fill('smoke-user');
  await expect(page.locator('#login-username')).toHaveValue('smoke-user');

  await page.waitForTimeout(1500);

  await expect(page.locator('#login-password')).toBeEditable();
  await page.locator('#login-password').fill('smoke-password');
  await expect(page.locator('#login-password')).toHaveValue('smoke-password');

  expect(pageErrors).toEqual([]);
});
