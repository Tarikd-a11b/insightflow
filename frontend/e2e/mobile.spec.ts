import { expect, test } from "@playwright/test";
import { mockApi, openDemo } from "./mock-api";

test("telefon genişliğinde sayfa yatay kaymaz; panel tam ekran açılır", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await openDemo(page, "Gelir & gider");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.locator("[data-ledger]").click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual((page.viewportSize()?.width ?? 0) - 1);
});
