import { test as base, type Page } from "@playwright/test";

/**
 * Fixtures E2E con identidades FICTICIAS (§13). Autentica vía la ruta real de
 * acceso y ofrece helpers para mockear proveedores, de modo que ningún test
 * dependa de OpenAI/ElevenLabs ni toque datos reales.
 */

/** Autentica con el passcode del env de prueba y entra en la app privada. */
export async function enterApp(page: Page): Promise<void> {
  await page.goto("/");
  const passcode = page.getByLabel("Código de acceso");
  if (await passcode.isVisible().catch(() => false)) {
    await passcode.fill("e2e-pass");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.getByRole("button", { name: /encender helion/i }).waitFor({ timeout: 15_000 });
  }
}

/** Mockea /api/session para simular fallo de creación (proveedor caído). */
export async function mockSessionDown(page: Page): Promise<void> {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "session_create_failed", message: "No se pudo iniciar la sesión de voz." } }),
    }),
  );
}

/** Mockea /api/session para simular límite de uso alcanzado. */
export async function mockUsageLimited(page: Page): Promise<void> {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "usage_limited", message: "Por hoy toca parar aquí: se ha alcanzado el límite de uso." } }),
    }),
  );
}

/** Mockea /api/config e /api/identity/current con un rol dado. */
export async function mockIdentity(page: Page, role: string, canViewDebug: boolean): Promise<void> {
  await page.route("**/api/identity/current", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accessAuthorized: true,
        currentProfileId: "e2e-user",
        identityStatus: canViewDebug ? "confirmed" : "claimed",
        displayName: "Fixture",
        role,
        trustLevel: role === "owner" ? "owner" : "visitor",
        memoryScopes: [],
        plane: canViewDebug ? "privileged" : "suggested",
        capabilities: canViewDebug ? ["view_debug"] : [],
        canViewDebug,
      }),
    }),
  );
}

export const test = base;
export { expect } from "@playwright/test";
