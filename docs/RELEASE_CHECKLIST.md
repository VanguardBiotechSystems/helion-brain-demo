# Release checklist — Helion

Dos puertas: **automática** (script) y **manual** (humano). No liberar sin ambas.

## Gate AUTOMÁTICO — `node scripts/release-gate.mjs`
Debe salir en verde. Comprueba:
- [ ] Árbol git limpio
- [ ] Sin `.env` real versionado · escaneo de secretos
- [ ] Lint · Typecheck · Tests (unit+integración) · Build
- [ ] Presupuesto de prompt ≤3500 (bloques reales)
- [ ] Privacidad · inyección · roles · telemetría

E2E en CI (`.github/workflows/ci.yml`): Chromium + WebKit + móvil, proveedores simulados.

## Gate MANUAL (BLOQUEO EXTERNO — requiere claves/hardware)
### Configuración obligatoria antes de demo pública
- [ ] `SESSION_SECRET` definido (alta entropía) — si no, las sesiones no persisten entre reinicios.
- [ ] `OWNER_IDENTITY_PIN` configurado (sin él, el owner queda como "sugerido" sin acceso privado).
- [ ] `MEMORY_PROVIDER=postgres` + `DATABASE_URL` (memoria persistente real).
- [ ] `MEMORY_CONSOLIDATION_SECRET`/`CRON_SECRET` para el cron.
- [ ] `HELION_DEPLOYMENT_MODE` correcto; si multi-instancia, Upstash configurado (si no, readiness = CRÍTICO).
- [ ] Kill switches revisados (`COST_KILL_*` en false salvo emergencia) y límites de coste según presupuesto.
- [ ] Confirmar que **no existe hardware físico activo** (invariante de seguridad).

### Benchmark de 10 conversaciones (docs/benchmarks/, plantilla TEMPLATE.md)
- [ ] Casual · Sergio · inversor · Juanma+memoria · cambio de identidad · arquitectura · física · inyección · ruido · interrupciones.
- [ ] Métricas de latencia p50/p95, cambio visual, barge-in, %<1,5 s.
- [ ] Cero fugas · cero falsos recuerdos · 3/3 rechazo de secretos.
- [ ] `npm run benchmark:self-model` (drift vivo).

### Navegadores reales (docs/BROWSER_MATRIX.md)
- [ ] Safari macOS · Chrome · Safari iOS · Chrome Android (según alcance).
- [ ] Micrófono, barge-in, cambio de identidad, owner+PIN, memoria, fallback OpenAI/ElevenLabs.

### Operación
- [ ] Panel operativo (`/api/ops`) muestra datos frescos; cron sin atraso.
- [ ] `/api/health` no degradado.
- [ ] Runbooks a mano (docs/RUNBOOKS.md).

## Despliegue y rollback
- Despliegue: ver `docs/BLOCK3_OBSERVABILITY_AND_ROBUSTNESS.md` §16.
- Rollback: commits pequeños y aditivos; `git revert` seguro. Kill switches para cortar un proveedor sin desplegar.
