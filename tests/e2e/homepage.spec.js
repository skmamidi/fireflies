const { test, expect } = require("@playwright/test");

test("homepage serves the academy shell", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });

  expect(response && response.ok()).toBeTruthy();
  await expect(page).toHaveTitle("Global Firefly Academy");
  await expect(page.locator("#root")).toBeAttached();
});
