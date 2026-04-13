# VELA — API Routes

Todas las rutas se sirven desde el API server en el puerto `8080` con prefijo `/api/`.

Fuente de verdad de schemas: `lib/api-zod/src/generated/api.ts` (mantenido manualmente).

---

## Rutas de Copiloto

### `POST /api/copilot/analyze`

Analiza un fragmento de conversación y devuelve coaching táctico en tiempo real.

**Request body** (validado por `AnalyzeConversationBody`):
```json
{
  "text": "string (requerido, min 1 char)",
  "context": "string (opcional)",
  "call_memory": "string (opcional — call_memory como string serializado para compatibilidad, separado por newlines)",
  "conversation_history": ["string"] ,
  "lang": "es | en (opcional, default es)",
  "structured_context": {
    "meeting_goal": "string (opcional)",
    "previous_blocker": "string (opcional)",
    "blocker_status": "open | resolved | partially_resolved (opcional)",
    "what_not_to_do_today": "string (opcional)",
    "desired_deliverable_today": "string (opcional)"
  },
  "speaker_confidence": "number 0-1 (opcional, solo modo auto)"
}
```

**Nota sobre `conversation_history`:** Si está presente, el backend construye el user message como `HISTORIAL DE CONVERSACIÓN:\n${lines.join("\n")}` y lo usa como contexto principal. `call_memory` se incluye también pero como campo secundario. Si `conversation_history` no está presente, fallback a `MEMORIA ACUMULADA:\n${call_memory}\n\nFRAGMENTO:\n${text}`.

**Nota sobre `text` con speaker:** El frontend envía `fullText = speakerPrefix + text` (e.g. `[Cliente]: texto`). El historial incluye el fragmento actual como última entrada.

**Response** (validado por `AnalyzeConversationResponse`):
```json
{
  "signal": "string | undefined (2-5 palabras)",
  "say_now": "string (4-12 palabras, requerido)",
  "avoid": "string | undefined",
  "detail": {
    "reading": "string | undefined",
    "mission": "string | undefined",
    "next_move": "string | undefined",
    "support": "string | undefined"
  },
  "journey": {
    "past": "string",
    "now": "string",
    "next": "string"
  },
  "call_memory": {
    "summary_lines": ["string (4-6 líneas)"]
  },
  "momentum": "red | amber | green | undefined"
}
```

**Llamada IA:** `gpt-4o`, `max_tokens=900`  
**Constante en código:** `ANALYZE_MODEL = "gpt-4o"` (copilot.ts)  
**Route tag:** `copilot/analyze` / endpoint `analyze`  
**Session ID:** Leído de header `x-session-id` (opcional)

---

### `POST /api/copilot/summarize`

Genera el resumen de fin de llamada. Se llama al declarar el outcome.

**Request body** (validado por `CallSummarizeBody`):
```json
{
  "call_memory": ["string"] ,
  "outcome": "string (opcional)",
  "lang": "es | en (opcional)",
  "full_report": "boolean (opcional)",
  "speaker_uncertainty": {
    "high": "boolean",
    "rate": "number (opcional)",
    "unknown_turns": "number (opcional)",
    "total_turns": "number (opcional)"
  }
}
```

**Response** (validado por `CallSummarizeResponse`):
```json
{
  "score": "number (0-10)",
  "global_state": "string",
  "result_label": "string",
  "strengths": ["string"],
  "improvements": ["string"],
  "full_report": "string | undefined"
}
```

**Llamada IA:** `gpt-4o-mini`, `max_tokens=400` (resumen) o `max_tokens=1600` (full report)  
**Route tag:** `copilot/summarize` / endpoint `summarize` o `summarize-full`

---

### `POST /api/copilot/audit-report`

Auditoría brutal post-sesión. Independiente de summarize. Recibe datos enriquecidos del cliente.

**Request body** (sin validación Zod — tipado manual):
```json
{
  "call_memory": ["string"],
  "outcome": "string",
  "context": "string",
  "lang": "es | en",
  "speaker_uncertainty": { "high": true, "rate": 0.4, "unknown_turns": 5, "total_turns": 12 },
  "closing_excerpt": [{ "turn": 8, "speaker": "YO", "text": "..." }],
  "session_summary": { "score": 7, "global_state": "...", "result_label": "...", "strengths": [], "improvements": [] },
  "audit_hints_pack": { "likely_primary_failure": "none", "suspected_soft_next_step": "no", "next_step_quality": "useful", "audit_notes": [] },
  "human_notes": "string"
}
```

**Response:** JSON de auditoría forense (estructura BrutalAudit — ver implementación en copilot.ts)

**Llamada IA:** `gpt-4o-mini`, `max_tokens` variable  
**Route tag:** no registrado explícitamente en logAICall (pendiente de confirmar)

---

### `POST /api/copilot/context-label`

Auto-genera un título de escena de 4-6 palabras a partir del contexto.

**Request body:**
```json
{
  "context": "string",
  "lang": "string"
}
```

**Response:**
```json
{ "label": "string" }
```

**Llamada IA:** `gpt-4o-mini`, `max_tokens=25`  
**Route tag:** `copilot/context-label` / endpoint `context-label`  
**Nota:** No envía `sessionId` (generado antes de iniciar sesión).

---

## Rutas de Arena

### `POST /api/arena/preset-context`

Genera un texto de escenario corto a partir de un preset y rol.

**Request body:**
```json
{
  "preset": "immvest | saas | b2b | high_ticket | coaching | challenge",
  "role": "seller | client",
  "lang": "es | en"
}
```

**Response:**
```json
{ "context": "string" }
```

**Llamada IA:** `gpt-4o-mini`, `max_tokens=65` (o 120 para immvest), `temperature=0.95`

---

### `POST /api/arena/adapt-context`

Reescribe un texto de contexto para la perspectiva del rol opuesto.

**Request body:**
```json
{
  "text": "string",
  "fromRole": "seller | client",
  "toRole": "seller | client",
  "lang": "es | en"
}
```

**Response:**
```json
{ "context": "string" }
```

**Llamada IA:** `gpt-4o-mini`, `max_tokens=150`, `temperature=0.2`

---

### `POST /api/arena/start`

Crea una sesión de Arena nueva y devuelve el mensaje de apertura de la IA.

**Request body:**
```json
{
  "role": "seller | client",
  "lang": "es | en",
  "context": "string",
  "clientProfile": "analytical | emotional | skeptical | cautious | dominant | indecisive | negotiator",
  "sellerProfile": "communicative | authoritative | technical | passive | aggressive | consultive",
  "difficulty": "easy | normal | hard | brutal",
  "forceTerminal": "boolean",
  "randomPreset": "string (clave de PRESET_SYSTEM_DESC)",
  "arenaStructuredContext": {
    "meeting_goal": "string",
    "main_blocker": "string",
    "blocker_status": "open | partial | resolved",
    "what_not_to_do": "string",
    "valid_outcome_today": "string",
    "known_context_notes": "string"
  }
}
```

**Response:**
```json
{
  "arenaSessionId": "uuid",
  "openingMessage": "string"
}
```

**Llamada IA:** `gpt-4o-mini`, `max_tokens=150`  
**Route tag:** `arena/start` / endpoint `opening`  
**Alias de profiles:** `insecure` → `cautious`, `hard_negotiator` → `negotiator`, `random`/`aleatorio` → undefined

---

### `POST /api/arena/turn`

Envía un mensaje del usuario y recibe la respuesta de la IA + análisis paralelo.

**Request body:**
```json
{
  "arenaSessionId": "uuid",
  "userMessage": "string",
  "shortcutDirection": "agree | object (opcional)"
}
```

**Response:**
```json
{
  "aiMessage": "string",
  "terminalSignal": "none | closed | next_step | lost | broken",
  "generatedUserMessage": "string (solo si shortcutDirection fue usado)",
  "coachLite": {
    "explanation": "string",
    "journey": {
      "stages": { "context": "done|current|upcoming", "problem": "...", "blocker": "...", "fit": "...", "advance": "...", "close": "..." },
      "now_help": "string",
      "next_help": "string",
      "premature_close_risk": "low | medium | high"
    },
    "fields": {
      "signal": "string",
      "reading": "string",
      "mission": "string",
      "next_move": "string",
      "strategy": "string",
      "why_this_response": "string",
      "alternative": "string"
    }
  },
  "outcome": "closed | next_step | lost | broken | none"
}
```

**Llamadas IA (paralelas):**
1. Respuesta del turno — `gpt-4o`, `max_tokens=220` (client mode) o `max_tokens=300` (seller mode) — `TURN_MODEL`
2. Terminal detection — `gpt-4o-mini`, `max_tokens=5`, `temperature=0` — condicional, solo seller mode
3. CoachLite — `gpt-4o-mini`, `max_tokens=500`, `temperature=0` — solo client mode
4. Journey — `gpt-4o-mini`, `max_tokens=400` — solo client mode

**Route tag:** `arena/turn` / endpoints `turn`, `terminal-state`, `coach-lite`, `journey`

---

### `POST /api/arena/finish`

Termina la sesión de Arena, genera el debrief (solo seller mode) y limpia recursos.

**Request body:**
```json
{
  "arenaSessionId": "uuid",
  "outcome": "closed | next_step | lost | broken | manual_stop"
}
```

**Response:**
```json
{
  "turns": [{ "index": 0, "timestamp": "ISO8601", "speaker": "user | ai", "message": "string" }],
  "summary": {
    "role": "seller | client",
    "context": "string",
    "lang": "es | en",
    "totalTurns": 10,
    "userTurns": 5,
    "createdAt": "ISO8601",
    "closedAt": "ISO8601",
    "outcome": "string",
    "debrief": { "score": 7, "critique": ["frase 1", "frase 2", "frase 3"] }
  }
}
```

**Llamada IA (opcional):** `gpt-4o-mini`, `max_tokens=300` — solo cuando `role=seller` y `userTurns > 0`  
**Route tag:** `arena/finish` / endpoint `debrief`  
**Limpieza:** Sesión eliminada 5 min después. `closeSession()` llamado (mantiene stats 10 min).

---

### `POST /api/arena/note`

Añade una instrucción (sellerNote) a la sesión activa. Sin llamada IA. La nota se inyecta en el system prompt de todos los turnos siguientes como restricción dura.

**Request body:**
```json
{ "arenaSessionId": "uuid", "note": "string" }
```

**Response:**
```json
{ "ok": true, "noteCount": 3 }
```

---

### `POST /api/arena/repitch`

Genera un reposicionamiento del vendedor IA después de una nota inyectada. **NO añade el mensaje a `session.turns`** — es visual only.

**Request body:**
```json
{ "arenaSessionId": "uuid" }
```

**Response:**
```json
{ "message": "string" }
```

**Llamada IA:** `gpt-4o-mini`, `max_tokens=300`, `temperature=0.7`  
**Route tag:** `arena/repitch` / endpoint `turn`

---

### `POST /api/arena/suggest`

Genera la respuesta ideal para que el usuario envíe.

**Request body:**
```json
{ "arenaSessionId": "uuid", "lang": "es | en" }
```

**Response:**
```json
{ "suggestion": "string" }
```

**Llamada IA:** `gpt-4o-mini`, `max_tokens=300`, `temperature=0.3`  
**Route tag:** `arena/suggest` / endpoint `suggest`  
**Nota:** El frontend NO auto-envía la sugerencia como turno — es solo sugerencia visual.

---

### `POST /api/arena/audit-report`

Auditoría brutal post-sesión Arena. Independiente del debrief.

**Request body:**
```json
{
  "transcript": [{ "speaker": "user | ai", "message": "string" }],
  "context": "string",
  "outcome": "string",
  "role": "seller | client",
  "clientProfile": "string",
  "sellerProfile": "string",
  "difficulty": "string",
  "lang": "es | en",
  "arenaStructuredContext": { }
}
```

**Llamada IA:** `gpt-4o-mini`  
**Route tag:** no registrado en logAICall (pendiente de confirmar)

---

## Rutas de Debug

### `GET /api/debug/usage`

Devuelve el snapshot completo de uso de IA para el debug panel. Sin autenticación.

**Response:**
```json
{
  "serverStartedAt": "ISO8601",
  "global": { "calls": 42, "totalTokens": 85000, "totalCostUsd": 0.024 },
  "routes": [
    {
      "route": "copilot/analyze",
      "calls": 20,
      "totalTokens": 50000,
      "totalCostUsd": 0.015,
      "avgLatencyMs": 820,
      "avgPromptTokens": 700,
      "avgCompletionTokens": 800
    }
  ],
  "sessions": [
    {
      "sessionId": "uuid",
      "mode": "copilot | arena",
      "calls": 5,
      "totalPromptTokens": 8000,
      "totalCompletionTokens": 4000,
      "totalTokens": 12000,
      "totalCostUsd": 0.003,
      "avgLatencyMs": 750,
      "createdAt": "ISO8601",
      "lastCallAt": "ISO8601"
    }
  ],
  "recentCalls": [
    {
      "callId": "uuid",
      "timestamp": "ISO8601",
      "route": "copilot/analyze",
      "endpoint": "analyze",
      "mode": "copilot",
      "model": "gpt-4o",
      "promptTokens": 700,
      "completionTokens": 450,
      "totalTokens": 1150,
      "estimatedCostUsd": 0.006250,
      "latencyMs": 820,
      "status": "ok | error | partial"
    }
  ]
}
```

**routes:** Todas las rutas, ordenadas por coste descendente.  
**sessions:** Top 20 por coste.  
**recentCalls:** Últimas 50 del ring buffer de 200, más reciente primero.

---

## Ruta de Health

### `GET /api/health`

**Response:**
```json
{ "status": "ok" }
```
