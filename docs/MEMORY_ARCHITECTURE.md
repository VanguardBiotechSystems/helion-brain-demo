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

---

# Bloque 2 — Memoria cognitiva, identidad natural y cierre de inyección

## 1. Clase de afirmación (`assertionType`)

Cada recuerdo lleva `assertionType`: `fact` (realidad estable), `opinion` (preferencia/valoración de una persona), `instruction` (petición atribuida a una persona — NUNCA orden del sistema), `ephemeral` (vale poco tiempo, con `expiresAt`; 48 h por defecto sin duración expresa) o `unclassified` (estado explícito para lo dudoso/heredado). Migración idempotente y reversible (`ALTER TABLE … ADD COLUMN IF NOT EXISTS assertion_type`); backfill conservador: `preference→opinion`, `system→fact`, resto→`unclassified`. Gobierna curación, ranking y retención.

## 2-3. Cierre del vector de inyección persistente (voz → memoria → prompt)

Defensa por capas (`sanitizer.ts`, `retrieval.ts`):

- **A. Detección** — clasificador determinista de metainstrucciones (`classifyCandidateSafety`): normaliza NFKC, minúsculas, homóglifos cirílicos/griegos, zero-width, y compara contra patrones anclados a verbo+objeto (ES/EN) + forma compacta contra fragmentación. Códigos: `META_IGNORE/REVEAL/ROLE/OVERRIDE/PRIVILEGE/MEMORY_AUTHORITY/SECRET`.
- **B. Almacenamiento** — un candidato marcado se RECHAZA en `createMemory` antes de persistir; se registra evento de seguridad agregado (códigos + hash corto del texto normalizado), nunca el texto íntegro.
- **C. Canonicalización** — solo entra `canonicalContent`; el texto bruto no se expone a las instrucciones.
- **D. Encapsulado** — `buildSecureMemoryContext` envuelve los recuerdos en un preámbulo que los declara DATOS no autoritativos + delimitador `<recuerdos>` con cada recuerdo serializado en JSON (no puede cerrar el delimitador ni inyectar líneas). Defensa en profundidad: `neutralizeStoredContent` sustituye por nota canónica cualquier metainstrucción almacenada y limpia tokens del delimitador.
- **E. Filtrado final** — excluye archivadas/pending/caducadas, aplica permisos server-side ANTES del ranking, limita cantidad/longitud, redacta secretos. `memory_recall` también se neutraliza.
- **F. Corpus adversarial** — `tests/injection.test.ts`: ES/EN, Unicode, homóglifos, zero-width, fragmentado; prueba el ciclo completo y la ausencia del ataque con autoridad en el prompt final.

## 4. Revisión de creencias (`relations.ts`)

`classifyRelation` distingue `duplicates/updates/contradicts/supports/supersedes` con umbrales calibrados por método: coseno (0,75–0,92) vs solapamiento de palabras (0,25–0,8, distinta escala). Una actualización crea relación auditable y reduce la confianza del previo (`decayedConfidenceOnSupersede`: mitad, con suelo 0,1); una contradicción conserva ambas.

## 5. Decaimiento y consolidación (`consolidation.ts`)

Fórmula: `step = DECAY_BASE(0.15) × factorEdad × factorTipo × (1−uso) × (1−importancia)`; ventana de gracia 14 días, suelo 0,1, seguridad/`system_self` intocables. La pasada expira efímeros, archiva episodios viejos irrelevantes, decae confianza, fusiona casi-duplicados, expira pendientes y archiva perfiles inactivos. Por lotes, `dry-run`, idempotente (ventana de 1 h). Cron `GET /api/memory/consolidate` protegido por `MEMORY_CONSOLIDATION_SECRET`/`CRON_SECRET` (Bearer; 404 a sondas) + `vercel.json`; `POST` manual solo owner confirmado.

## 6. Confirmación de contenido sensible (`pending.ts`)

Estado `pending` con `confirmationId` de un solo uso, ligado al propietario y a la sesión, caducidad 30 min. No entra en recuperación; solo el dueño correcto confirma/descarta; sin replay; barrido de caducadas. `memory_save` sensible → pendiente + `confirmationId`; herramienta realtime `memory_confirm` y `POST /api/memory/confirm` lo resuelven. El curador deja lo sensible pendiente en vez de descartarlo.

## 7. Identidad al regresar (`authz.ts`, session route)

Cuatro planos separados: acceso (passcode), sugerido (cookie sin confirmar), confirmado, privilegiado (owner con PIN/step-up). Una identidad SUGERIDA reconoce con duda ("¿Sigues siendo tú?") y NO abre memoria privada ni de proyecto hasta confirmar (`filterMemoriesForRetrieval`, `confirmed` en session/search). El cambio explícito de identidad sigue reiniciando el contexto privado.

## 8. Matriz de roles (`authz.ts`)

Fuente única `can(profile, status, capability)`. Roles: `owner, robot_creator, technician, team, investor, visitor`. El `technician` accede a estado técnico/salud/`system_self` pero NUNCA a memoria personal, herramientas de owner ni secretos. Tests parametrizados recorren la matriz completa.

## 9. Ciclo de vida de perfiles (`profileLifecycle.ts`)

`recordProfileUsage/listProfiles/setProfileStatus` en ambos stores. Registro de creación/último uso; archivo por inactividad (>30 días, salvo fijados/known) vía `POST /api/profiles` owner-only e integrado en la consolidación. Fusión: contrato documentado (no implementada por exigir transacción segura).

## 10. Panel de transparencia

`GET /api/memory/stats` (agregados sin texto: recuentos por tipo/afirmación/estado, pendientes, relaciones, rechazos por código, perfiles) gateado por `view_debug`/`view_tech_status`. El técnico ve métricas técnicas pero no metadatos de perfiles. Renderizado en `DiagnosticsPanel` con plano de identidad y capacidades activas.
