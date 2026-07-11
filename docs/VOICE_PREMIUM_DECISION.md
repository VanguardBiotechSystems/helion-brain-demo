# Decisión sobre voz premium / gateway persistente (bloque 4, §11)

## Decisión: NO implementar ahora — preparar experimento aislado cuando haya datos vivos

El gateway persistente (WebSocket caliente para reducir el TTFB de ElevenLabs) NO se implementa en este bloque. Razón: la decisión debe basarse en datos de latencia/coste/calidad reales, y esos datos son un **bloqueo externo** (requieren sesiones vivas con proveedores). No se implementa "porque esté en el roadmap".

## Datos considerados (y su estado)
| Factor | Estado | Nota |
|---|---|---|
| Latencia OpenAI (demo_estable) | ⧗ vivo | p50/p95 se miden en el panel; objetivo p50 ≤ ~900 ms |
| Latencia ElevenLabs (calidad_voz) | ⧗ vivo | http_stream ya da TTFB por fragmento; objetivo p50 ≤ ~1,4 s |
| Calidad percibida | ⧗ humano | español nativo de ElevenLabs vs acento de OpenAI |
| Identidad vocal | ✅ decidido | una voz por sesión (ADR-003, sin híbrido) |
| Fallos/reconexiones | ✅ medible | telemetría por sesión |
| Coste | ✅ estimado | `costControl.ts` (estimación, no facturación) |
| Complejidad/mantenimiento | ✅ evaluado | gateway con estado = infra incompatible con serverless |
| Necesidad real de demo | ✅ evaluado | demo_estable cubre la demo; calidad_voz es opcional |
| Seguridad | ✅ evaluado | un WS caliente amplía superficie; hoy no se justifica |

## Racional
- `demo_estable` (OpenAI Realtime) cubre la demo con latencia y barge-in nativos y una sola identidad vocal.
- `calidad_voz` (ElevenLabs http_stream) ya está implementado y da un TTFB por fragmento razonable **sin** gateway.
- El gateway persistente añadiría infraestructura con estado (incompatible con el despliegue serverless actual), más mantenimiento y superficie de seguridad, a cambio de una mejora de latencia **no demostrada aún con datos**.

## Condición de reevaluación
Ejecutar el benchmark vivo (10 conversaciones × ambos modos) y recoger p50/p95 y puntuación humana de calidad. **Solo si** `calidad_voz` muestra una latencia inaceptable Y la calidad percibida justifica el coste, se preparará un **experimento aislado** (no en el camino de producción) del gateway, detrás de flag y medido. Hasta entonces: `futuro_gateway` permanece reservado y cae a `demo_estable` con log (ADR-004).
