# Escucha permanente con activación inteligente + consola conversacional

> **Nota (2026-07-11):** el modo `directed` (responder solo si se le habla a
> Helion) resultó poco fiable en pruebas —depende de la transcripción en vivo—
> y está **desactivado por defecto**: `WAKE_MODE=open`, Helion responde a la
> voz detectada como siempre. Lo de abajo describe el modo `directed`, que
> queda como **opt-in experimental** (`WAKE_MODE=directed`). La consola
> conversacional (transcript + texto) sigue activa en ambos modos.

Helion deja de responder a cualquier voz detectada y pasa a comportarse como un agente serio: **el micrófono está siempre activo, pero solo responde cuando se le HABLA a él**, no cuando lo mencionan. Además incorpora una consola conversacional con transcript visible y entrada de texto como fallback.

## Modo «Di "Helion" para hablar»

Con `WAKE_MODE=directed` (por defecto), el servidor NO responde automáticamente a cada turno (`create_response=false`). El VAD segmenta y transcribe, y el cliente ejecuta el **AddressingGate** (`lib/wake/addressingGate.ts`), que decide si el turno va **dirigido** a Helion. Solo entonces se pide la respuesta (`response.create`). El barge-in sigue activo (`interrupt_response=true`): la voz del usuario corta a Helion.

### Qué activa y qué NO
| Frase | ¿Responde? | Por qué |
|---|---|---|
| «Hola, ¿cómo estás?» | ❌ | sin nombre, no atento |
| «Hola Helion, ¿cómo estás?» | ✅ | vocativo directo |
| «Helion, ¿cómo estás?» | ✅ | vocativo directo |
| «Helion» / «¿Helion?» | ✅ | llamada aislada → **modo atento** |
| «Helion está muy conseguido» | ❌ | mención en 3ª persona |
| «Estamos hablando de Helion» | ❌ | mención |
| «Sergio, mira Helion» | ❌ | el vocativo es Sergio |
| «Tengo una pregunta para Helion: ¿qué eres?» | ✅ | referencia directa preposicional |
| «Helion, para» / «Helion, apágate» | ✅ | comando |
| «para» (mientras Helion habla) | ✅ | comando de seguridad |
| «para» (en silencio, sin nombre) | ❌ | no dirigido |
| «Helion, soy Sergio» | ✅ | dirigido + intención de identidad |

### Modo atento
Si llamas a Helion sin pedir nada («Helion»), entra en estado **atento** durante `WAKE_ATTENTION_WINDOW_MS` (10 s por defecto). Dentro de esa ventana, el siguiente turno se responde **aunque no repitas el nombre**:

```
Tú: «Helion.»            → Helion: «Estoy aquí.» (atento 10 s)
Tú: «¿Qué recuerdas de la demo?»  → responde (dentro de la ventana)
```

### Clasificador híbrido
Reglas rápidas primero (deterministas, sin latencia). Solo para casos **ambiguos** (`uncertain`), y si `WAKE_MODEL_CLASSIFIER_ENABLED=true`, se consulta `/api/wake/classify` con timeout bajo (~400 ms). Si no responde a tiempo → **fallback seguro: no responder** salvo alta confianza por reglas. Las frases claras («Helion, dime algo») se resuelven por reglas, sin latencia añadida.

## Voz vs texto

- **Voz**: pasa por el AddressingGate (requiere dirigirse a Helion).
- **Texto** (consola): enviar por el campo **ES intención explícita**, así que se considera **dirigido** aunque no incluya «Helion». Escribir «¿Qué eres?» responde.
- Con `TEXT_INPUT_SPEAKS_RESPONSE=true`, las respuestas al texto también se hablan (voz ElevenLabs).

## Consola conversacional (transcript + control)

`ConversationConsole` (glass, colapsable, móvil): muestra lo que dijo el usuario, lo que Helion responde, y — si `TRANSCRIPT_SHOW_IGNORED_UTTERANCES=true` — los turnos **ignorados** con una nota sutil («Mención detectada, no respondida»). Indica si el turno fue voz o texto. La entrada de texto: Enter envía, Shift+Enter salta de línea, botón deshabilitado si está vacío; funciona **aunque el micrófono falle**.

- Activar/desactivar: `TRANSCRIPT_PANEL_ENABLED`, `TEXT_INPUT_ENABLED`, `TRANSCRIPT_DEFAULT_OPEN`.
- La estética sigue siendo premium y minimalista; no es un chat genérico.

## Privacidad de las frases ignoradas

El micrófono está siempre activo, así que:
- **No se guarda audio crudo** ni transcripciones de fondo por defecto (`TRANSCRIPT_PERSIST=false`).
- Las frases **no dirigidas NO se envían al cerebro** ni crean memoria ni cambian identidad; se **purgan del contexto** de la sesión (`conversation.item.delete`).
- `WAKE_ALLOW_BACKGROUND_TRANSCRIPT=true` solo muestra el texto ignorado en la consola local (no persistente).
- La memoria solo guarda tras una **activación válida** o en modo atento; el texto escrito cuenta como dirigido.
- Sigue existiendo el botón de **apagar** y el modo **pulsar-para-hablar** como alternativa.

## Variables (Vercel)
```
WAKE_MODE=directed
WAKE_AGENT_NAMES=Helion,Elion,Helión
WAKE_REQUIRE_DIRECT_ADDRESS=true
WAKE_ATTENTION_WINDOW_MS=10000
WAKE_MIN_CONFIDENCE=medium
WAKE_ALLOW_BACKGROUND_TRANSCRIPT=true
WAKE_RESPOND_TO_MENTIONS=false
WAKE_MODEL_CLASSIFIER_ENABLED=true
WAKE_RULES_FIRST=true
TEXT_INPUT_ENABLED=true
TRANSCRIPT_PANEL_ENABLED=true
TRANSCRIPT_DEFAULT_OPEN=true
TEXT_INPUT_SPEAKS_RESPONSE=true
TRANSCRIPT_SHOW_IGNORED_UTTERANCES=true
TRANSCRIPT_PERSIST=false
```

## Qué decirle a Sergio
«Helion ahora escucha siempre pero solo contesta cuando le hablas a él: dile "Helion" y pregúntale, o llámalo "Helion" y tienes unos segundos para seguir sin repetir el nombre. Si menciono Helion en una frase sobre él, no interrumpe. Si el micro falla, escríbele por el panel de abajo. La voz es la de ElevenLabs (`r8cXSGtllevsD7FGkMTx`).»

## Limitaciones honestas
- El clasificador de modelo depende de la red; con timeout, prevalece el fallback seguro (no responder). Las reglas cubren los casos frecuentes sin latencia.
- La transcripción parcial que alimenta al gate es la del propio pipeline STT; su calidad depende del transcriptor.
- `TEXT_INPUT_SPEAKS_RESPONSE=false` no está cableado para silenciar la voz por turno (la respuesta se habla igual); documentado como pendiente.
- El gate opera sobre transcripción, no sobre biometría de voz: no distingue quién habla (sin diarización, por diseño).
