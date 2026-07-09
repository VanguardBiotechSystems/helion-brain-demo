# Helion — Cerebro conversacional para robot humanoide

**Cerebro conversacional cloud para robot humanoide. Voz en tiempo real. Sin control físico conectado todavía.**

Helion es una aplicación web que da voz, oído y razonamiento a un robot humanoide en desarrollo. Se abre desde una URL, se protege con passcode y permite mantener una conversación hablada natural y de baja latencia con el agente (por defecto, "Atlas"), con interrupciones, subtítulos y acciones de robot **simuladas**. El cuerpo físico del robot aún no está conectado: esta capa está diseñada para integrarse con él más adelante de forma segura (ver [docs/ROBOT_INTEGRATION_ROADMAP.md](docs/ROBOT_INTEGRATION_ROADMAP.md)).

## Características

- **Voz en tiempo real (ruta principal):** OpenAI Realtime API por WebRTC directamente desde el navegador. Detección de turnos semántica, *barge-in* (puedes interrumpir al agente mientras habla), latencia baja.
- **Seguridad de claves:** la API key de OpenAI vive solo en el servidor. El navegador recibe únicamente un token efímero que caduca en minutos.
- **Acceso protegido:** passcode + cookie firmada (HMAC-SHA256, httpOnly). Rate limiting por IP en login, creación de sesiones y chat.
- **UI de producto:** orbe de estado animado (escuchando / pensando / hablando / reconectando / error), subtítulos en vivo, latencia aproximada, controles para mutear, cortar la voz, reiniciar sesión y borrar conversación.
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
| `OPENAI_REALTIME_MODEL` | — | `gpt-realtime-2.1` | Modelo speech-to-speech. |
| `OPENAI_REALTIME_VOICE` | — | `marin` | Voz (`marin`, `cedar`, `alloy`, `echo`, `verse`…). |
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
4. Cuando el estado sea **«Escuchando»**, habla con naturalidad. Prueba:
   - “Hola, ¿quién eres?”
   - “¿Qué puedes hacer y qué no puedes hacer todavía?”
   - Interrúmpelo a mitad de respuesta (debería callarse y escucharte).
   - “Saluda con la mano” → verás una tarjeta de **acción simulada** `WAVE_HAND`.
   - “Muévete hasta la cocina” → responderá con honestidad que no tiene cuerpo conectado.
5. Usa el botón de subtítulos para mostrar/ocultar la transcripción y el panel 🔧 para el diagnóstico.

### Checklist antes de enseñarla

- [ ] Probar la URL desplegada desde otro dispositivo/red la noche anterior.
- [ ] Verificar `https://tu-url/api/health` → `"status":"ok"`.
- [ ] Confirmar crédito disponible en la cuenta de OpenAI.
- [ ] Llevar auriculares con micro (menos eco y mejor detección de turnos).
- [ ] Compartir el passcode por un canal distinto a la URL.
- [ ] Plan B verificado: el modo texto responde aunque falle el micro.

## Compartir con el creador del robot

Envíale: (1) la URL pública, (2) el passcode, (3) una línea de contexto: *“Es el cerebro conversacional del robot: habla con él; los gestos aparecen como acciones simuladas hasta que conectemos el cuerpo”*. No necesita instalar nada.

## Personalización

- **Voz:** cambia `OPENAI_REALTIME_VOICE` (p. ej. `cedar`) y redespliega.
- **Modelo:** `OPENAI_REALTIME_MODEL` (p. ej. `gpt-realtime-2.1-mini` para abaratar).
- **Nombre del agente:** `AGENT_NAME=JARVIS`.
- **Personalidad:** edita `lib/server/personality.ts` (tono, idioma, políticas). Es el único sitio donde se define.

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

## Seguridad

- La API key **nunca** llega al navegador: solo tokens efímeros de minutos.
- Cookie de acceso httpOnly firmada con HMAC-SHA256; comparación de passcode en tiempo constante.
- Rate limiting por IP (login 10/15 min, sesiones 10/10 min por IP y 40/10 min global, chat 30/10 min).
- Logs del servidor con redacción automática de claves.
- **Riesgos conocidos / endurecimiento futuro:** el passcode es compartido (no hay usuarios individuales); el rate limiting es en memoria (en serverless con varias instancias es por instancia — para blindarlo, usa un store compartido tipo Upstash Redis); define `SESSION_SECRET` propio (si se omite se deriva del passcode); considera rotar el passcode tras la demo y poner límites de gasto (*usage limits*) en la cuenta de OpenAI.

## Costes a vigilar

El audio realtime se factura por tokens de audio de entrada/salida y es sensiblemente más caro que el texto. Recomendaciones: cierra las sesiones al terminar (botón **Finalizar**), configura límites de gasto y alertas en el panel de OpenAI, vigila el *usage dashboard* tras cada demo, y usa `gpt-realtime-2.1-mini` si el coste importa más que la calidad máxima. Los precios cambian: consulta la página oficial de precios de OpenAI en lugar de cifras escritas aquí.

## Limitaciones conocidas

- El contexto conversacional vive en la sesión realtime: si la conexión se recrea (reconexión), el agente pierde la memoria de lo hablado (los subtítulos locales se conservan). Las sesiones realtime tienen además un máximo de ~60 minutos.
- La latencia aproximada mostrada es una estimación local (fin de tu frase → primer audio), no una métrica de red exacta.
- El rate limiting en memoria se reinicia con cada despliegue/instancia.
- Sin persistencia: no hay historial entre visitas (decisión deliberada de privacidad para la demo).
- El modo texto fallback no reproduce voz (responde por escrito).

## Qué falta para conectarlo al robot físico

El contrato ya existe (`lib/robot/types.ts`: `RobotAdapter`, `RobotCommand`, `RobotCapability` con `safetyLevel` y `requiresConfirmation`) y hoy lo implementa un `MockRobotAdapter` que solo registra intenciones. El plan completo — gateway en el robot, ROS 2/MQTT/WebSocket con mTLS, parada de emergencia, confirmaciones, simulador y auditoría — está en [docs/ROBOT_INTEGRATION_ROADMAP.md](docs/ROBOT_INTEGRATION_ROADMAP.md).

## Scripts

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Desarrollo con hot reload. |
| `npm run build` / `npm run start` | Build y servidor de producción. |
| `npm run lint` / `npm run typecheck` / `npm run test` | Calidad: ESLint, TypeScript estricto, Vitest. |
