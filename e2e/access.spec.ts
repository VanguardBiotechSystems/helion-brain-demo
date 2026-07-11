import { test, expect } from "@playwright/test";

// La puerta se prueba SIN sesión previa: se ignora el storageState del proyecto.
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Acceso y arranque (§6). Usa la ruta REAL /api/access (valida el passcode
 * del env de prueba, "e2e-pass"). No toca proveedores externos.
 */

test.describe("puerta de acceso", () => {
  test("carga la presencia pública con la puerta de passcode", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Helion" })).toBeVisible();
    await expect(page.getByLabel("Código de acceso")).toBeVisible();
  });

  test("passcode incorrecto muestra error y no entra", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Código de acceso").fill("mal-passcode");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator(".gate-error")).toBeVisible();
    await expect(page.getByLabel("Código de acceso")).toBeVisible(); // sigue en la puerta
  });

  test("passcode correcto entra en la experiencia privada", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Código de acceso").fill("e2e-pass");
    await page.getByRole("button", { name: "Entrar" }).click();
    // Tras recargar, aparece el orbe y el botón de encendido.
    await expect(page.getByRole("button", { name: /encender helion/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("canvas")).toBeVisible();
  });
});

test.describe("rate limit de acceso", () => {
  test("demasiados intentos fallidos acaban en 429 honesto", async ({ page }) => {
    await page.goto("/");
    // Interceptamos para forzar el 429 sin agotar el limitador real global.
    await page.route("**/api/access", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "60" },
        body: JSON.stringify({ error: { code: "rate_limited", message: "Demasiados intentos. Espera unos minutos." } }),
      }),
    );
    await page.getByLabel("Código de acceso").fill("x");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator(".gate-error")).toContainText(/demasiad[ao]s (intentos|peticiones)/i);
  });
});
