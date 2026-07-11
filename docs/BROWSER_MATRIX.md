# Matriz de navegadores — Helion

## Automatizada en CI (Playwright, proveedores simulados)
| Motor | Viewport | Cobertura | Estado local |
|---|---|---|---|
| Chromium | Escritorio | acceso, orbe, camino feliz, fallbacks, debug | ✅ 11/11 |
| WebKit | Escritorio (Safari engine) | idem | ✅ 11/11 |
| Chromium | Móvil (Pixel 7) | idem | ✅ 8/8 (los que aplican) |

Total local **28/28**. Firefox queda preparado (proyecto comentado en `playwright.config.ts`); **no se declara compatible** hasta probarlo. Los binarios se instalan en CI con `npx playwright install --with-deps chromium webkit`.

## Manual (BLOQUEO EXTERNO — requiere navegadores/hardware reales)
No se han podido ejecutar en este entorno; forman parte del gate manual (`docs/RELEASE_CHECKLIST.md`). **No declarar compatibilidad de un navegador no probado.**

| Escenario | Safari macOS | Chrome | Safari iOS | Chrome Android |
|---|---|---|---|---|
| Permiso de micrófono real | ⧗ | ⧗ | ⧗ | ⧗ |
| Voz en vivo (OpenAI Realtime) | ⧗ | ⧗ | ⧗ | ⧗ |
| Barge-in real | ⧗ | ⧗ | ⧗ | ⧗ |
| Suspensión/reanudación de pestaña | ⧗ | ⧗ | ⧗ | ⧗ |
| Auriculares / salida de audio | ⧗ | ⧗ | ⧗ | ⧗ |
| PTT táctil / haptics | n/a | n/a | ⧗ | ⧗ |
| Reconexión tras pérdida de red | ⧗ | ⧗ | ⧗ | ⧗ |

## Limitaciones conocidas (reales)
- WebKit (Playwright) no soporta el permiso `microphone` de Playwright; en E2E el fallo de sesión se prueba porque `/api/session` se pide **antes** que `getUserMedia`. La voz real en WebKit/Safari se valida en el manual.
- El autoplay de audio puede requerir gesto del usuario en Safari/iOS (existe el botón «Activar audio»).
- `AudioContext` puede iniciar suspendido en algunos navegadores (se reanuda con interacción).
