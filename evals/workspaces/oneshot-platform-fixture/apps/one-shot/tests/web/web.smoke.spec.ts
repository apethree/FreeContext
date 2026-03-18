import { expect, test } from "@playwright/test";

test("renders web shell without Electron context", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root")).toBeVisible();
  await expect(page).toHaveTitle(/One Shot/i);
});
