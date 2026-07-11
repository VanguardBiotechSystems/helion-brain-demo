# Bloque 3 — Robustez de producción, observabilidad, telemetría, coste, E2E y audio sustituible

Informe de entrega. Todo el código citado está en el repo y cubierto por tests deterministas.

## 1. Arquitectura de observabilidad (§1)

Fachada agnóstica de proveedor en `lib/server/observability/`:
- `captureError(error, ctx)` / `captureMessage(msg, ctx)` — siempre registran en el logger de servidor (ya redactado) y, si hay `SENTRY_DSN`, reenvían el evento **ya saneado** vía import dinámico opcional de `@sentry/node`. Sin DSN o sin el SDK: solo-logging, nunca rompe el arranque ni una petición.
- Contexto tipado: `category` (session_create, openai, elevenlabs, memory, cron, identity, tool, reconnect, orb, route, telemetry, client, e2e), `code`, `provider`, `phase`, `voiceMode`, `browser`, `correlationId` (pseudónimo efímero). **Nunca** nombres de personas como tags.
- `observabilityCounts()` alimenta el panel operativo.
- Cubierto: session-create (`app/api/session`), cron (`app/api/memory/consolidate`), errores de cliente (`POST /api/client-error`, saneado en servidor). Puntos de captura ampliables sin duplicar infraestructura.

## 2. Política de redacción (§1, §13)

`lib/server/observability/scrub.ts` — última barrera, no dependemos solo del proveedor:
- Lista de **denegación por clave** (normalizada, sin separadores): authorization, cookie, apikey, token, clientSecret, sessionSecret, secret, password, passcode, pin, email, prompt, instructions, transcript, content, canonicalContent, memory, recall, audio, displayName, alias, toolArgs, arguments, dsn, databaseUrl, connectionString…
- **Patrones por valor**: claves `sk-/sk_/ek_/rt_`, `Bearer …`, `xi-api-key`, connection strings `postgres://`, JWT, emails.
- URLs: se conserva host+ruta, se elimina toda la query y credenciales.
- Excepciones/objetos anidados: recursión con tope de profundidad/tamaño; los `Error` conservan nombre + mensaje saneado.
- Tests: `tests/scrub.test.ts` (objetos anidados, excepciones, URLs, cabeceras, mensajes de proveedor, connection strings, límites).

**Garantía verificada:** nunca salen transcripciones, audio, recuerdos, prompts, PIN, cookies, tokens efímeros, cabeceras de autorización, claves, variables de entorno, contenido de herramientas ni parámetros privados de identidad.

## 3. Esquema de telemetría y retención (§2)

`lib/shared/telemetry.ts` — versionado (`TELEMETRY_SCHEMA_VERSION = 1`), estricto: `validateTelemetry` **rechaza campos desconocidos** y normaliza enums/números. Solo recuentos y versiones. `POST /api/telemetry`: rate limit por IP, tamaño máximo (4 KB), idempotencia por `correlationId`. Almacén agregado por día `lib/server/telemetryStore.ts`, **separado de memorias/conversaciones**, retención 30 días, muestras de latencia acotadas. Cliente: `lib/client/telemetry.ts` emite al cerrar sesión con `keepalive`.

**No transporta:** texto pronunciado/generado, contenido de memoria, nombre de perfil, PIN, correo, identificadores persistentes, payloads de herramientas ni prompt. Tests: `tests/telemetry.test.ts`, `tests/telemetryClient.test.ts`.

## 4. Panel operativo (§3)

`GET /api/ops` — agregados con `generatedAt` + `freshness: "agregado (no tiempo real)"`. Respeta roles: `view_debug` (owner privilegiado) ve todo incl. bloqueos de rate limit y perfiles; `view_tech_status` (técnico) ve salud y agregados **sin perfiles ni contenido**; el resto 403. Renderizado en `DiagnosticsPanel`: sesiones/día, coste estimado (versionado), acción de coste, salud de memoria, readiness del rate limiter, cron (última ejecución/duración/atraso), telemetría rechazada, errores por categoría, tendencia diaria (p50/p95, respuestas <1,5 s, reconexiones, fallbacks, ruido).

## 5. Rate limiting para varias instancias (§4)

`lib/server/rateLimit.ts` — tabla ÚNICA `RATE_LIMITS` por namespace (arregla el bug histórico de `getLimiter`, que cacheaba por nombre e ignoraba límites posteriores: colisiones `tts` 120/240, `memory-extract` 10/30, `profiles` 60/30). `enforceRateLimit(ns, key)` con métricas de bloqueo. Límites diferenciados: login, access_pin, identity, session-ip/global, chat, tts, voice-test, memory-read/write/extract/confirm, consolidate, profiles, telemetry, client-error, ops.

**Modo de despliegue** (`deploymentMode`): development | demo | production. **Readiness** (`rateLimiterReadiness`): en `production` SIN limitador distribuido → **CRÍTICO** (no pasa en silencio); en `demo` → aviso; con Upstash/Redis configurado → ok. Implementación local in-memory por defecto; contrato distribuido opcional (Upstash) detectado por credenciales. Tests: `tests/rateLimiter.test.ts`.

## 6. Control de uso y coste (§5)

`lib/server/costControl.ts` — `PRICE_TABLE` **centralizada y versionada** (`COST_MODEL_VERSION`), nunca precios repartidos. `estimateSessionCost`, `decideCostAction`: límite blando → `calidad_voz` baja a `demo_estable` informado (`applyCostDowngrade`); límite duro → rechaza sesiones nuevas con `usage_limited` (mensaje honesto, **nunca corta a mitad**); kill switch por proveedor; owner exento de límites blandos. Config en env (`COST_*`). Los paneles de OpenAI/ElevenLabs siguen siendo la fuente autoritativa; lo nuestro es estimación. Tests: `tests/costControl.test.ts`.

## 7. Matriz E2E y resultados por navegador (§6, §7)

Playwright, `playwright.config.ts` + `e2e/`. Determinista y **sin llamadas reales** (mocks vía `page.route`). Patrón `storageState` (auth única) para no agotar el limitador de acceso; `access.spec` corre sin sesión.

| Proyecto | Motor | Viewport | Resultado local |
|---|---|---|---|
| chromium | Chromium | escritorio | ✅ 10/10 |
| webkit | WebKit | escritorio | ✅ 10/10 |
| mobile-chrome | Chromium | Pixel 7 (móvil) | ✅ 8/8 |

Total **28/28** verde localmente (chromium+webkit binarios instalados; setup incluido). Cobertura: acceso (puerta, passcode correcto/incorrecto, rate limit), arranque + estado del orbe, consola de depuración con/sin modo avanzado, fallbacks honestos (sesión caída, límite de uso) verificando que **nunca** se finge "todo bien". Firefox queda preparado (proyecto comentado) — no se prueba manualmente aún, así que no se declara compatible.

**Matriz manual pendiente (documentada, no automatizable aquí):** Safari real macOS, Chrome real, Safari iOS, Chrome Android, permisos de micrófono reales, suspensión/reanudación, cambio de pestaña, auriculares, salida de audio, PTT táctil, haptics.

CI: `.github/workflows/ci.yml` separa gates deterministas (lint/typecheck/test/build) del job E2E (instala navegadores, corre Playwright, sube informe en fallo). **Los tests obligatorios no dependen de OpenAI/ElevenLabs.**

## 8. Fallbacks honestos (§8)

`lib/shared/errors.ts` — nuevos códigos con mensajes breves en el tono de Helion (la consola muestra el código técnico): `mic_lost`, `memory_unavailable`, `identity_unconfirmed`, `usage_limited`, `provider_openai_down`, `provider_elevenlabs_down`, `streaming_fallback`, `text_fallback`. Ejemplo: *"Ahora mismo no puedo pensar con normalidad. Reinténtalo en un momento."* `isKnownErrorCode` deriva de `ERROR_COPY` (reconoce los nuevos códigos). Verificado en E2E (`fallbacks.spec.ts`).

## 9. Operación del cron (§9)

`GET /api/memory/consolidate` protegido por `MEMORY_CONSOLIDATION_SECRET`/`CRON_SECRET` (Bearer en tiempo constante; **404 a sondas**, no 401). `vercel.json` lo programa (04:00 diario). `recordConsolidationRun`/`lastConsolidationReport` guardan última ejecución, duración y métricas (scanned/decayed/expired/archived/merged/pendingExpired/profilesArchived); el panel marca **atraso >36 h**. Idempotente (ventana 1 h). Invocación no autorizada: 404 sin filtrar detalles. Tests: `tests/ops.test.ts`, protección en `tests/rateLimiter.test.ts` + revisión manual.

## 10. AudioFrontend sustituible (§10)

`lib/audio/audioFrontend.ts` — interfaz que desacopla el sistema cognitivo/gate del origen físico: `init/requestPermission/start/pause/close/readLevel/getState/getCapabilities/getActiveDevice/isMuted/setMuted/calibrate/gateSnapshot/getStream` + eventos (`onLevel/onGate/onVoiceStart/onVoiceStop/onDeviceChange/onError/onStateChange`). El **motor del gate sigue puro y separado** (`gateEngine.ts`); el frontend solo lo alimenta con RMS+timestamps. `MockAudioFrontend` determinista para tests/E2E. Capacidades **reservadas para hardware**: `beamforming`, `directionOfArrival`, `selfVoiceSuppression` (micro array, AEC, DSP, dirección de llegada, supresión de la voz propia del robot). Ninguna dependencia de hardware ni de robot. Tests: `tests/audioAdaptive.test.ts` (contrato).

## 11. Simulación acústica: recalibración y wake word (§11)

**Recalibración adaptativa** (`gateEngine.ts`): ante deriva del ruido de fondo sostenida (EWMA ≥ baseline × `driftFactor` 2,0 durante `driftSustainMs` 30 s) sube el suelo de forma **gradual** (mitad de camino, acotado a 4×) con **histéresis** (banda 0,8×). NUNCA con voz confirmada (open/hangover) ni mientras Helion habla (`setAgentSpeaking`) → no aprende ni la voz del usuario ni el eco del altavoz. Deshabilitable (`LOCAL_AUDIO_ADAPTIVE_RECALIBRATION`). **Defaults afinados intactos**: en condiciones normales no recalibra.

**Simulaciones** (`tests/audioAdaptive.test.ts`): sin deriva → 0 recalibraciones; deriva bursty sostenida 35 s → recalibra y sube umbral, con ráfagas rechazadas como ruido; mientras habla → 0; deriva breve → 0 (histéresis); deshabilitado → 0.

**Wake word suave "Helion"** (`wakeWord.ts`): **hook de contrato detrás de flag, apagado por defecto** (`HELION_WAKE_WORD_ENABLED`). Decisión documentada: NO se construye un detector de audio improvisado (empeoraría privacidad y complejidad). `evaluateWakeWord` es puro: aunque el texto parcial empiece por "Helion", **no relaja el gate** si el flag está off, la sesión no escucha o la energía es insignificante — nunca abre por coincidencia textual. Listo para conectar a la transcripción parcial cuando haya datos que lo validen.

## 12. Microestados visuales (§12)

`HelionOrb.tsx`: barrido violeta al **cambiar de identidad** (cierra un contexto y abre otro; se autocompleta aunque la sesión tarde; **no muestra datos del perfil anterior**); anillo **ámbar** estable de **micrófono no disponible** (denegado/muteado/perdido/no soportado), distinto de un error cognitivo/red (que va en el banner). Con `prefers-reduced-motion` los microestados no se animan pero el anillo ámbar se redibuja por cambio de estado. **Haptics** (`lib/client/haptics.ts`) en PTT, solo si el navegador los permite y el usuario no pidió reducir movimiento; nunca lanzan sin soporte. Tests: `tests/ui.test.tsx`.

## 13. Revisión de seguridad y privacidad de observabilidad (§13)

- **Telemetría no contiene conversaciones**: esquema estricto que rechaza campos desconocidos; `tests/telemetry.test.ts` prueba que `transcript`/`prompt` colados se rechazan.
- **Sentry no contiene recuerdos**: todo evento pasa por `scrub` antes de salir; claves `memory/content/canonicalContent/transcript/prompt` → `[redactado]`.
- **Logs no contienen PIN**: `log.ts` redacta + `scrub` deniega `pin/passcode`.
- **E2E no registra secretos**: env de prueba con claves falsas; fixtures ficticias; `video: off`, `trace: on-first-retry`, `screenshot: only-on-failure` — sin proveedores reales ni memorias reales, las trazas no capturan datos sensibles.
- **Panel técnico sin memorias personales**: `view_tech_status` no lista perfiles ni contenido; solo `view_debug` (owner) ve metadatos de perfiles (nunca texto de recuerdos).
- **IDs de correlación no permiten seguimiento indefinido**: `correlationId` pseudónimo y **distinto por envío** (verificado en `tests/telemetryClient.test.ts`).
- **Retención documentada**: telemetría 30 días; `seen` de idempotencia acotado.
- **Endpoints con límites**: todos los nuevos (`telemetry`, `client-error`, `ops`) con `enforceRateLimit`.
- **Los fallos no devuelven stack traces al cliente**: las rutas devuelven `{ error: { code, message } }` genérico; el detalle va a observabilidad saneada.

## 14. Pruebas y quality gates (§14)

- **Deterministas (obligatorias, sin proveedores):** `npm run lint` (0 problemas), `npm run typecheck` (0 errores), `npm run test` → **363 tests / 27 archivos verde**, `npm run build` (compila). Incluye scrubbers, telemetría, rate limiting, cron, frontend de audio, simulaciones de ruido, fallbacks, permisos, migración/backfill (bloque 2).
- **E2E (separada):** `npm run test:e2e` → **28/28** (Chromium, WebKit, mobile) local; en CI tras `playwright install`.

## 15. Variables de entorno nuevas

Ver `.env.example`. Resumen: `SENTRY_DSN` (opcional), `HELION_DEPLOYMENT_MODE`, `UPSTASH_REDIS_REST_URL`/`_TOKEN` (opcional), `COST_SOFT_DAILY_SESSIONS`, `COST_HARD_DAILY_SESSIONS`, `COST_MAX_SESSION_MS`, `COST_KILL_OPENAI`, `COST_KILL_ELEVENLABS`, `COST_OWNER_EXEMPT`, `LOCAL_AUDIO_ADAPTIVE_RECALIBRATION`, `HELION_WAKE_WORD_ENABLED`. (Del bloque 2: `MEMORY_CONSOLIDATION_SECRET`/`CRON_SECRET`.)

## 16. Despliegue y rollback

- **Despliegue:** `npm ci && npm run build`. En Vercel, el cron ya está en `vercel.json`; define `MEMORY_CONSOLIDATION_SECRET` (o `CRON_SECRET`). Para producción multi-instancia declara `HELION_DEPLOYMENT_MODE=production` y configura Upstash, o deja `demo` conscientemente (readiness lo avisa). E2E en CI necesita `npx playwright install --with-deps chromium webkit`.
- **Rollback:** todo el bloque son commits pequeños y aditivos; `git revert` de cualquiera es seguro. La telemetría y la observabilidad son opt-in (sin DSN/sin límites configurados, el comportamiento previo se mantiene). No hay migraciones de BD nuevas en el bloque 3 (la de perfiles/assertionType es del bloque 2 y es reversible). Desactivar rápido: `COST_KILL_*` para cortar un proveedor, `HELION_WAKE_WORD_ENABLED=false` (ya por defecto), `LOCAL_AUDIO_ADAPTIVE_RECALIBRATION=false` para volver al gate fijo.

## 17. Riesgos aceptados

- Rate limiting y telemetría **in-memory por instancia**: correcto para una instancia (demo); en producción multi-instancia se necesita Upstash (el readiness lo marca CRÍTICO, no silencioso).
- Observabilidad externa **no incluye el SDK** en dependencias: si se quiere Sentry real, `npm i @sentry/node` y define `SENTRY_DSN`; sin eso, solo-logging.
- E2E cubre los flujos deterministas de UI; los caminos que exigen WebRTC/audio real vivo (voz de verdad, barge-in real) se validan en la matriz manual.
- Wake word: **contrato preparado, no activo** — requiere datos reales de transcripción parcial para validar sin dañar privacidad.
