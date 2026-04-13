# VELA — Arena Logic

Arena es un simulador de conversación de ventas donde el usuario practica vendiendo (seller mode) o siendo vendido (client mode) contra una IA.

---

## Lifecycle de sesión

```
POST /api/arena/start
  └─ Crea ArenaSession en memoria del servidor
  └─ IA genera mensaje de apertura (gpt-4o-mini, max_tokens=150)
  └─ Devuelve { arenaSessionId, openingMessage }

Usuario escribe mensaje (o elige shortcutDirection) → POST /api/arena/turn  (se repite)
  └─ shortcutDirection? → genera mensaje del usuario con gpt-4o-mini (max_tokens=60)
  └─ Añade turno del usuario a session.turns
  └─ IA genera respuesta (gpt-4o, max_tokens=220-300, historial con windowing)
  └─ Detección de estado terminal (condicional, gpt-4o-mini, max_tokens=5) — solo seller
  └─ CoachLite + Journey en paralelo (gpt-4o-mini) — solo client mode
  └─ Devuelve { aiMessage, terminalSignal, coachLite?, generatedUserMessage? }

[Opcional] → POST /api/arena/note (añade instrucción, sin IA)
[Opcional] → POST /api/arena/repitch (genera reposicionamiento visual, NO a session.turns)

Sesión termina → POST /api/arena/finish
  └─ Genera debrief si role=seller y userTurns > 0 (gpt-4o-mini, max_tokens=300)
  └─ Llama closeSession() en ai-tracker (mantiene stats 10 min)
  └─ Devuelve { turns, summary }
  └─ Sesión en memoria eliminada tras 5 min timeout

[Opcional] → POST /api/arena/audit-report (gpt-4o-mini, análisis forense independiente)
```

---

## Roles

| Rol del usuario | IA juega de | Features activos |
|----------------|------------|-----------------|
| `seller` | Cliente/prospecto — con personalidad y dificultad | Terminal detection, debrief, sellerNotes en sistema |
| `client` | Vendedor/consultor — con personalidad de vendedor | CoachLite, Journey, sellerNotes como restricciones del vendedor |

---

## Sistema de presets

6 presets disponibles. Cada uno genera un contexto propio via `POST /api/arena/preset-context`.

| Clave | Escenario |
|-------|---------|
| `immvest` | Inversión inmobiliaria |
| `saas` | Software como servicio B2B |
| `b2b` | Venta B2B general |
| `high_ticket` | Producto / servicio premium |
| `coaching` | Coaching, formación, consultoría |
| `challenge` | Escenario desafiante / adversarial |

Los presets se definen en `PRESET_SYSTEM_DESC` en `lib/sales-brain/src/index.ts`. El backend inyecta la descripción del preset en el system prompt del turno si `randomPreset` está definido.

---

## Contexto estructurado (arenaStructuredContext)

Campos opcionales que refinan el escenario:

| Campo | Propósito |
|-------|---------|
| `meeting_goal` | Objetivo concreto de esta sesión |
| `main_blocker` | Bloqueo conocido de la sesión |
| `blocker_status` | `"open" \| "partial" \| "resolved"` |
| `what_not_to_do` | Errores a evitar |
| `valid_outcome_today` | Qué resultado cuenta como éxito |
| `known_context_notes` | Información extra de contexto |

**Importante:** `blocker_status` en Arena usa `"open" | "partial" | "resolved"` (NO `"partially_resolved"` — eso es del Copiloto structured_context).

---

## sellerNotes — instrucciones inyectadas

Un array de strings en `session.sellerNotes[]`. Nunca se almacena en `session.turns`.

- Se añaden via `POST /api/arena/note`. Sin llamada IA.
- Se inyectan en el system prompt de todos los turnos siguientes como bloque de restricciones duras:
  ```
  RESTRICCIONES DEL VENDEDOR (instrucciones adicionales):
  - ${note 1}
  - ${note 2}
  ```
- En `POST /api/arena/start`, si ya hay `sellerNotes`, se inyectan también en el prompt de apertura.
- En `buildOpeningPrompt()`, el parámetro `sellerNotes?` se usa para añadir restricciones desde el inicio.

---

## shortcutDirection

Si se pasa `shortcutDirection: "agree" | "object"` en `/api/arena/turn`:

1. La IA genera el mensaje del usuario (gpt-4o-mini, max_tokens=60, temperature=0.9) — acordando o objetando según la dirección.
2. El mensaje generado se usa como `userMessage` para el turno normal.
3. Se devuelve en `generatedUserMessage` en la response.

El turno se registra en `session.turns` como si el usuario lo hubiera enviado manualmente.

---

## Personalidades de cliente (`clientProfile`)

| Clave | Descripción |
|-------|-------------|
| `analytical` | Datos, precisión, proceso, evidencia antes de decidir. Rechaza vaguedades. |
| `emotional` | Confianza, conexión, sensación personal. Le influyen historias reales. |
| `skeptical` | Desconfía por defecto. Solo le convencen pruebas concretas y consistencia. |
| `cautious` | Teme equivocarse. Busca seguridad y validación externa. La presión le aleja. |
| `dominant` | Control, velocidad, autoridad. Castiga la debilidad. |
| `indecisive` | Le cuesta comprometerse. Necesita guía clara para decidir. |
| `negotiator` | Presiona en precio, pide concesiones, usa la negociación como palanca. |

**Aliases de compatibilidad (normalizados en `/api/arena/start`):**
- `insecure` → `cautious`
- `hard_negotiator` → `negotiator`
- `random` / `aleatorio` → `undefined` (se elige aleatoriamente del array de perfiles)

---

## Personalidades de vendedor (`sellerProfile`)

| Clave | Descripción |
|-------|-------------|
| `communicative` | Construye relación con anécdotas. A veces se extiende demasiado. |
| `authoritative` | Directo, asertivo, controla la conversación, rebate con firmeza. |
| `technical` | Características y datos con detalle. Preciso pero a veces poco emocional. |
| `passive` | Escucha mucho, no presiona, espera que el cliente llegue a conclusiones. |
| `aggressive` | Presiona para cerrar, crea urgencia, no acepta "no" fácilmente. |
| `consultive` | Hace preguntas, entiende necesidades primero y adapta su solución. |

---

## Niveles de dificultad (`difficulty`)

| Clave | Comportamiento |
|-------|---------------|
| `easy` | Pocas objeciones, abierto a escuchar. |
| `normal` | Algunas objeciones válidas, necesita buenos argumentos. |
| `hard` | Muchas objeciones, compara con competencia, difícil de convencer. |
| `brutal` | Escéptico, cuestiona todo, objeciones fuertes, solo cede ante argumentos muy sólidos. |

---

## History Windowing

Constante: `ARENA_HISTORY_WINDOW = 12`

Cuando `LEGACY_ARENA=false` (default):
- Solo los **últimos 12 turnos** se envían a la IA por cada respuesta de turno.
- El system prompt incluye nota explicando la longitud total para consistencia.
- El historial completo siempre se guarda en `session.turns` para transcripción final y debrief.
- `DEBRIEF_MAX_TURNS = 15` — debrief solo analiza últimos 15 turnos.
- `SUGGEST_MAX_TURNS = 10` — suggest usa últimos 10 turnos.
- `COACH_LITE_WINDOW = 12` — CoachLite usa misma ventana.

Cuando `LEGACY_ARENA=true`:
- Array `session.turns` completo enviado en cada petición. Sin windowing. Sin detección terminal condicional.

---

## Detección de estado terminal

Solo en **seller mode**. La detección es costosa — se omite si no se cumplen condiciones.

### Cuándo se ejecuta (`shouldCheckTerminal()`)

Un check se dispara si CUALQUIERA de:
1. `turns.length >= 4` Y keyword encontrada en el último mensaje de la IA
2. `turns.length >= 6` Y `turns.length % 3 === 0` (safety net cada 3 turnos)

### Keywords que disparan detección (Español)

```
trato hecho, cerramos, firmamos, me lo quedo, me apunto, lo compro,
cuándo firmo, cuándo firma, voy a pagar, pago con, con tarjeta, bizum,
mándame el contrato, mándame la propuesta, cuando quieras empezamos,
no me interesa en absoluto, definitivamente no, no voy a comprar,
no quiero saber más, hasta aquí, no seguimos, adiós, hasta luego
```

### Keywords que disparan detección (Inglés)

```
deal, let's close, i'll take it, i'll buy, send me the contract,
when do i sign, i'll pay with, by card, send the proposal,
not interested at all, definitely not, won't buy, stop here, goodbye, bye
```

### Prompt de detección

Envía los últimos 6 turnos, pide exactamente una palabra: `none | closed | next_step | lost | broken`.

**Outcomes (definiciones estrictas):**
- `none` — conversación abierta o ambigua (default ante la duda)
- `closed` — cliente se comprometió explícitamente a comprar
- `next_step` — cliente comprometió acción concreta: fecha de reunión, pedido de contrato/propuesta — "lo pensaré" NO cuenta
- `lost` — cliente rechazó definitivamente, sin vuelta atrás
- `broken` — ruptura total, cliente cortó la conversación

### Fallback

Si la llamada falla o devuelve valor inesperado → `"none"`.

---

## CoachLite (client mode)

Llamado en paralelo con el turno. Analiza la respuesta del vendedor IA y produce 7 campos de coaching para el usuario-cliente.

**Campos output:**
```json
{
  "signal": "string",
  "reading": "string",
  "mission": "string",
  "next_move": "string",
  "strategy": "string",
  "why_this_response": "string",
  "alternative": "string"
}
```

Si la respuesta de CoachLite contiene marcadores de FALLO GRAVE (regex: `/FALLO GRAVE/i`), el frontend registra el penalty en `gravePenalties[]`. El debrief recibe `GRAVE_PENALTY_COUNT` como contexto.

---

## Journey (client mode)

Llamado en paralelo con CoachLite. Indica la etapa actual de la conversación en 6 etapas.

**Etapas:** `context` → `problem` → `blocker` → `fit` → `advance` → `close`

Cada etapa es `"done" | "current" | "upcoming"`.

Campos adicionales: `now_help` (qué hacer ahora), `next_help` (hacia dónde mover), `premature_close_risk` (`"low" | "medium" | "high"`).

---

## Debrief

Generado al final de sesión para sesiones de seller con `userTurns > 0`.

### Rúbrica de puntuación

1. **Peso doble**: outcome Y calidad de ejecución se pesan por igual.
2. **Techo duro**: score ≤ 7 si el comprador repite demanda central dos o más veces sin resolución.
3. **Penalizaciones** (−1 a −2 c/u):
   - Vendedor propone reunión/llamada/cierre antes de resolver la objeción principal.
   - Siguiente paso queda ambiguo sin acción/fecha concreta.
   - Vendedor repite la misma estructura de respuesta sin adaptarse.
4. **Techo de FALLO GRAVE**: Si `GRAVE_PENALTY_COUNT ≥ 1`, score máximo = 5.
5. **Sensibilidad al perfil**: el prompt incluye criterio específico del `clientProfile`.

### Referencias de score

| Situación | Score |
|-----------|-------|
| Closed vs cliente difícil | mín 8 |
| Next_step + buena ejecución | hasta 8 |
| Next_step + ejecución débil | 5–6 |
| Lost / broken | máx 5 |
| Comprador repite demanda central sin resolver | máx 7 (techo duro) |
| FALLO GRAVE detectado por CoachLite | máx 5 |

---

## Limpieza de sesión

| Evento | Qué pasa |
|--------|---------|
| `POST /api/arena/finish` llamado | `closeSession()` llamado en ai-tracker |
| 5 minutos tras finish | Entrada en Map de sesiones Arena eliminada |
| 10 minutos tras `closeSession()` | Resumen de sesión en ai-tracker eliminado |
| Restart del servidor | Todas las sesiones perdidas (solo en memoria) |
