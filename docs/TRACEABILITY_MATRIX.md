# Matriz de trazabilidad — Helion (bloques 1–4)

Riesgo/requisito → cambio → módulo → prueba → evidencia → estado → riesgo residual.
Estados: ✅ Implementado · ◑ Parcial · ✗ No implementado · ⊘ Fuera de alcance deliberado · ⧗ Bloqueado externamente · ⊗ Rechazado por decisión.

## Bloque 1 — Voz, prompt, latencia, memoria fuera del crítico, orbe, benchmark
| Requisito | Módulo | Prueba | Estado | Residual |
|---|---|---|---|---|
| Constitución de voz v1 versionada | `personality.ts` | `personality.test.ts` | ✅ | — |
| Dieta de prompt ≤3500 (test de presupuesto) | `personality.ts`, `identityPrompt.ts` | `personality.test.ts` (bloques reales) | ✅ | margen ajustado |
| Métricas de latencia en openai_realtime | `useRealtimeSession.ts` | manual/panel | ✅ | medición viva ⧗ |
| getMemoryHealth fuera del crítico + TTL | `service.ts` | `memoryHealthCache.test.ts` | ✅ | — |
| Orbe reacciona <150 ms (speech_stopped) | `HelionOrb.tsx`, hook | manual | ✅ | medición viva ⧗ |
| Benchmark (metodología + auto-métricas) | `benchmarks/`, `autoMetrics.ts` | `autoMetrics.test.ts` | ✅ | pasada viva ⧗ |

## Bloque 2 — Memoria cognitiva, identidad, cierre de inyección
| Requisito | Módulo | Prueba | Estado | Residual |
|---|---|---|---|---|
| assertionType + migración/backfill | `types.ts`, stores | `memory.test.ts` | ✅ | integración Postgres ⧗ |
| Cierre del vector de inyección (A–F) | `sanitizer.ts`, `retrieval.ts` | `injection.test.ts` | ✅ | — |
| Relaciones de creencia (updates/contradicts/supersedes) | `relations.ts` | `consolidation.test.ts` | ✅ | — |
| Decaimiento/consolidación programada idempotente | `consolidation.ts` | `consolidation.test.ts` | ✅ | — |
| Confirmación de contenido sensible (pending) | `pending.ts` | `pending.test.ts` | ✅ | — |
| Identidad sugerida/confirmada/privilegiada | `authz.ts`, session route | `authz.test.ts`, `identity.test.ts` | ✅ | — |
| Ciclo de vida de perfiles (listar/archivar) | `profileLifecycle.ts` | `profileLifecycle.test.ts` | ✅ | fusión ⊘ (contrato) |
| Cero fugas entre perfiles | `permissions.ts`, `service.ts` | `identity.test.ts`, `auditRegressions.test.ts` | ✅ | — |

## Bloque 3 — Observabilidad, telemetría, rate limit, coste, E2E, audio
| Requisito | Módulo | Prueba | Estado | Residual |
|---|---|---|---|---|
| Observabilidad + scrubber estricto | `observability/` | `scrub.test.ts` | ✅ | Sentry SDK opt-in ⧗ |
| Telemetría agregada versionada | `telemetry.ts`, `telemetryStore.ts` | `telemetry*.test.ts` | ✅ | — |
| RateLimiter abstracto + readiness | `rateLimit.ts` | `rateLimiter.test.ts` | ✅ | Redis multi-instancia ⧗ |
| Control de uso y coste | `costControl.ts` | `costControl.test.ts` | ✅ | facturación real ⧗ |
| Fallbacks honestos | `errors.ts` | E2E `fallbacks.spec.ts` | ✅ | — |
| E2E Playwright (Chromium/WebKit/móvil) | `e2e/`, `playwright.config.ts` | 28/28 local | ✅ | navegadores reales ⧗ |
| AudioFrontend sustituible | `audioFrontend.ts` | `audioAdaptive.test.ts` | ✅ | hardware ⊘ |
| Recalibración adaptativa + wake word | `gateEngine.ts`, `wakeWord.ts` | `audioAdaptive.test.ts` | ✅ (wake word contrato) | validar con datos ⧗ |
| Microestados (identidad, mic ámbar, haptics) | `HelionOrb.tsx`, `haptics.ts` | `ui.test.tsx` | ✅ | — |

## Bloque 4 — Auditoría, hardening, release gate (defectos cerrados)
| Riesgo hallado | Sev | Corrección | Prueba | Estado |
|---|---|---|---|---|
| Secreto de cookie derivado del passcode (forja de owner) | P1 | secreto aleatorio por proceso | `security.test.ts` | ✅ |
| GET /api/memory sin gate de confirmación | P0 | `filterMemoriesForRetrieval` | `auditRegressions.test.ts` | ✅ |
| Cambio de identidad no purga buffer/contexto | P0 | limpieza + timer de respaldo | revisión + hook | ✅ |
| Dedup/relaciones cruzan perfiles | P1 | filtrar por dueño+scope | `auditRegressions.test.ts` | ✅ |
| Pending secuestra memoria activa | P1 | `skipDedupAndRelations` | `auditRegressions.test.ts` | ✅ |
| forget/search sin confirmación | P1 | thread `confirmed` | `auditRegressions.test.ts` | ✅ |
| Cost downgrade/kill switch inertes | P1 | aplicar + `voiceDowngraded` | revisión + E2E | ✅ |
| getMemoryHealth en crítico sin presupuesto | P1 | Promise.race(maxBlockingMs) | revisión | ✅ |
| scrubUrl deja fragmento; patrones/denylist cortos | P1/P2 | hash='' + patrones + denylist | `scrub.test.ts` | ✅ |
| XFF spoofeable (brute force) | P2 | preferir x-real-ip + cupo global | `security.test.ts` | ✅ |
| Impersonar perfil privilegiado por alias | P2 | privados → "claimed" | `security.test.ts` | ✅ |
| Alias por subcadena (spoofing) | P2 | palabra completa | `auditRegressions.test.ts` | ✅ |
| Presupuesto medido con bloque fabricado | P2 | medir bloques reales | `personality.test.ts` | ✅ |
| Panel sin foco modal/Escape; estado no anunciado | P2 | aria-modal/trap/aria-live | `ui.test.tsx` | ✅ |
| Postgres sin timeouts | P2 | connection/statement timeout | `postgresStore.test.ts` | ✅ |
| Reconexión reinicia backoff en cada open (flapping) | P2 | reset solo tras estable | revisión | ✅ |
| /api/chat sin tope de tamaño | P2 | cap 64 KB → 413 | revisión | ✅ |
| client-error reenvía texto libre | P2 | cap + scrub ampliado | revisión | ✅ |
| E2E sin camino feliz; ?debug=1 vacuo | P2 | `mockSessionUp` + señal concreta | `fallbacks/debug spec` | ✅ |
| Extracción sin identidad conocida | P2 | gate "unknown" | revisión | ✅ |
| Postgres/migraciones sin test de integración | P2 | estructural + scaffold skip | `postgresStore.test.ts` | ◑ (integración ⧗) |
| Cupo global agotable por 1 IP | P3 | short-circuit | revisión | ✅ |
| Readiness no en /api/health | P3 | añadido | revisión | ✅ |
| Owner sin PIN en demo | P3 | queda "claimed" (sin privado) + checklist | `authz.test.ts` | ✅ (mitigado) |
| Runner self-model vivo inexistente | P3 | `scripts/self-model-drift.mjs` | — | ✅ (ejecución ⧗) |
