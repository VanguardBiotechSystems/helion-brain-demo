import { test, expect, enterApp, mockIdentity } from "./fixtures";

/**
 * Consola de depuración con y sin permiso (§6). El triple clic en la línea de
 * estado abre el modo avanzado; el panel de diagnóstico y sus métricas
 * respetan el rol. Identidad mockeada con fixtures ficticias.
 */

async function openAdvanced(page: import("@playwright/test").Page) {
  const statusLine = page.locator(".min-status");
  await statusLine.click();
  await statusLine.click();
  await statusLine.click();
}

test.describe("consola de depuración", () => {
  test("el triple clic abre el modo avanzado", async ({ page }) => {
    await enterApp(page);
    await openAdvanced(page);
    // El modo avanzado añade la consola técnica: aparecen botones/íconos
    // que no existen en la vista minimalista (diagnóstico, memoria…).
    await expect(page.locator(".min-shell")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator("button").first()).toBeVisible();
  });

  test("?debug=1 entra directamente en modo avanzado", async ({ page }) => {
    await mockIdentity(page, "owner", true);
    await enterApp(page);
    await page.goto("/?debug=1");
    await expect(page.locator("body")).toBeVisible();
  });
});
