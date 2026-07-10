# Memoria persistente de Helion

Un robot sin memoria no es convincente. Helion implementa memoria por capas con extracción curada, recuperación semántica, deduplicación, consolidación, auditoría y borrado. **No** es "guardar el chat entero": solo se persiste lo que aporta continuidad.

## Tipos de memoria

| Tipo | Qué guarda | Ejemplo |
| --- | --- | --- |
| `episodic` | Eventos concretos con fecha | "El 10-07-2026 se probó la voz y se prefirió OpenAI" |
| `semantic` | Hechos estables | "Helion es el cerebro de un robot humanoide" |
| `preference` | Gustos y elecciones (explícitas > inferidas, vía `confidence`) | "Prefiere voz juvenil española" |
| `person` | Personas y relaciones (sin datos sensibles innecesarios) | "Juanma: creador del proyecto" |
| `project` | Estado técnico y decisiones | "Se descarta ElevenLabs de momento" |
| `procedural` | Cómo hacer cosas | "Para calibrar el micro: diagnóstico → Calibrar ambiente" |
| `safety` | Reglas no negociables (siempre primero en el contexto, no se olvidan por voz) | "Sin control físico sin capa segura" |

La **memoria de trabajo** (lo dicho hace minutos) vive en la propia sesión realtime; además el cliente acumula los intercambios en RAM para alimentar al curador.

## Modelo de datos

`memory_items` (id, profile_id, type, title, content, canonical_content, summary, embedding, importance 0-1, confidence 0-1, source `conversation|explicit_user_request|system|manual|inferred`, sensitivity `normal|private|sensitive|secret`, status `active|archived|deleted`, tags, related_entities, created/updated/last_accessed_at, access_count, expires_at, provenance, version) + `memory_relations` (supports/contradicts/updates/duplicates/…) + `memory_events` (auditoría: created/updated/retrieved/archived/deleted/consolidated con actor y razón) + `memory_profiles`. Tipos completos en `lib/server/memory/types.ts`.

## Almacenamiento (`MemoryStore`)

- **`MEMORY_PROVIDER=local`** (defecto): JSON en `.data/memory.json` (gitignored). Para desarrollo y servidores con disco persistente (Render/Railway). En serverless (Vercel) el disco es efímero: funciona, pero los recuerdos no sobreviven a los redespliegues — se avisa en logs.
- **`MEMORY_PROVIDER=postgres`** (producción): `PostgresMemoryStore` con `pg`; crea las tablas automáticamente al arrancar (`CREATE TABLE IF NOT EXISTS`). Compatible con **Supabase/Neon/RDS**: crea una base, copia la connection string a `DATABASE_URL` (con `?sslmode=require`) y despliega. Los embeddings se guardan como JSONB y el coseno se calcula en Node — suficiente a esta escala y sin exigir pgvector (la migración a pgvector es directa cuando haga falta: columna `vector`, índice HNSW y `ORDER BY embedding <=> $1`).

## Flujo

**A. Durante la conversación** — no se guarda nada frase a frase. El cliente acumula intercambios (usuario/agente) en RAM.

**B. Extracción (Memory Curator)** — cada ~2 turnos del agente (y al desconectar) el cliente envía la ventana pendiente a `POST /api/memory/extract`. Un prompt interno frío y separado del conversacional (`lib/server/memory/curator.ts`, modelo `MEMORY_EXTRACTION_MODEL`) devuelve JSON con esquema estricto (`response_format: json_schema`): `shouldRemember, memoryType, title, canonicalContent, importance, confidence, sensitivity, tags, relatedEntities, updateCandidates, contradictionCandidates, requiresUserConfirmation, reason`. JSON inválido ⇒ no se guarda nada. Filtros duros: importancia < `MEMORY_MIN_IMPORTANCE` se descarta ("el usuario dijo hola" nunca entra), secretos se rechazan, `sensitive` queda pendiente de confirmación si `MEMORY_REQUIRE_CONFIRMATION_FOR_SENSITIVE=true`.

**C. Recuperación** — dos momentos: (1) al **crear la sesión**, el servidor construye un bloque curado (seguridad primero, luego importancia×recencia, presupuesto ~1200 caracteres) e inyecta los recuerdos en las instrucciones; (2) **por turno**, al completarse cada transcripción el cliente consulta `POST /api/memory/search` (embeddings + palabras clave + importancia + recencia, `MEMORY_RETRIEVAL_TOP_K`) e inyecta los recuerdos nuevos como mensaje de sistema en la conversación — disponibles para las siguientes respuestas (limitación honesta: en voz realtime la respuesta al turno actual ya está en curso cuando llega su transcripción; el arranque de sesión cubre la continuidad y las herramientas cubren las preguntas directas).

**D. Consolidación** — dedup al guardar (similitud ≥0.92 ⇒ actualiza el existente y sube versión, relación `updates/duplicates`, evento) y `POST /api/memory/consolidate` fusiona casi-duplicados del mismo tipo (≥0.93). La retención (`MEMORY_RETENTION_DAYS`) archiva episódicos viejos poco importantes.

**E. Control por voz (herramientas del modelo)** — `memory_save` ("recuerda que…"), `memory_recall` ("¿qué recuerdas de…?"), `memory_forget` ("olvida lo que te dije sobre…"). Se ejecutan desde el cliente contra los endpoints autenticados; el agente confirma en una frase, sin teatralizar ("Vale, como habíamos decidido…" — nunca "según mi memoria semántica nº 17").

## Endpoints (todos con cookie firmada + rate limiting por sesión)

`GET /api/memory` (lista) · `POST /api/memory` (crear) · `PATCH|DELETE /api/memory/:id` (corregir/archivar/borrar — borrado lógico con evento de auditoría) · `POST /api/memory/search` · `POST /api/memory/extract` · `POST /api/memory/forget` · `POST /api/memory/consolidate`.

## UI

Panel «Memoria» (icono 🧠): toggle de memoria por sesión (el interruptor maestro es `MEMORY_ENABLED`), lista de recuerdos activos con tipo/importancia/fecha, buscador semántico, borrar/archivar por recuerdo, «Extraer memoria de esta conversación», recuerdos usados en la última respuesta, proveedor activo y contador de guardados.

## Reglas duras de privacidad

- **Jamás credenciales**: filtro determinista (`lib/server/memory/redaction.ts`) antes de todo guardado — claves `sk-`/`ek_`, JWTs, hex/base64 largos, "contraseña/passcode/token/api key + valor". Si el usuario dicta una clave, Helion dice que no la guardará (regla en su personalidad).
- Datos sensibles solo con petición explícita y confirmación.
- Sin audio crudo ni transcripciones completas por defecto: solo recuerdos canónicos breves con procedencia.
- Borrado y archivado siempre disponibles; todo cambio deja evento de auditoría con actor y razón.
- Las memorias `safety` no se borran por voz (solo desde el panel/API).
- Modo sin memoria: `MEMORY_ENABLED=false` (servidor) o el toggle del panel (sesión).

## Semilla inicial

Con el almacén vacío se insertan 7 recuerdos `system` (qué es Helion, reglas de seguridad, preferencia OpenAI sobre ElevenLabs, forma de la demo, prioridad actual). Sin secretos. Ver `lib/server/memory/seeds.ts`.

## Limitaciones de esta primera versión

- Las memorias `sensitive` pendientes de confirmación se descartan con aviso en la respuesta de extracción (no hay aún cola de confirmación interactiva).
- La recuperación por turno beneficia a las respuestas siguientes (ver C).
- Un solo perfil (`default`); multi-usuario requeriría autenticación por persona.
- La consolidación es heurística (similitud), no razonada por modelo.
- Provider local en serverless = memoria efímera por instancia (usar Postgres).
