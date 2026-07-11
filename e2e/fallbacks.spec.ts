import { test, expect, enterApp, mockSessionDown, mockUsageLimited } from "./fixtures";

/**
 * Fallbacks honestos (§8) y estados de degradación (§6). El orbe y los
 * mensajes deben comunicar el problema en el tono de Helion, sin fingir que
 * todo funciona. Proveedores mockeados: cero llamadas reales.
 */

test.describe("degradación honesta", () => {
  test("estado inicial del orbe: presente y en espera", async ({ page }) => {
    await enterApp(page);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: /encender helion/i })).toBeVisible();
  });

  test("proveedor de sesión caído → mensaje honesto, no 'todo bien'", async ({ page }) => {
    await enterApp(page);
    await mockSessionDown(page);
    await page.getByRole("button", { name: /encender helion/i }).click();
    // Aparece un aviso honesto (banner/alerta); nunca un falso "correcto".
    await expect(page.locator(".error-banner, .min-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText(/todo funciona correctamente/i);
  });

  test("límite de uso alcanzado → mensaje honesto de parada", async ({ page }) => {
    await enterApp(page);
    await mockUsageLimited(page);
    await page.getByRole("button", { name: /encender helion/i }).click();
    await expect(page.locator(".error-banner, .min-error")).toContainText(/límite de uso|toca parar/i, { timeout: 15_000 });
  });
});
