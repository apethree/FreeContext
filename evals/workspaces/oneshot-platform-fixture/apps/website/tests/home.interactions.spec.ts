import { expect, test } from '@playwright/test';

test.describe('home interactions', () => {
  test('floating nav and list-first layout render expected primary actions', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'CapZero' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show Do anything' })).toBeVisible();
    await expect(page.locator('.home-usecase-item.is-active .home-usecase-item-body')).toContainText('acts, books, pays');
  });

  test('scenario buttons update the active quote and mock command', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Show Pay my mortgage' }).click();
    await expect(page.locator('.home-usecase-item.is-active .home-usecase-item-title')).toContainText('Pay my mortgage');
    await expect(page.locator('#window-command')).toContainText('Pay my mortgage this month');

    await page.getByRole('button', { name: 'Show Book flights' }).click();
    await expect(page.locator('.home-usecase-item.is-active .home-usecase-item-title')).toContainText('Book flights');
    await expect(page.locator('#window-steps')).toContainText('Tickets booked and calendar updated');
  });

  test('focus wheel applies depth classes around centered selection', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home-usecase-item.depth--0')).toHaveCount(1);
    await expect(page.locator('.home-usecase-item.depth--1')).toHaveCount(2);
    await expect(page.locator('.home-usecase-item.depth--2')).toHaveCount(2);
    await expect(page.locator('.home-usecase-item.depth--3')).toHaveCount(2);
    await expect(page.locator('.home-usecase-item.depth--4')).toHaveCount(2);
  });

  test('right panel transition class toggles during scenario change', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('.home-window');
    await page.getByRole('button', { name: 'Show Pay my mortgage' }).click();
    await expect(panel).toHaveClass(/is-transitioning/);
    await expect(panel).not.toHaveClass(/is-transitioning/);
  });
});
