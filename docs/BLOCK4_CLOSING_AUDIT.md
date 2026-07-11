# Bloque 4 — Auditoría integral de cierre e informe de release

## Resumen ejecutivo (sin marketing)

Se auditó la totalidad de lo construido en los bloques 1–3 con una revisión adversarial independiente (46 agentes en 9 dominios: seguridad, memoria, identidad, voz/prompt, frontend/accesibilidad, rendimiento/concurrencia, observabilidad/telemetría, endpoints/rate-limit, integración/tests), cada hallazgo verificado por un segundo agente escéptico. La auditoría encontró **defectos de integración reales**, incluidos **2 P0** (fuga de memoria privada a identidad sugerida; el cambio de identidad no purgaba el buffer) y **1 P1 crítico** (el secreto de firma de cookies se derivaba del passcode, permitiendo forjar una cookie de owner y saltarse el PIN). **Todos los P0/P1/P2 internos se han corregido** con pruebas de regresión. Los elementos que no se pueden cerrar en el repositorio (benchmark vivo, navegadores reales, integración Postgres, credenciales) quedan **separados y documentados** como bloqueos externos.

## Veredicto

### `CONDITIONAL_PASS_WITH_EXTERNAL_BLOCKERS`

Todo el trabajo INTERNO está cerrado y verde; el `PASS` pleno queda condicionado a elementos EXTERNOS concretos (no a código incompleto ni tests en rojo):

**Se cumple para el condicional:**
- Cero P0/P1/P2 internos abiertos (29 hallazgos confirmados + 3 propios, todos cerrados).
- Suite verde: **393 tests (+1 skip de integración) en 31 archivos**; lint 0; typecheck 0; build OK.
- E2E verde: **28/28** local (Chromium, WebKit, móvil).
- Cero fugas entre perfiles; inyección persistente cerrada; prompt ≤3500 medido contra bloques reales; modos de voz formalizados; observabilidad operativa; documentación completa; árbol git limpio.
- Release gate automático **PASA** (`node scripts/release-gate.mjs`).

**Bloqueos externos que impiden el `PASS` pleno (no internos):**
1. **Benchmark vivo de 10 conversaciones + latencias** — requiere claves y sesión de voz real (harness listo; parte determinista ejecutada y verde).
2. **Matriz de navegadores reales** (Safari/iOS/Android) — requiere dispositivos; E2E automatizado cubre Chromium/WebKit.
3. **Integración Postgres** — requiere una BD desechable (tests estructurales hechos; scaffold de integración skippeado con `TEST_DATABASE_URL`).
4. **Credenciales/entorno de despliegue** — `SESSION_SECRET`, `OWNER_IDENTITY_PIN`, Postgres, `MEMORY_CONSOLIDATION_SECRET`, Upstash (si multi-instancia), Sentry DSN (opcional).

No se emite `PASS` porque esos elementos, aunque externos, son necesarios para declarar el producto listo para público. No se emite `FAIL` porque no queda ningún riesgo interno abierto.

## Commits

- Base pre-intervención: `5bf675c`. HEAD del bloque 4: ver `git log`. **26 commits locales sobre `5bf675c`, SIN PUSH** (rama `main`, ahead de `origin/main`).
- Bloque 4 (5 commits): `db86db2`, `b7b2a1b`, `a504d09`, `be91fc4`, `2952bbd` (+ docs de cierre).

## Hallazgos y clasificación (P0–P4)

Detalle completo en `docs/TRACEABILITY_MATRIX.md`. Resumen:

| Sev | Hallazgo | Estado |
|---|---|---|
| P1 | Secreto de cookie derivado del passcode → forja de owner | ✅ cerrado (secreto aleatorio por proceso) |
| P0 | GET /api/memory sin gate de confirmación → identidad sugerida lee lo privado | ✅ cerrado |
| P0 | Cambio de identidad no purga buffer/contexto → turnos privados bajo nueva identidad | ✅ cerrado |
| P1 | Dedup/relaciones cruzan perfiles; pending secuestra activa; forget/search sin confirmación; cost downgrade inerte; getMemoryHealth en crítico; scrubUrl deja fragmento | ✅ todos cerrados |
| P2 | XFF spoofeable; impersonar por alias; alias por subcadena; presupuesto con bloque fabricado; panel sin foco modal; estado no anunciado; Postgres sin timeouts; reconexión flapping; scrubber denylist/patrones; /api/chat sin cap; client-error texto libre; extracción sin identidad; E2E sin camino feliz; ?debug=1 vacuo | ✅ todos cerrados |
| P2 | Integración Postgres sin test | ◑ estructural cerrado; integración viva ⧗ externa |
| P3 | Cupo global agotable; readiness no en health; owner sin PIN; runner self-model vivo | ✅ cerrados/mitigados |

Todos los P0/P1/P2 INTERNOS: **cerrados**. Los P3 se aceptan con mitigación y dueño (owner/despliegue) y están documentados, no ocultos.

## Correcciones y pruebas

- Seguridad: `security.test.ts` (secreto no forjable, x-real-ip, no impersonación), `scrub.test.ts` (denylist/patrones/fragmento).
- Memoria/identidad: `auditRegressions.test.ts` (dedup por dueño, pending no secuestra, sugerido no busca privado, alias por palabra).
- Prompt: `personality.test.ts` (bloques reales ≤3500), `selfModelDrift.test.ts` (self-model sin secretos/capacidades).
- Robustez: timeouts Postgres, anti-flapping, presupuesto de health, tope de tamaño en chat.
- A11y: panel modal (foco/Escape/trap) y estado hablado (`ui.test.tsx`).
- E2E: camino feliz + aserciones concretas (`fallbacks.spec.ts`, `debug-permissions.spec.ts`).

## Métricas

- Deterministas (benchmark, ejecutadas): frases/respuesta mediana 2 · p90 2 · clichés 0 % · arranques prohibidos 0 % · seguimientos no pedidos 0 %. Ver `docs/benchmarks/2026-07-11.md`.
- Latencia viva, barge-in, %<1,5 s, falsos positivos del gate: **bloqueo externo** (harness listo; panel de diagnóstico + `sessionStats`).

## Seguridad / Rendimiento / Accesibilidad / Telemetría / Costes

- Seguridad: cookies no forjables; PIN de owner no evitable; rate limit robusto a spoofing; sin secretos en git/logs/telemetría/cliente (scrubber ampliado + escaneo en el gate); sin stack traces al cliente.
- Rendimiento: `getMemoryHealth` fuera del crítico con presupuesto; telemetría/observabilidad no bloquean UX; Postgres con timeouts; sin fugas de timers (limpieza en `cleanupPeer`, anti-flapping).
- Accesibilidad: panel modal accesible; estado transitorio anunciado; `prefers-reduced-motion`; controles etiquetados; haptics opcionales.
- Telemetría/costes: contrato agregado versionado sin contenido; estimación de coste versionada; kill switches y límites operativos.

## Variables de entorno · Migraciones · Rollback · Despliegue
Ver `.env.example`, `docs/RUNBOOKS.md`, `docs/RELEASE_CHECKLIST.md`, `docs/BLOCK3_OBSERVABILITY_AND_ROBUSTNESS.md` §16. Migraciones Postgres idempotentes y reversibles (backfill conservador). Rollback: commits pequeños y aditivos; `git revert` seguro; kill switches para cortar proveedor sin desplegar.

## Riesgos residuales aceptados (P3, con dueño)
- **Rate limit/telemetría in-memory por instancia** (dueño: despliegue) — correcto para una instancia; el readiness marca CRÍTICO en producción distribuida sin Upstash.
- **Owner sin PIN en demo** (dueño: despliegue) — queda "sugerido" sin acceso privado; el checklist exige PIN para demo real.
- **SDK de Sentry no incluido** (dueño: despliegue) — sin DSN, solo-logging; instalar `@sentry/node` para forwarding.
- **Fusión de perfiles** (dueño: producto) — contrato documentado, no implementada.

## Paso que queda de parte del usuario
- Revisar y, si procede, autorizar el **push** (`git push`) — 26 commits locales sin publicar.
- Configurar las credenciales del gate manual y ejecutar el benchmark vivo + matriz de navegadores reales antes de abrir a público.

## Confirmación
Árbol git limpio. Gate automático verde. Auditoría de humanización y madurez de Helion **finalizada** con veredicto `CONDITIONAL_PASS_WITH_EXTERNAL_BLOCKERS`.
