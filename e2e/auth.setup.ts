import { test as setup, expect } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/user.json";

/**
 * Autenticación única (patrón storageState de Playwright): entra por la
 * puerta una sola vez y guarda la cookie firmada. El resto de tests la
 * reutilizan, evitando N logins que agotarían el rate limiter de acceso.
 */
setup("autenticar", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Código de acceso").fill("e2e-pass");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("button", { name: /encender helion/i })).toBeVisible({ timeout: 15_000 });
  await page.context().storageState({ path: AUTH_FILE });
});
