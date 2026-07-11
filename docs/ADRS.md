# Registros de decisiones de arquitectura (ADRs) — Helion

Formato breve: Contexto · Decisión · Consecuencias · Estado. Fecha 2026-07-11 salvo indicación.

## ADR-001 — OpenAI Realtime como `demo_estable`
**Contexto.** Se necesita voz conversacional fiable en vivo con baja latencia y una única identidad vocal.
**Decisión.** El modo por defecto (`demo_estable`) usa OpenAI Realtime (WebRTC, speech-to-speech). Es el brazo estable para demos.
**Consecuencias.** Latencia y barge-in nativos; ninguna voz de OpenAI es española nativa (se compensa con acento en la constitución). Aceptado.
**Estado.** Aceptado.

## ADR-002 — ElevenLabs como `calidad_voz`
**Contexto.** Para voz española nativa de mayor calidad percibida.
**Decisión.** Modo `calidad_voz` = OpenAI Realtime (oídos/cerebro) + síntesis ElevenLabs en streaming HTTP. Se selecciona con `VOICE_ENGINE=elevenlabs`.
**Consecuencias.** Requiere credenciales y cuota de ElevenLabs; latencia algo mayor. Modo opt-in, no por defecto.
**Estado.** Aceptado.

## ADR-003 — Rechazo del modo híbrido de voz
**Contexto.** Tentación de usar OpenAI para respuestas cortas y ElevenLabs para largas.
**Decisión.** NO hay modo híbrido: dos voces distintas en una misma entidad rompen la continuidad de identidad vocal.
**Consecuencias.** Una voz por sesión. Simplicidad y coherencia de identidad por encima de micro-optimizaciones.
**Estado.** Aceptado.

## ADR-004 — Aplazar el gateway persistente hasta tener datos
**Contexto.** Un gateway con WebSocket caliente reduciría el TTFB de ElevenLabs, pero añade infraestructura con estado, incompatible con serverless.
**Decisión.** NO se implementa ahora. `websocket_stream` se resuelve a `http_stream`. `futuro_gateway` está reservado y cae a `demo_estable`. Ver `docs/VOICE_PREMIUM_DECISION.md`.
**Consecuencias.** Menos complejidad/mantenimiento; se decide con métricas reales, no por roadmap.
**Estado.** Aceptado (revisión condicionada a datos de latencia/coste de `calidad_voz`).

## ADR-005 — Los recuerdos son DATOS no autoritativos
**Contexto.** Riesgo P0: una instrucción hablada podía curarse, almacenarse y reinyectarse como contexto privilegiado.
**Decisión.** Todo recuerdo recuperado se encapsula como DATO histórico no autoritativo (preámbulo + delimitador `<recuerdos>` + JSON escapado), con clasificador determinista de metainstrucciones antes de guardar y neutralización al recuperar.
**Consecuencias.** El vector de inyección persistente queda cerrado (tests en `tests/injection.test.ts`). Una instrucción en memoria NUNCA es orden ejecutable.
**Estado.** Aceptado.

## ADR-006 — Una identidad activa por sesión
**Contexto.** ¿Multiinterlocutor simultáneo? Aumenta complejidad y riesgo de fuga.
**Decisión.** Una sola identidad activa; cambio explícito y seguro que reinicia el contexto privado. Estados: sugerida / confirmada / privilegiada.
**Consecuencias.** Sin diarización ni multi-hablante; la privacidad entre perfiles se mantiene con reglas simples y auditables.
**Estado.** Aceptado.

## ADR-007 — No diarización por ahora
**Decisión.** No se separa por locutor mediante audio. La identidad se resuelve conversacionalmente.
**Consecuencias.** Menos superficie de error de privacidad; requiere que la persona se identifique. Reevaluable con hardware de micro array.
**Estado.** Aceptado.

## ADR-008 — No speaker verification por ahora
**Decisión.** No se verifica identidad por biometría de voz. El owner se protege con PIN/step-up, no con la voz.
**Consecuencias.** Evita falsos positivos/negativos biométricos y su privacidad; el PIN es el factor. Reevaluable en el roadmap de robot.
**Estado.** Aceptado.

## ADR-009 — Ningún componente mueve hardware físico
**Contexto.** Producto de demo sin cuerpo conectado.
**Decisión.** Prohibición inequívoca: ningún path del producto controla motores/actuadores. Los "gestos" son simulación registrada. Cualquier futuro control pasa por `AudioFrontend`/gateway con modo `shadow`, parada de emergencia y revisión independiente (ver `ROBOT_INTEGRATION_ROADMAP.md`).
**Consecuencias.** Seguridad física garantizada por diseño.
**Estado.** Aceptado (invariante de seguridad).

## ADR-010 — Mantener la infraestructura actual hasta que las métricas justifiquen migrar
**Contexto.** Rate limiting y telemetría son in-memory por instancia; suficiente para una instancia (demo).
**Decisión.** No se introduce Redis/multi-región obligatorio. La abstracción `RateLimiter` permite un backend distribuido opcional (Upstash); el readiness marca **CRÍTICO** una producción distribuida sin store compartido (no pasa en silencio).
**Consecuencias.** Simplicidad para la demo; camino claro y avisado para producción multi-instancia.
**Estado.** Aceptado.
