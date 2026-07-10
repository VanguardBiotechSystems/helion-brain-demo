# Plan de prueba — Passcode único + identidad conversacional

Modelo: **un solo Helion, una URL, un passcode general** (`APP_ACCESS_PASSWORD`). El passcode solo abre la puerta; la identidad se resuelve HABLANDO. La memoria es común pero segmentada por la identidad actual (filtrado en servidor).

## Variables (Vercel)
`APP_ACCESS_PASSWORD` (única entrada) · opcionales: `OWNER_IDENTITY_PIN` (PIN verbal para confirmar al owner; sin él, el owner queda en modo demo con aviso en debug), `KNOWN_PROFILES_JSON` (alias extra), `IDENTITY_*` (defaults sensatos). **Obsoletas como identidad**: `OWNER_PASSCODE`/`SERGIO_PASSCODE`/`INVESTOR_PASSCODE` (si siguen definidas, solo abren la puerta).

## Caso A — Juanma
1. Entra con el passcode general → Helion: «Antes de empezar, dime con quién estoy hablando.»
2. "Soy Juanma." → si hay `OWNER_IDENTITY_PIN`, te pedirá el PIN; dilo. → «Te tengo, Juanma.» y verás "Reconstruyendo contexto…" (la sesión se reinicia con tu memoria autorizada).
3. "Recuerda esto solo para mí: Sergio aún no debe saber X." → privado de Juanma.
4. "Recuerda para el proyecto que la placa es una Jetson." → proyecto.
5. Debug 🔧: «Identidad actual: Juanma · owner · confirmed» + scopes. Botón «Resetear identidad».

## Caso B — Sergio (mismo passcode)
"Soy Sergio, el del robot." → perfil sergio sin PIN. "¿Qué recuerdas del proyecto?" → ve la Jetson y lo compartible; **jamás** lo privado de Juanma (no llega al modelo). Sus "recuerda que…" del robot → proyecto.

## Caso C — Inversor
"Soy un inversor." → visitante: solo público/demo/system_self; sus notas quedan privadas suyas.

## Caso D — Cambio en la misma sesión
Juanma: "Ahora está hablando Sergio." → identity_set → reinicio de contexto → los privados de Juanma desaparecen de la conversación. "Olvida quién soy" → identity_reset → desconocido (solo público/demo).

## Autoconocimiento
"¿Cómo sabes quién soy?" → explica: passcode = puerta; identidad = conversación; memoria segmentada; puede cambiar de interlocutor; sin identidad usa solo material público.
