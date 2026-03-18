import { expect, test } from '@playwright/test';

test.describe('news interactions', () => {
  test('category tab updates URL and active state', async ({ page }) => {
    await page.goto('/news/');
    await page.getByRole('tab', { name: 'Security' }).click();
    await expect(page).toHaveURL(/category=security/);
    await expect(page.getByRole('tab', { name: 'Security' })).toHaveAttribute('aria-selected', 'true');
  });

  test('sort switch updates URL', async ({ page }) => {
    await page.goto('/news/');
    await page.getByRole('button', { name: 'Open sort options' }).click();
    await page.getByRole('button', { name: 'Oldest first' }).click();
    await expect(page).toHaveURL(/sort=oldest/);
  });

  test('display mode toggles list/grid and keeps URL in sync', async ({ page }) => {
    await page.goto('/news/');
    await page.getByLabel('List view').click();
    await expect(page).toHaveURL(/display=list/);
    await expect(page.locator('#news-list-feed')).toBeVisible();
    await page.getByLabel('Grid view').click();
    await expect(page).toHaveURL(/display=grid/);
    await expect(page.locator('#news-list-feed')).toBeHidden();
  });

  test('filter applies tags and clear removes filter query', async ({ page }) => {
    await page.goto('/news/');
    await page.getByRole('button', { name: 'Open filter options' }).click();
    const checkbox = page.locator('input[name="filter"]').first();
    await checkbox.check();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/filter=/);
    await page.getByRole('button', { name: 'Open filter options' }).click();
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page).not.toHaveURL(/filter=/);
  });

  test('browser back and forward preserves query-driven state', async ({ page }) => {
    await page.goto('/news/');
    await page.getByRole('tab', { name: 'Developer' }).click();
    await page.getByLabel('List view').click();
    await expect(page).toHaveURL(/category=developer/);
    await expect(page).toHaveURL(/display=list/);

    await page.goBack();
    await expect(page).toHaveURL(/display=grid/);
    await page.goForward();
    await expect(page).toHaveURL(/display=list/);
  });
});
