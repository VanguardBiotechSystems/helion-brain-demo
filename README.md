# Helion — Cerebro conversacional para robot humanoide

**Cerebro conversacional cloud para robot humanoide. Voz en tiempo real. Sin control físico conectado todavía.**

Helion es una aplicación web que da voz, oído y razonamiento a un robot humanoide en desarrollo. Se abre desde una URL, se protege con passcode y permite mantener una conversación hablada natural y de baja latencia con el agente (por defecto, "Atlas"), con interrupciones, subtítulos y acciones de robot **simuladas**. El cuerpo físico del robot aún no está conectado: esta capa está diseñada para integrarse con él más adelante de forma segura (ver [docs/ROBOT_INTEGRATION_ROADMAP.md](docs/ROBOT_INTEGRATION_ROADMAP.md)).

## Características

- **Voz en tiempo real (ruta principal):** OpenAI Realtime API por WebRTC directamente desde el navegador. *Barge-in* (puedes interrumpir al agente mientras habla), latencia baja.
- **Escucha disciplinada:** gate de audio local con calibración de ruido ambiente, umbral dinámico y rechazo de picos — teclear, golpear la mesa o mover el portátil **no** activa al robot. «Escuchando» significa "voz humana detectada", no "micro abierto". Modo **pulsar para hablar** como plan B. Ver [docs/AUDIO_GATE.md](docs/AUDIO_GATE.md).
- **Memoria persistente por capas:** episódica, semántica, preferencias, personas, proyecto, procedimientos y seguridad; con curador automático, búsqueda por embeddings, deduplicación, auditoría y borrado. Panel «Memoria» en la UI y control por voz ("recuerda que…", "¿qué recuerdas de…?", "olvida…"). Ver [docs/MEMORY_ARCHITECTURE.md](docs/MEMORY_ARCHITECTURE.md).
- **Escucha permanente con activación inteligente:** el micrófono está siempre activo pero Helion **solo responde cuando se le habla a él** (no cuando lo mencionan). Di «Helion» y pregunta, o llámalo y quedas unos segundos en modo *atento*. Distingue dirigirse de mencionar sin un simple `includes`. Consola conversacional con transcript visible y entrada de texto como fallback. Ver [docs/WAKE_AND_TRANSCRIPT.md](docs/WAKE_AND_TRANSCRIPT.md).
- **Dos motores de voz:** `openai_realtime` (speech-to-speech, latencia mínima, por defecto) o `elevenlabs` (voz española nativa con **TTS en streaming end-to-end**: chunking de texto + audio chunked + reproducción MSE desde los primeros frames, velocidad configurable, métricas de latencia en modo debug). Ver [Voz en español de España](#voz-en-español-de-españa) y [docs/DEMO_HANDOFF.md](docs/DEMO_HANDOFF.md) §8.
- **Seguridad de claves:** la API key de OpenAI vive solo en el servidor. El navegador recibe únicamente un token efímero que caduca en minutos.
- **Acceso protegido:** passcode + cookie firmada (HMAC-SHA256, httpOnly). Rate limiting por IP en login, creación de sesiones y chat.
- **UI de producto en dos caras:** experiencia pública minimalista (orbe aurora vivo + estado + botón liquid glass, sin chat ni paneles) y consola técnica oculta (subtítulos en vivo, latencia, mute, cortar voz, reiniciar, diagnóstico y memoria) tras triple clic en el estado o `?debug=1`.
- **Fallback textual:** si el micrófono o WebRTC fallan, una caja de texto habla con el mismo cerebro vía `/api/chat` (pipeline texto → LLM → texto).
- **Robot simulado:** el agente dispone de una herramienta `robot_gesture` que registra intenciones de gestos (saludar, mover la cabeza…) visibles como tarjetas en pantalla. Nada toca hardware real.
- **Diagnóstico ocultable:** modelo, voz, estado de sesión, WebRTC, último error, navegador y recomendaciones.
- **Privacidad por defecto:** no se guarda audio ni transcripción en ninguna base de datos. La conversación vive solo en la memoria del navegador.

## Arquitectura (resumen)

```
Navegador ──(passcode)──► /api/access ──► cookie firmada httpOnly
Navegador ──(cookie)────► /api/session ──► OpenAI /v1/realtime/client_secrets
                                            └── devuelve token efímero (ek_…)
Navegador ──(token efímero + WebRTC SDP)──► OpenAI /v1/realtime/calls
   ▲ audio bidireccional (Opus) + data channel "oai-events" (eventos, subtítulos, tools)
Navegador ──(cookie)────► /api/chat  (fallback texto)  ──► OpenAI /v1/chat/completions
```

Detalle completo en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requisitos

- Node.js ≥ 18.18 (desarrollado con Node 22).
- Una API key de OpenAI con acceso a los modelos realtime (`gpt-realtime-2.1` por defecto).
- Para producción: cualquier plataforma que ejecute Next.js (Vercel, Render, Railway, Fly.io).

## Variables de entorno

Copia `.env.example` a `.env.local` y rellena los valores. Resumen:

| Variable | Obligatoria | Por defecto | Descripción |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | ✅ | — | Clave secreta de OpenAI (solo servidor). |
| `APP_ACCESS_PASSWORD` | ✅ | — | Passcode de la demo. |
| `SESSION_SECRET` | recomendada | derivado | Secreto para firmar cookies (`openssl rand -hex 32`). |
| `VOICE_ENGINE` | — | `openai_realtime` | Motor de voz: `openai_realtime` o `elevenlabs`. |
| `OPENAI_REALTIME_MODEL` | — | `gpt-realtime-2.1` | Modelo speech-to-speech. |
| `OPENAI_REALTIME_VOICE` | — | `cedar` | Voz OpenAI (recomendadas masculina/juvenil: `cedar`, `ash`, `echo`, `verse`). |
| `ELEVENLABS_API_KEY` | si `elevenlabs` | — | Clave de ElevenLabs (solo servidor). |
| `ELEVENLABS_VOICE_ID` | si `elevenlabs` | `r8cXSGtllevsD7FGkMTx` | Voz recomendada para la demo (ElevenLabs). |
| `ELEVENLABS_MODEL` | — | `eleven_flash_v2_5` | Modelo TTS de baja latencia. |
| `ELEVENLABS_OUTPUT_FORMAT` | — | `mp3_44100_128` | Formato del audio generado. |
| `AUDIO_PROFILE` | — | `demo_balanced` | Perfil de escucha: `demo_balanced`, `laptop_demo` (estricto), `near_field`, `far_field`, `robot_room`. |
| `OPENAI_VAD_*` / `OPENAI_NOISE_REDUCTION` | — | según perfil | Overrides finos del VAD (ver [docs/AUDIO_GATE.md](docs/AUDIO_GATE.md)). |
| `LOCAL_AUDIO_GATE_ENABLED` | — | `true` | Gate local anti-ruido (calibración + umbral dinámico). |
| `LOCAL_AUDIO_*` | — | ver `.env.example` | Calibración, duración mínima de voz, rechazo de picos, multiplicador, AGC. |
| `MEMORY_ENABLED` | — | `true` | Memoria persistente del agente. |
| `MEMORY_PROVIDER` | — | `local` | `local` (archivo JSON) o `postgres` (producción). |
| `DATABASE_URL` | si `postgres` | — | Connection string Postgres (Supabase/Neon, con `sslmode=require`). |
| `MEMORY_*` | — | ver `.env.example` | Modelos de extracción/embeddings, topK, umbral de importancia, retención… |
| `OPENAI_TRANSCRIPTION_MODEL` | — | `gpt-4o-mini-transcribe` | Transcripción para subtítulos. |
| `OPENAI_TRANSCRIPTION_LANGUAGE` | — | `es` | Idioma esperado (`auto` para autodetección). |
| `OPENAI_TURN_DETECTION` | — | `semantic_vad` | `semantic_vad` o `server_vad`. |
| `OPENAI_TEXT_MODEL` | — | `gpt-4.1-mini` | Modelo del fallback textual. |
| `OPENAI_BASE_URL` | — | `https://api.openai.com` | Solo si usas proxy. |
| `AGENT_NAME` | — | `Atlas` | Nombre del agente (personalidad y UI). |
| `NEXT_PUBLIC_APP_NAME` | — | `Helion` | Nombre visible de la app. |

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # y rellena OPENAI_API_KEY y APP_ACCESS_PASSWORD
npm run dev                  # http://localhost:3000
```

Comprobaciones:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

> Nota: el micrófono requiere contexto seguro. `http://localhost` está permitido por los navegadores; cualquier otra URL debe ser HTTPS.

## Despliegue en la nube

### Vercel (recomendado, ~5 minutos)

1. Sube el repositorio a GitHub/GitLab.
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repo (framework autodetectado: Next.js).
3. En **Settings → Environment Variables** añade como mínimo `OPENAI_API_KEY`, `APP_ACCESS_PASSWORD` y `SESSION_SECRET`.
4. **Deploy**. Obtendrás una URL `https://tu-proyecto.vercel.app` con HTTPS (imprescindible para el micrófono).

También puedes desplegar sin GitHub con la CLI: `npx vercel` y `npx vercel --prod` (configura las variables con `npx vercel env add`).

### Render

1. **New → Web Service** → conecta el repo.
2. Build command: `npm install && npm run build` · Start command: `npm run start`.
3. Añade las variables de entorno y despliega.

### Railway

1. **New Project → Deploy from GitHub repo**.
2. Railway detecta Next.js; añade las variables en la pestaña *Variables*.
3. Genera un dominio público en *Settings → Networking*.

En cualquier plataforma: **nunca** subas `.env.local`; usa siempre el gestor de variables del proveedor.

## Cómo probar la demo

1. Abre la URL pública en **Chrome, Edge o Safari recientes** (escritorio recomendado).
2. Introduce el passcode.
3. Pulsa **«Conectar cerebro»** y acepta el permiso de micrófono.
4. Pulsa **«Encender Helion»**; tras «Calibrando ambiente» el estado queda **«En espera»**: habla con naturalidad y pasará a «Voz detectada» → «Escuchando». Prueba:
   - “Hola, ¿quién eres?”
   - “¿Qué puedes hacer y qué no puedes hacer todavía?”
   - Interrúmpelo a mitad de respuesta (debería callarse y escucharte).
   - “Saluda con la mano” → verás una tarjeta de **acción simulada** `WAVE_HAND`.
   - “Muévete hasta la cocina” → responderá con honestidad que no tiene cuerpo conectado.
   - “Recuerda que la demo es mañana a las once” → lo guardará en memoria y lo confirmará.
   - “¿Qué recuerdas del proyecto?” → responderá con sus recuerdos reales.
   - Teclea en el portátil mientras está «En espera» → **no** debe reaccionar (contador de ruidos bloqueados en diagnóstico).
5. Para subtítulos, memoria 🧠, diagnóstico 🔧 y controles técnicos: **modo avanzado** (triple clic en la línea de estado o `?debug=1`). Checklist completa de pruebas de audio en [docs/AUDIO_GATE.md](docs/AUDIO_GATE.md) y de handoff en [docs/DEMO_HANDOFF.md](docs/DEMO_HANDOFF.md).

### Checklist antes de enseñarla

- [ ] Probar la URL desplegada desde otro dispositivo/red la noche anterior.
- [ ] Verificar `https://tu-url/api/health` → `"status":"ok"`.
- [ ] Confirmar crédito disponible en la cuenta de OpenAI.
- [ ] Llevar auriculares con micro (menos eco y mejor detección de turnos).
- [ ] Compartir el passcode por un canal distinto a la URL.
- [ ] Plan B verificado: el modo texto responde aunque falle el micro.

## Compartir con el creador del robot

Guía completa paso a paso (Vercel + Postgres + checklist de prueba externa + solución de problemas) en **[docs/DEMO_HANDOFF.md](docs/DEMO_HANDOFF.md)**. En corto: despliega con las variables de entorno, verifica `/api/health`, prueba desde otra red, y envíale la URL y el passcode por canales separados. No necesita instalar nada.

La pantalla pública es minimalista: orbe + estado + botón de encendido. La consola técnica (transcript, diagnóstico, memoria, controles) queda oculta tras **triple clic en la línea de estado** o **`?debug=1`** en la URL.

## Voz en español de España

El objetivo: que el agente suene como un chico joven español, no como un angloparlante hablando español. Hay dos niveles:

### Nivel 1 — OpenAI Realtime afinado (por defecto)

- La personalidad (`lib/server/personality.ts`) incluye una sección **«Voz y acento»** de prioridad máxima: castellano peninsular, distinción c/z, ritmo conversacional español, vocabulario de España ("vale", "ordenador", "móvil"), prohibición de calcos del inglés y de expresiones latinoamericanas. El modelo speech-to-speech modula el acento según estas instrucciones.
- Voz por defecto: `cedar`. Orden recomendado para masculino/juvenil: **`cedar` → `ash` → `echo` → `verse`**.
- **Honestidad:** ninguna voz de OpenAI es española nativa; son voces multilingües con base angloamericana. Con las instrucciones mejora mucho, pero si el acento sigue sin convencer, usa el Nivel 2.

### Nivel 2 — Voz española nativa con ElevenLabs (`VOICE_ENGINE=elevenlabs`)

En este modo, los **oídos y el cerebro siguen siendo OpenAI Realtime** (misma detección de turnos, interrupciones, contexto y herramientas), pero el modelo responde en texto y la voz la genera **ElevenLabs** en servidor con una voz española real. Latencia algo mayor (≈0,5–1,5 s más); pronunciación claramente nativa.

**Cómo activarlo:**

1. Crea cuenta en [elevenlabs.io](https://elevenlabs.io).
2. Perfil → **API Keys** → crea una clave.
3. **Voice Library** → filtra idioma *Spanish*, acento *Castilian/Peninsular*, género masculino, edad joven → **Add to My Voices**.
4. En *My Voices* → menú ⋯ de la voz → **Copy voice ID**.
5. En `.env.local` (o en tu plataforma cloud):
   ```
   VOICE_ENGINE=elevenlabs
   ELEVENLABS_API_KEY=tu-clave
   ELEVENLABS_VOICE_ID=r8cXSGtllevsD7FGkMTx   # voz recomendada para la demo
   ```
6. Reinicia/redespliega y **prueba antes de la demo**: panel de diagnóstico 🔧 → **«▶ Probar voz española»** (o abre `/api/voice/test` con la sesión iniciada). Oirás: *"Hola, soy Helion. Esta es una prueba de voz en español de España…"*. La prueba funciona aunque el motor activo siga siendo `openai_realtime`, para validar la voz antes de cambiar.

**Avisos importantes:**

- Usar voces de la **Voice Library por API requiere plan de pago** (Starter o superior). En el plan gratuito solo funcionan por API las voces por defecto de tu cuenta. El plan gratuito además da ~10.000 caracteres/mes y exige atribución (sin licencia comercial).
- **No uses clonación de voz ni voces de personas reales sin consentimiento explícito.** Elige solo voces publicadas legalmente en la librería del proveedor.
- La clave de ElevenLabs nunca llega al navegador: toda síntesis pasa por `/api/tts` en servidor.

## Personalización

- **Motor de voz:** `VOICE_ENGINE=openai_realtime | elevenlabs` (ver sección anterior).
- **Voz OpenAI:** cambia `OPENAI_REALTIME_VOICE` (p. ej. `ash`) y redespliega.
- **Voz ElevenLabs:** cambia `ELEVENLABS_VOICE_ID` y redespliega; valida con «Probar voz española».
- **Modelo:** `OPENAI_REALTIME_MODEL` (p. ej. `gpt-realtime-2.1-mini` para abaratar).
- **Nombre del agente:** `AGENT_NAME=JARVIS`.
- **Personalidad:** edita `lib/server/personality.ts` (tono, idioma, acento, políticas). Es el único sitio donde se define.

## Solución de problemas

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| «No hay permiso para usar el micrófono» | Permiso denegado | Candado junto a la URL → Micrófono → Permitir → reconectar. |
| «El navegador ha bloqueado la reproducción de audio» | Política de autoplay | Botón **Activar audio** del aviso. |
| «El servidor no puede autenticarse con OpenAI» | API key inválida | Revisa `OPENAI_API_KEY` en la plataforma y redespliega. |
| «El modelo de voz configurado no está disponible» | Cuenta sin acceso al modelo | Prueba `OPENAI_REALTIME_MODEL=gpt-realtime` o `gpt-realtime-2.1-mini`. |
| «La cuenta de OpenAI no tiene crédito» | Cuota agotada | Añade crédito en la facturación de OpenAI. |
| «La conexión de audio en tiempo real ha fallado» | Firewall/VPN restrictiva (UDP bloqueado) | Cambia de red o usa el modo texto; revisa el panel de diagnóstico. |
| La voz se corta al perder Wi-Fi | Red caída | La app muestra «Reconectando…» y reintenta sola al volver la red. |
| «Configuración pendiente» al abrir la URL | Faltan variables de entorno | Añádelas en la plataforma y redespliega. |
| El agente no me oye pero estoy conectado | Micro silenciado o dispositivo de entrada equivocado | Revisa el botón de mute y el selector de micrófono del sistema. |
| La voz suena a extranjero hablando español | Límite de las voces OpenAI | Prueba `cedar`/`ash`, y si no convence activa `VOICE_ENGINE=elevenlabs` con una voz castellana. |
| «No se pudo generar la voz española externa» | Credenciales/cuota de ElevenLabs | Revisa `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, créditos y que la voz sea usable por API en tu plan. |

## Seguridad

- La API key **nunca** llega al navegador: solo tokens efímeros de minutos.
- Cookie de acceso httpOnly firmada con HMAC-SHA256; comparación de passcode en tiempo constante.
- Rate limiting por IP (login 10/15 min, sesiones 10/10 min por IP y 40/10 min global, chat 30/10 min).
- Logs del servidor con redacción automática de claves.
- **Riesgos conocidos / endurecimiento futuro:** el passcode es compartido (no hay usuarios individuales); el rate limiting es en memoria (en serverless con varias instancias es por instancia — para blindarlo, usa un store compartido tipo Upstash Redis); define `SESSION_SECRET` propio (si se omite se deriva del passcode); considera rotar el passcode tras la demo y poner límites de gasto (*usage limits*) en la cuenta de OpenAI.

## Costes a vigilar

El audio realtime se factura por tokens de audio de entrada/salida y es sensiblemente más caro que el texto. Recomendaciones: cierra las sesiones al terminar (botón **Finalizar**), configura límites de gasto y alertas en el panel de OpenAI, vigila el *usage dashboard* tras cada demo, y usa `gpt-realtime-2.1-mini` si el coste importa más que la calidad máxima. Los precios cambian: consulta la página oficial de precios de OpenAI en lugar de cifras escritas aquí.

## Escucha y memoria (resumen)

- **Audio**: tres capas — constraints de captura (AGC off), gate local con calibración/umbral dinámico/rechazo de picos (`lib/audio/gateEngine.ts`), y VAD + `noise_reduction` de OpenAI parametrizados por `AUDIO_PROFILE`. Modo «pulsar para hablar» en la barra de controles. Detalles, racional y checklist de pruebas manuales: [docs/AUDIO_GATE.md](docs/AUDIO_GATE.md).
- **Memoria**: tipos (episódica/semántica/preferencias/personas/proyecto/procedimientos/seguridad), Memory Curator con esquema JSON estricto, embeddings, dedup, consolidación, auditoría y seeds del proyecto. Para borrar recuerdos: panel 🧠 (borrar/archivar por recuerdo) o por voz ("olvida lo que te dije sobre…"). Producción con Supabase/Neon: crea la base, pon `DATABASE_URL` y `MEMORY_PROVIDER=postgres` — las tablas se crean solas. Detalles: [docs/MEMORY_ARCHITECTURE.md](docs/MEMORY_ARCHITECTURE.md).

## Limitaciones conocidas

- El contexto conversacional vive en la sesión realtime: si la conexión se recrea (reconexión), el agente pierde la memoria de lo hablado (los subtítulos locales se conservan). Las sesiones realtime tienen además un máximo de ~60 minutos.
- La latencia aproximada mostrada es una estimación local (fin de tu frase → primer audio), no una métrica de red exacta.
- El rate limiting en memoria se reinicia con cada despliegue/instancia.
- Sin persistencia: no hay historial entre visitas (decisión deliberada de privacidad para la demo).
- El modo texto fallback no reproduce voz (responde por escrito) cuando no hay sesión de voz activa; con sesión activa, lo escrito sí se responde con voz.
- En modo `elevenlabs` la voz tarda un poco más (se sintetiza al completarse la respuesta) y el consumo de caracteres cuenta contra la cuota de ElevenLabs.
- El gate local recorta ~160 ms del arranque de cada frase (pre-apertura en fase de confirmación); es deliberado y configurable.
- Con `MEMORY_PROVIDER=local` en serverless (Vercel), los recuerdos no sobreviven a los redespliegues: usa Postgres en producción.
- La recuperación de memoria por turno alimenta a las respuestas siguientes (la respuesta en curso usa el contexto de inicio de sesión y las herramientas).

## Qué falta para conectarlo al robot físico

El contrato ya existe (`lib/robot/types.ts`: `RobotAdapter`, `RobotCommand`, `RobotCapability` con `safetyLevel` y `requiresConfirmation`) y hoy lo implementa un `MockRobotAdapter` que solo registra intenciones. El plan completo — gateway en el robot, ROS 2/MQTT/WebSocket con mTLS, parada de emergencia, confirmaciones, simulador y auditoría — está en [docs/ROBOT_INTEGRATION_ROADMAP.md](docs/ROBOT_INTEGRATION_ROADMAP.md).

## Scripts

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Desarrollo con hot reload. |
| `npm run build` / `npm run start` | Build y servidor de producción. |
| `npm run lint` / `npm run typecheck` / `npm run test` | Calidad: ESLint, TypeScript estricto, Vitest. |
