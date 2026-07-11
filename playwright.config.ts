import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E (bloque 3, §6/§7). Determinista y SIN llamadas reales a
 * proveedores: cada test intercepta las rutas de red del navegador
 * (page.route) para OpenAI/ElevenLabs/sesión, así la CI no depende de que
 * OpenAI o ElevenLabs estén disponibles.
 *
 * Matriz: Chromium, WebKit y un viewport móvil. Firefox se puede añadir
 * descomentando su proyecto (el producto no lo prueba manualmente aún).
 *
 * Privacidad (§13): fixtures con identidades ficticias, env de prueba con
 * claves falsas; vídeo desactivado y trazas solo en fallo (no capturan datos
 * reales porque no hay proveedores reales ni memorias reales).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    // Autenticación única: produce la cookie que reutilizan los tests con
    // sesión. access.spec NO depende de esto (prueba la propia puerta).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
        permissions: ["microphone"],
        launchOptions: {
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
        },
      },
    },
    { name: "webkit", dependencies: ["setup"], use: { ...devices["Desktop Safari"], storageState: "e2e/.auth/user.json" } },
    {
      name: "mobile-chrome",
      dependencies: ["setup"],
      use: {
        ...devices["Pixel 7"],
        storageState: "e2e/.auth/user.json",
        permissions: ["microphone"],
        launchOptions: {
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
        },
      },
    },
    // { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Claves FALSAS: la puerta y la UI funcionan; los proveedores se mockean.
      OPENAI_API_KEY: "sk-e2e-fake-key-1234567890",
      APP_ACCESS_PASSWORD: "e2e-pass",
      OWNER_IDENTITY_PIN: "4321",
      MEMORY_PROVIDER: "local",
      MEMORY_LOCAL_PATH: ".data/e2e-memory.json",
      HELION_DEPLOYMENT_MODE: "development",
      NEXT_PUBLIC_APP_NAME: "Helion",
      AGENT_NAME: "Helion",
    },
  },
});
