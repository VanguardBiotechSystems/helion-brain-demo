# Escucha disciplinada — gate de audio en tres capas

Objetivo: Helion solo debe "escuchar" cuando una persona le habla. Tecleo, golpes en la mesa, mover el portátil o el ruido ambiental **no** deben activarlo. Se implementa en tres capas independientes.

## Capa 1 — Captura del micrófono (constraints)

`getUserMedia` pide: `echoCancellation: true`, `noiseSuppression: true`, **`autoGainControl: false`** (el AGC amplifica el ruido de fondo hasta convertirlo en "señal") y `channelCount: 1`. No todos los navegadores respetan todo: el panel de diagnóstico muestra las constraints **pedidas vs aplicadas** (`track.getSettings()`), el dispositivo activo, el RMS actual, el ruido de fondo estimado, el umbral dinámico y cuántos ruidos se han bloqueado. Si el navegador ignora `autoGainControl: false`, la app sigue funcionando (el gate local compensa). AGC se puede reactivar con `LOCAL_AUDIO_AGC=true` (micros muy débiles).

## Capa 2 — Gate local (Web Audio, antes de confiar en el VAD del servidor)

La pieza clave: **al modelo solo viaja un clon de la pista del micrófono, silenciado por defecto**. El stream original nunca sale del navegador; lo analiza `AudioGateEngine` (lógica pura en `lib/audio/gateEngine.ts`, testeada en `tests/gateEngine.test.ts`) a ~50 muestras/s:

```
calibrating ──(2 s midiendo la sala)──► idle (En espera)
idle ──(RMS ≥ umbral)──► candidate (Voz detectada…)
candidate ──(energía sostenida ≥ 300 ms)──► open (Escuchando: el audio fluye)
candidate ──(ráfaga < 180 ms que cae)──► idle  [+1 ruido bloqueado]
open ──(energía cae > 200 ms)──► hangover (sigue abierto 700 ms para no cortar palabras)
hangover ──(silencio mantenido)──► idle · ──(vuelve la voz)──► open
```

- **Umbral dinámico**: `max(ruidoDeFondo × LOCAL_AUDIO_THRESHOLD_MULTIPLIER, 0.01)`. La calibración inicial usa el percentil 75 de los primeros `LOCAL_AUDIO_CALIBRATION_MS` ms; en reposo el suelo de ruido se adapta lentamente al ambiente. Botón **«Calibrar ambiente»** en diagnóstico para recalibrar al cambiar de sala.
- **Rechazo de picos**: una tecla o un golpe es una ráfaga breve (<180 ms). Las ráfagas cortas pierden la tolerancia de huecos (rechazo casi instantáneo), así el tecleo rápido no encadena picos hasta abrir el gate. La voz real (segmentos sostenidos con huecos de sílaba ≤140 ms) sí abre tras 300 ms.
- **Histéresis + hangover**: el gate cierra con un umbral inferior (×0.6) y 700 ms de margen para no cortar finales de frase.
- **Coste asumido**: los primeros ~300 ms de cada frase no llegan al modelo (el gate aún está confirmando). En la práctica se pierde como mucho el arranque de la primera sílaba; es el precio del rechazo de ruido y es configurable (`LOCAL_AUDIO_MIN_SPEECH_MS`).

Con `LOCAL_AUDIO_GATE_ENABLED=false` se recupera el comportamiento anterior (audio siempre fluye y "Escuchando" = conectado).

## Capa 3 — VAD y reducción de ruido de OpenAI

Configurable por perfil (`AUDIO_PROFILE`) con overrides individuales:

| Perfil | turn_detection | threshold | silence | prefix | noise_reduction |
| --- | --- | --- | --- | --- | --- |
| `laptop_demo` (defecto) | `server_vad` | 0.6 | 700 ms | 300 ms | `near_field` |
| `near_field` | `semantic_vad` (eagerness auto) | — | — | — | `near_field` |
| `far_field` / `robot_room` | `server_vad` | 0.65 | 800 ms | 400 ms | `far_field` |

Racional: `server_vad` con umbral 0.6 y 700 ms de silencio es deliberadamente conservador — preferimos 200-400 ms más de latencia a falsos positivos. `semantic_vad` (turnos más naturales) sigue disponible: `OPENAI_TURN_DETECTION=semantic_vad` + `OPENAI_VAD_EAGERNESS=low|medium|high|auto`. `input_audio_noise_reduction` se configura explícitamente: `near_field` para micro cercano (portátil), `far_field` para micro lejano (robot en una habitación), `off` para desactivar.

## Semántica de estados en la UI

"Escuchando" ya **no** significa "el micrófono está abierto":

| Estado UI | Significado real |
| --- | --- |
| Conectando… / Permite el micrófono… | Sesión y captura en preparación |
| Calibrando ambiente… | Midiendo el ruido de fondo de la sala |
| **En espera** | Micro conectado, sin voz — no se envía nada |
| Voz detectada… | Energía sostenida, confirmando que es habla |
| **Escuchando** | Voz confirmada, el audio fluye al modelo |
| Pensando… / Hablando | El modelo procesa / responde |

En espera, el orbe respira suave y **no** sigue el nivel del micrófono (el ruido no debe parecer escucha).

## Modo «pulsar para hablar» (plan B para entornos ruidosos)

Botón de mano en la barra de controles → alterna «Escucha: automática / pulsar para hablar». En PTT el audio **solo** fluye mientras se mantiene pulsado el botón grande (puntero o Espacio/Enter con foco); al soltar, el VAD del servidor cierra el turno y responde. El gate local queda en pausa. El mute clásico sigue disponible en ambos modos.

## Checklist de pruebas manuales (antes de la demo)

1. Conectar en una habitación silenciosa → el estado pasa por «Calibrando ambiente…» a «En espera».
2. Pulsar «Calibrar ambiente» en diagnóstico → recalibra sin cortar la sesión.
3. **Teclear durante 10 segundos** → debe seguir «En espera»; el contador «Ruidos bloqueados» sube; no responde.
4. **Golpear suavemente la mesa** → no responde.
5. **Mover el portátil / rozar la carcasa** → no responde.
6. **Hablar a distancia normal** → «Voz detectada…» → «Escuchando» → respuesta.
7. Interrumpir al agente mientras habla → se calla y escucha (barge-in; con gate hay ~300 ms de confirmación).
8. Cambiar a «pulsar para hablar» → solo responde al mantener pulsado.
9. Probar con auriculares con micro (recomendado para la demo: menos eco).
10. Probar con altavoces del portátil → verificar que la voz del agente no se auto-dispara (si ocurre: bajar volumen, subir `LOCAL_AUDIO_THRESHOLD_MULTIPLIER` a 3–3.5, o PTT).

Si el entorno de la demo es ruidoso (cafetería, evento): sube `LOCAL_AUDIO_THRESHOLD_MULTIPLIER` a 3.0–4.0, usa `OPENAI_VAD_THRESHOLD=0.7`, o directamente el modo pulsar para hablar.

## Limitaciones conocidas

- El gate mide energía, no "humanidad": una voz de la tele o música con voz puede abrirlo (es energía sostenida real). El VAD del servidor y la transcripción hacen de segunda barrera.
- Los umbrales por defecto están pensados para portátil en interior; en entornos muy distintos, recalibrar o ajustar variables.
- El nivel RMS depende del hardware del micro; por eso el umbral es relativo al ruido medido, nunca absoluto.
