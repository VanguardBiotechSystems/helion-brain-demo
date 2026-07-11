# Runbooks operativos — Helion

Procedimientos breves ante incidentes. El detalle técnico vive en el panel de diagnóstico (`?debug=1` o triple clic) y en `/api/ops` (owner) / `/api/health` (público).

## OpenAI caído (voz/razonamiento no responde)
**Síntomas.** Fallo al crear sesión (`session_create_failed`), `openai_error`, o reconexiones que no cuajan. En el orbe: aviso honesto ("Ahora mismo no puedo pensar con normalidad…").
**Acción.**
1. Confirmar en el panel: `errores` por categoría `openai`, `reconexiones`, código en el banner.
2. Comprobar el estado de OpenAI (status.openai.com) y la cuota/facturación de la cuenta.
3. Mitigación inmediata: el usuario puede usar el **modo texto** (fallback `/api/chat`) mientras tanto.
4. Si es cuota: recargar crédito; si es modelo: revisar `OPENAI_REALTIME_MODEL`.
**Rollback.** Ninguno de código; es dependencia externa. El fallback textual ya está activo.

## ElevenLabs caído (voz de calidad no disponible)
**Síntomas.** `tts_failed` / `provider_elevenlabs_down`; en `calidad_voz` la voz no suena.
**Acción.**
1. Verificar credenciales (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`) y cuota.
2. Mitigación: cambiar a `demo_estable` (OpenAI) — se sigue entendiendo y respondiendo; se informa al usuario (mensaje honesto).
3. Kill switch: `COST_KILL_ELEVENLABS=true` fuerza `demo_estable` de forma informada.
**Rollback.** `VOICE_ENGINE=openai_realtime`.

## Memoria degradada o no disponible
**Síntomas.** Panel: memoria `degraded`/`unavailable`; Helion avisa ("no llego a mi memoria…").
**Acción.**
1. `/api/memory/health`: `connectionOk`, `persistent`, `providerEffective`, `lastError` (sin secretos).
2. Si local en serverless → efímera por diseño: configurar `MEMORY_PROVIDER=postgres` + `DATABASE_URL`.
3. Si Postgres no responde: revisar la cadena de conexión y el estado del proveedor de BD.
4. La conversación NO se bloquea: la memoria degradada nunca impide hablar (presupuesto duro `MEMORY_MAX_BLOCKING_MS`).
**Rollback.** La sesión arranca sin contexto de memoria; sin pérdida de servicio de voz.

## Incidente de privacidad (sospecha de fuga)
**Síntomas.** Un perfil ve datos de otro; contenido sensible en logs/telemetría.
**Acción.**
1. **Contener:** `IDENTITY_ALLOW_DYNAMIC_PROFILES=false` si el vector son perfiles dinámicos; forzar reset de identidad.
2. Verificar el aislamiento con los tests: `npx vitest run tests/identity.test.ts tests/authz.test.ts` (cero fugas entre perfiles).
3. Revisar telemetría/observabilidad: el scrubber deniega contenido por clave; confirmar que no hay `SENTRY_DSN` mal configurado exponiendo datos.
4. Revocar sesiones: rotar `SESSION_SECRET` (invalida todas las cookies firmadas) y `APP_ACCESS_PASSWORD`.
5. Auditar: `/api/memory/stats` (rechazos por código, sin contenido) y el log de eventos de memoria.
**Rollback.** Rotación de secretos + `git revert` del cambio sospechoso.

## Coste disparado
**Síntomas.** Panel: sesiones/día altas, coste estimado alto, sesiones anormalmente largas.
**Acción.**
1. Límite blando: `COST_SOFT_DAILY_SESSIONS=N` → `calidad_voz` baja a `demo_estable` informado.
2. Límite duro: `COST_HARD_DAILY_SESSIONS=N` → rechaza sesiones nuevas con mensaje honesto (nunca corta a mitad).
3. Emergencia: `COST_KILL_OPENAI=true` / `COST_KILL_ELEVENLABS=true`.
4. La facturación autoritativa está en los paneles de OpenAI/ElevenLabs; lo del panel es estimación (`COST_MODEL_VERSION`).
**Rollback.** Poner los límites a 0 y los kill switches a false.

## Cron de consolidación no se ejecuta
**Síntomas.** Panel: cron `ATRASADO` (>36 h) o `sin ejecutar`.
**Acción.**
1. Verificar `vercel.json` (schedule 04:00) y que `MEMORY_CONSOLIDATION_SECRET`/`CRON_SECRET` está configurado en el despliegue.
2. Disparo manual owner: `POST /api/memory/consolidate` (confirmed) o `GET` con `Authorization: Bearer <secreto>`.
3. `dryRun=1` para previsualizar sin escribir.
**Rollback.** El cron es idempotente; reejecutar es seguro.

## Rate limiting / readiness en producción
**Síntomas.** `/api/ops` → `rateLimiter.severity = critical`.
**Acción.** En producción multi-instancia los límites in-memory no protegen. Configurar `UPSTASH_REDIS_REST_URL`/`_TOKEN`, o declarar `HELION_DEPLOYMENT_MODE=demo` conscientemente (una instancia).
**Rollback.** Cambiar `HELION_DEPLOYMENT_MODE`.
