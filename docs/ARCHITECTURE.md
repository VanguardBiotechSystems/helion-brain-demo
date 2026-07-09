# Arquitectura — Helion (cerebro conversacional)

## Visión general

Helion es una aplicación **Next.js 15 (App Router) + React 19 + TypeScript estricto**, sin SDKs pesados: la integración con OpenAI se hace contra la API REST/WebRTC oficial con `fetch` y `RTCPeerConnection` nativos. Esto reduce dependencias, hace el flujo auditable línea a línea y evita acoplarse a versiones de SDK.

```
┌──────────────────────────── Navegador ────────────────────────────┐
│  AccessGate → VoiceAgentPage                                      │
│    useRealtimeSession (máquina de estados WebRTC)                 │
│    useConversationLog (subtítulos, solo memoria)                  │
│    useMicrophoneLevel ×2 (mic + voz del agente, refs a 60fps)     │
│    MockRobotAdapter (acciones simuladas)                          │
└──────┬──────────────────────────────┬─────────────────────────────┘
       │ 1. cookies + JSON             │ 3. SDP + audio + data channel
       ▼                               ▼
┌──── Servidor Next.js ────┐   ┌──── OpenAI ─────────────────────┐
│ /api/access  (passcode)  │   │ POST /v1/realtime/client_secrets│◄─2─ servidor
│ /api/session (token ef.) │──►│ POST /v1/realtime/calls (WebRTC)│
│ /api/chat    (fallback)  │   │ POST /v1/chat/completions       │
│ /api/config, /api/health │   └─────────────────────────────────┘
│ env · access · rateLimit │
│ personality · realtime   │
└──────────────────────────┘
```

## Flujo de audio en tiempo real (ruta principal)

1. **Acceso**: el usuario introduce el passcode → `POST /api/access` valida en tiempo constante y emite una cookie httpOnly firmada (HMAC-SHA256, 24 h). La página raíz se renderiza en servidor y decide qué pantalla mostrar según esa cookie.
2. **Sesión**: al pulsar «Conectar cerebro», el cliente pide `POST /api/session`. El servidor (con la cookie verificada y rate limiting aplicado) llama a `POST /v1/realtime/client_secrets` de OpenAI con la **configuración completa de sesión**: modelo, voz, instrucciones de personalidad, detección de turnos (`semantic_vad` con `interrupt_response: true`), transcripción de entrada y herramientas. OpenAI devuelve un **client secret efímero** (`ek_…`, TTL 10 min).
3. **WebRTC**: el navegador crea `RTCPeerConnection`, añade la pista del micrófono (`echoCancellation`, `noiseSuppression`, `autoGainControl`), abre el data channel `oai-events`, genera la SDP offer y la envía a `POST /v1/realtime/calls` autenticando con el token efímero. La respuesta es la SDP answer. Desde ahí el audio fluye en ambos sentidos por Opus/RTP con latencia mínima.
4. **Eventos**: por el data channel llegan eventos del servidor que alimentan la máquina de estados y los subtítulos:
   - `input_audio_buffer.speech_started/stopped` → escuchando / pensando (y marca de tiempo para estimar latencia).
   - `conversation.item.input_audio_transcription.delta/completed` → subtítulos del usuario.
   - `response.created`, `response.output_audio_transcript.delta/done` → subtítulos del agente (se aceptan también los nombres beta `response.audio_transcript.*` por compatibilidad).
   - `output_audio_buffer.started/stopped/cleared` (específicos de WebRTC) → hablando / vuelta a escuchar.
   - `response.function_call_arguments.done` y `response.done` → herramientas.
   - `error` → aviso en UI (se filtran errores benignos de cancelación).
5. **Barge-in**: `semantic_vad` con `interrupt_response: true` hace que el servidor corte la respuesta cuando el usuario habla encima. El botón «cortar voz» envía además `response.cancel` + `output_audio_buffer.clear`.
6. **Latencia percibida**: se mide localmente `speech_stopped → primer output_audio_buffer.started / primer delta de transcripción` y se muestra como chip (~ms).

## Seguridad de claves

- `OPENAI_API_KEY` solo se lee en módulos de servidor (`lib/server/*`, rutas `/api/*`). Ningún componente cliente la importa; no existe `NEXT_PUBLIC_` para secretos; no se usa ningún patrón tipo `dangerouslyAllowBrowser`.
- El navegador recibe **únicamente** el client secret efímero, que caduca en 10 minutos y solo sirve para el handshake realtime.
- Los logs del servidor pasan por una redacción defensiva (`sk-…`, `ek_…`, `Bearer …`).
- Cabeceras de seguridad globales (`X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy` que restringe micrófono al propio origen).

## Control de acceso y rate limiting

- Token de cookie: `expiración.nonce.HMAC(secret, payload)`. Verificación con `timingSafeEqual`; passcode comparado por hash SHA-256 en tiempo constante.
- `SESSION_SECRET` independiente recomendado; si falta se deriva de forma determinista del passcode (documentado como riesgo).
- Limitadores en memoria (ventana deslizante): login 10/15 min por IP; sesiones realtime 10/10 min por IP **y** 40/10 min global (protege la factura ante abuso distribuido); chat 30/10 min por IP. En serverless multi-instancia son por instancia (mejor esfuerzo); el endurecimiento con Redis compartido está descrito en el README.

## Máquina de estados del cliente

`useRealtimeSession` expone: `idle → requesting_mic → connecting → listening ⇄ thinking ⇄ speaking`, más `reconnecting` y `error`. Decisiones clave:

- **Reconexión**: ante `connectionState: failed/disconnected` o cierre del data channel no intencionado → limpieza del peer (conservando el micrófono), backoff exponencial (0,8 s × 2ⁿ, máx. 3 intentos) y nueva sesión efímera. Si `navigator.onLine === false`, se espera al evento `online`. La transcripción local se conserva; el contexto del modelo se pierde (limitación documentada).
- **Autoplay**: el `<audio>` se crea tras un gesto del usuario; si aun así el navegador bloquea `play()`, se muestra el error `audio_playback` con botón «Activar audio».
- **Mute**: `track.enabled = false` (no se renegocia SDP).
- **Niveles de audio**: dos `AnalyserNode` (micrófono y stream remoto) escriben en refs a 60 fps; el orbe canvas las lee sin re-renderizar React.

## Herramientas simuladas del robot

- El servidor declara `robot_gesture` en la configuración de sesión (JSON Schema con enum de gestos seguros).
- Cuando el modelo la invoca, el cliente ejecuta `MockRobotAdapter.execute()` — que **solo registra la intención** (consola + tarjeta en el panel) — y devuelve `function_call_output` con `hardware_connected: false`, seguido de `response.create` para que el agente verbalice el resultado.
- El contrato de futuro (`RobotAdapter`, `RobotCommand`, `RobotCapability` con `safetyLevel`, `requiresConfirmation`, `available:false`) vive en `lib/robot/types.ts`. El mock nunca devuelve `executed`.

## Fallback texto (STT→LLM→TTS encadenado, versión mínima)

La caja de texto del panel usa la **misma sesión realtime** si está conectada (`conversation.item.create` + `response.create`, el agente responde con voz). Si no hay sesión, cae a `POST /api/chat` → `/v1/chat/completions` con la misma personalidad en modo texto. Esto garantiza que la demo nunca queda muerta por un problema de micrófono. Un pipeline completo STT→LLM→TTS por lotes se consideró y se descartó para la ruta principal por latencia; el diseño permite añadirlo detrás de `/api/chat` si algún día hace falta.

## Manejo de errores

Taxonomía única en `lib/shared/errors.ts` (16 códigos) con mensaje humano + pista accionable por código. Reglas:

- El servidor mapea los fallos de OpenAI (401/403/404/429/5xx) a códigos seguros; el detalle técnico se queda en logs redactados.
- El cliente mapea errores de `getUserMedia` (`NotAllowedError`, `NotFoundError`…), de red y de WebRTC.
- El banner de error ofrece acción contextual (Reintentar / Activar audio / Recargar).
- El panel de diagnóstico muestra el último error y recomendaciones derivadas del estado real.

## Decisiones y alternativas

| Decisión | Motivo |
| --- | --- |
| WebRTC nativo en lugar del SDK `@openai/agents-realtime` | Menos dependencias, control total del ciclo de vida, más fácil de auditar y de depurar en demo. |
| Sin base de datos | Privacidad por defecto y cero fricción de despliegue. |
| CSS propio en lugar de Tailwind | Una sola pantalla; evita toolchain extra y garantiza el build. |
| Configuración de sesión en el token efímero (no en el cliente) | El cliente no puede alterar instrucciones, modelo ni herramientas. |
| Rate limit global además de por IP | Un passcode filtrado no puede fundir la cuenta ilimitadamente. |

## Estructura de carpetas

```
app/            páginas (server) y rutas API
components/     UI (AccessGate, VoiceAgentPage, orbe, transcripción, diagnóstico…)
hooks/          useRealtimeSession, useConversationLog, useMicrophoneLevel, useAccessSession
lib/server/     env, access, rateLimit, realtime, personality, log
lib/robot/      contrato RobotAdapter + MockRobotAdapter + tools realtime
lib/shared/     tipos y taxonomía de errores compartidos
tests/          unit tests (Vitest) de env, access, rate limit y robot
docs/           este documento + roadmap de integración física
```
