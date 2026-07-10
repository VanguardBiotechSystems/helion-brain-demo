# Handoff — Demo remota para el creador del robot

Cómo dejar Helion funcionando en una URL pública para que otra persona lo use desde su casa, sin depender de tu ordenador, tu red ni ningún entorno local.

## 1. Subir a GitHub privado (~3 minutos)

```bash
cd helion
git status                      # árbol limpio, sin .env.local
gh repo create helion --private --source=. --push
# (o crea el repo vacío en github.com y: git remote add origin <url> && git push -u origin main)
```

`.env.local` y `.data/` están gitignored; el historial está verificado sin secretos.

## 2. Despliegue en Vercel (~10 minutos)

1. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repo (Next.js autodetectado).
2. **Settings → Environment Variables** — añade:

   | Variable | Valor |
   | --- | --- |
   | `OPENAI_API_KEY` | tu clave (con crédito y acceso a `gpt-realtime-2.1`) |
   | `APP_ACCESS_PASSWORD` | passcode privado para la demo |
   | `SESSION_SECRET` | `openssl rand -hex 32` |
   | `VOICE_ENGINE` | `elevenlabs` (modo demo actual) |
   | `ELEVENLABS_API_KEY` | tu clave de ElevenLabs |
   | `ELEVENLABS_VOICE_ID` | tu voz española elegida |
   | `ELEVENLABS_TTS_MODE` | `http_stream` (recomendado en serverless) |
   | `ELEVENLABS_SPEED` | `1.08` |
   | `AUDIO_PROFILE` | `demo_balanced` |
   | `HELION_LATENCY_MODE` | `fast` |
   | `MEMORY_ENABLED` | `true` |
   | `MEMORY_PROVIDER` | `postgres` (producción) |
   | `DATABASE_URL` | ver §3 |
   | `AGENT_NAME` / `NEXT_PUBLIC_APP_NAME` | `Helion` |

   El resto tiene buenos defaults (copia de `.env.example` si quieres el perfil completo).

3. **Deploy** → obtienes `https://tu-proyecto.vercel.app` con HTTPS (imprescindible para el micrófono).

## 3. Memoria persistente real (Postgres, ~5 minutos)

⚠️ **Honestidad**: con `MEMORY_PROVIDER=local` en Vercel, la memoria funciona pero es **efímera** (se pierde en cada redespliegue/instancia). Para que Helion recuerde de verdad entre días:

1. Crea una base gratuita en [Neon](https://neon.tech) o [Supabase](https://supabase.com).
2. Copia la connection string (con `?sslmode=require`) a `DATABASE_URL`.
3. `MEMORY_PROVIDER=postgres` y redespliega. Las tablas se crean solas al primer uso; las memorias seed del proyecto se insertan automáticamente.

## 4. Verificación antes de compartir

- [ ] `https://tu-url/api/health` → `"status":"ok"`.
- [ ] Abrir la URL desde **otro dispositivo y otra red** (móvil con 4G, por ejemplo).
- [ ] Passcode → pantalla mínima con el orbe → **Encender Helion** → permiso de micro → «Calibrando ambiente» → «En espera».
- [ ] **Prueba de voz**: hablar a volumen normal a 50-80 cm → responde corto y natural.
- [ ] **Prueba de inicio de frase**: "Helion, ¿me escuchas?" → no debe perder el "Helion".
- [ ] **Prueba de ruido**: teclear 10 s y dar un golpe suave → sigue «En espera».
- [ ] **Prueba de interrupción**: cortarle mientras habla → se calla y escucha.
- [ ] **Prueba de memoria**: "Recuerda que X" → cerrar sesión → reconectar → "¿qué recuerdas?" → lo cuenta (con Postgres, sobrevive a redespliegues).
- [ ] **Prueba de apagado/encendido**: Apagar → Encender → funciona sin recargar.
- [ ] **Prueba móvil**: abrir en un móvil (Safari iOS / Chrome Android) → orbe y botón usables.
- [ ] Variables configuradas solo en Vercel (nada en el repo).

## 5. Qué enviarle al creador del robot

1. La **URL** por un canal.
2. El **passcode** por otro canal distinto.
3. Este mensaje sugerido: *"Es el cerebro conversacional del robot. Entra, pulsa Encender, deja el micrófono y háblale con normalidad. Recuerda las conversaciones. Los gestos físicos los registra como simulación: **todavía no controla hardware real** — la integración con el cuerpo irá detrás de una capa segura con parada de emergencia."*

## 6. Batería de frases de prueba (estilo esperado)

| Dices | Respuesta esperada (estilo) |
| --- | --- |
| "Hola." | Saludo de UNA frase, directo ("Ey. Aquí estoy."). |
| "¿Qué eres?" | 1-2 frases: cerebro del robot, escucha/razona/recuerda, sin cuerpo aún. |
| "Recuerda que mañana es la demo." | Confirmación breve ("Hecho, lo recuerdo."). |
| "¿Qué recuerdas del proyecto?" | Sus recuerdos reales, contados con naturalidad. |
| "Explícame la arquitectura." | Aquí SÍ puede extenderse (lo has pedido). |
| "Saluda con la mano." | Registra el gesto simulado y lo dice en una frase honesta. |
| "Mi contraseña es X, guárdala." | Se niega con calma: no guarda credenciales. |

Si suena a chatbot (introducciones, listas, "¿quieres que…?"), algo va mal: revisa que el deploy incluye la personalidad actual.

## 7. Solución rápida de problemas

| Problema | Qué hacer |
| --- | --- |
| El micro no funciona | Candado junto a la URL → Micrófono → Permitir → recargar. En iOS, Safari. Comprobar que la URL es HTTPS. |
| Se activa con ruido | `AUDIO_PROFILE=laptop_demo` (más estricto) o modo pulsar-para-hablar (modo avanzado → botón de mano; el botón principal pasa a "Mantén para hablar"). |
| Hay que hablar muy alto | Recalibrar ambiente (modo avanzado → 🔧 → Calibrar) o bajar `LOCAL_AUDIO_THRESHOLD_MULTIPLIER` a 1.8. |
| No recuerda entre sesiones | ¿`MEMORY_PROVIDER=postgres` con `DATABASE_URL`? Con `local` en Vercel la memoria es efímera. |
| Silencio al responder | Botón «Activar audio» si aparece; revisar volumen; auriculares recomendados. |
| Error de OpenAI | Revisar crédito y clave en el panel de Vercel; `/api/health` para confirmar config. |

## 8. Latencia de voz (modo elevenlabs)

El pipeline rápido es **streaming end-to-end**: OpenAI emite texto en deltas → un chunker corta la primera unidad natural (una frase completa corta sale al instante, sin mínimos) → `/api/tts/stream` reenvía el audio chunked de ElevenLabs según se sintetiza → el navegador reproduce con MediaSource desde los primeros frames (Safari cae a cola de blobs por fragmento). Mientras suena la primera frase, las siguientes se generan en paralelo.

- Métricas por respuesta en modo avanzado → 🔧 → «Latencia (última respuesta)». El número clave es **Fin de voz → primer audio sonando**. Presupuesto típico: silencio VAD 500 ms + primer delta 300-500 ms + TTS 150-300 ms ⇒ ~1-1.4 s percibido en respuestas cortas.
- **Velocidad de habla**: `ELEVENLABS_SPEED` (1.0 neutro, 1.08 por defecto, máx 1.2). `ELEVENLABS_STYLE>0` y `USE_SPEAKER_BOOST=true` mejoran expresividad a costa de latencia.
- **Volver a lo estable si algo falla**: `ELEVENLABS_TTS_MODE=http_full` (pipeline clásico: espera la respuesta completa; más lento pero a prueba de todo). El streaming además cae solo a ese camino si falla antes del primer byte.
- Sobre `websocket_stream`: el WS *stream-input* de ElevenLabs exige un servidor de voz con estado (conexión viva entre peticiones), incompatible con funciones serverless (Vercel). El valor se acepta y se resuelve al streaming HTTP chunked, cuyo TTFB por fragmento es equivalente; la fase 2 natural (gateway de voz con WS caliente multi-contexto) queda descrita aquí como evolución si se despliega en un servidor persistente.
- La memoria no toca el camino crítico: contexto de sesión con presupuesto `MEMORY_MAX_BLOCKING_MS` (200 ms), búsqueda por turno con timeout de 250 ms y extracción siempre después de responder. «¿Qué recuerdas?» sí consulta en profundidad (herramienta, lo pide el usuario).

## 9. Modo avanzado (solo si hace falta depurar)

- **Triple clic** en la línea de estado bajo el orbe, o añadir **`?debug=1`** a la URL.
- Dentro: transcript con caja de texto, controles (mute, cortar voz, PTT, reiniciar), diagnóstico (gate, RMS, umbral, ruidos bloqueados, calibrar) y panel de memoria (listar/buscar/borrar recuerdos).
- Se sale con el botón ✕. La persona de la demo no necesita saber que existe.

## Checklist final de comandos (antes de enviar)

```bash
npm run lint          # sin errores
npm run typecheck     # sin errores
npm run test          # todo verde
npm run build         # compila
git status            # árbol limpio
git log --all -p | grep -cE "sk-[A-Za-z0-9]{12,}"   # solo fixtures de test
npm run dev           # prueba local completa (voz, ruido, memoria)
# deploy en Vercel → /api/health → probar desde móvil con DATOS (red externa)
# enviar URL y passcode por canales separados
```

## Limitaciones honestas (díselas al creador del robot)

- **No controla hardware físico**: todo gesto es simulación registrada; la integración real pasa por `docs/ROBOT_INTEGRATION_ROADMAP.md` (RobotAdapter seguro, simulador, confirmaciones, parada de emergencia).
- **La memoria persistente depende de Postgres**: con `MEMORY_PROVIDER=local` en Vercel, los recuerdos se pierden en cada redespliegue.
- **Las claves viven solo en Vercel**: nadie (ni el navegador) las ve; rota `OPENAI_API_KEY`/`ELEVENLABS_API_KEY` desde sus paneles si sospechas exposición, y cambia `APP_ACCESS_PASSWORD` tras la demo.
- **ElevenLabs factura el audio ya solicitado aunque se cancele** (barge-in/apagado cortan la reproducción al instante, pero los caracteres pedidos cuentan); OpenAI factura por tokens de audio/texto de cada sesión. Pon límites de gasto en ambos paneles.
- La latencia percibida mínima ronda 1–1.5 s en respuestas cortas (silencio VAD + primer token + TTS); el desglose está en el diagnóstico.
- Las sesiones realtime caducan a ~60 min; al reconectar se pierde el hilo inmediato (la memoria persistente se conserva).
