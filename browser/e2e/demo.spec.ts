import { expect, test } from '@playwright/test';

test('opens a real practice lesson without requesting the camera', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Stillpoint/);
  await expect(page.getByRole('heading', { name: 'A little less clicking. A little more learning.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable camera', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Resume automatically' })).not.toBeChecked();
  await expect(page.getByText('Camera off', { exact: true })).toBeVisible();
});
