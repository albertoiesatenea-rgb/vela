# VELA — Audit Log System

`artifacts/silent-closer/src/lib/audit-log.ts`

El sistema de audit log produce archivos Markdown forenses y auditables tanto para sesiones de Copiloto como de Arena. Los logs se construyen completamente en cliente a partir del estado de sesión y no requieren una llamada API adicional.

---

## Pipeline

```
Sesión termina
     │
     ▼
buildCopilotAuditLog(data: CopilotSessionData)
  O
buildArenaAuditLog(data: ArenaSessionData)
     │
     ▼
AuditLog (objeto tipado)
     │
     ▼
renderAuditLogMarkdown(log: AuditLog)
     │
     ▼
Archivo .md descargado en el navegador
```

**Gap conocido:** `buildCopilotAuditLog()` hardcodea `model: "gpt-4o-mini"` en `meta.model`. El modelo real del analyze es ahora `gpt-4o`. El audit log muestra modelo incorrecto hasta que se corrija.

---

## Schema de AuditLog

```typescript
interface AuditLog {
  meta:                SessionMeta
  context:             SessionContext
  config:              SessionConfig
  turns:               AuditTurn[]
  readable_transcript: string[]
  summary:             SessionSummary
  audit_hints:         AuditHints
}
```

### `SessionMeta`

Metadatos a nivel de sesión.

| Campo | Descripción |
|-------|-------------|
| `app_mode` | `"copilot"` o `"arena"` |
| `session_id` | UUID o null |
| `exported_at` | Timestamp ISO 8601 de exportación |
| `app_version` | `"1.0.0"` |
| `model` | **Actualmente hardcodeado `"gpt-4o-mini"` (gap — el modelo real del analyze es gpt-4o)** |
| `lang` | `"es"` o `"en"` |
| `ui_mode` | `"copilot"` o `"arena"` |
| `source_mode` | `"listen"`, `"simulate"`, `"mixed"`, o `"chat"` (arena) |
| `speaker_mode_default` | `"auto"`, `"client"`, o `"me"` (solo copiloto) |
| `role_in_arena` | `"seller"` o `"client"` (solo arena) |
| `context_label` | Label corto para el contexto de la sesión |
| `session_status` | Outcome declarado o `"ended_without_declared_outcome"` |

### `SessionContext`

```typescript
{
  raw_context: string       // Texto de contexto completo escrito por el usuario
  objective: null           // Reservado (no extraído aún)
  known_objections: null    // Reservado
  relevant_data: null       // Reservado
}
```

### `SessionConfig`

```typescript
{
  input_mode: string | null
  speaker_mode_default: string | null
  arena_role: string | null
  arena_variant: null              // Reservado
  arena_state_model: string | null // e.g. "keyword_heuristic + gpt-4o-mini"
}
```

### `AuditTurn`

Una entrada por turno de conversación.

| Campo | Descripción |
|-------|-------------|
| `turn_index` | Base cero |
| `timestamp` | ISO 8601 |
| `mode` | `"copilot"` o `"arena"` |
| `source_mode` | `"listen"`, `"simulate"`, `"chat"` |
| `speaker_mode` | Modo de speaker activo en este turno |
| `raw_input` | Texto original sin procesar |
| `normalized_input` | Texto limpio enviado al modelo |
| `inferred_speaker` | `"CLIENTE"`, `"YO"`, `"AI_SELLER"`, `"AI_BUYER"`, `"UNKNOWN"` |
| `memory_before` | Estado de call memory antes de este turno |
| `model_request_summary` | Descripción legible de la llamada API realizada |
| `model_output_raw` | String JSON crudo del modelo (copiloto) o mensaje IA (arena) |
| `response_status` | `"ok"`, `"error"`, o `"partial"` |
| `parse_error` | Mensaje de error de parse JSON si aplica |
| `notes` | Notas en texto libre |
| `copilot?` | `CopilotTurnData` (solo modo copiloto) |
| `arena?` | `ArenaTurnData` (solo modo arena) |

**Nota sobre speaker Arena:** `TurnLogEntry.inferred_speaker` usa MAYÚSCULAS (`"CLIENTE"`, `"YO"`, `"UNKNOWN"`); `SpeakerResult.speaker` del speaker-session es lowercase (`"client"`, `"me"`, `"unknown"`) — se mapea antes de almacenar.

### `CopilotTurnData`

```typescript
{
  signal: string | null,
  say_now: string | null,
  avoid: string | null,
  reading: string | null,
  mission: string | null,
  next_move: string | null,
  support: string | null,
  journey_past: string | null,
  journey_now: string | null,
  journey_next: string | null,
  momentum: "green" | "amber" | "red" | null,
  memory_after: string[],
  why_this_turn_exists: "auto_listen_batch" | "manual_submit"
}
```

### `ArenaTurnData`

```typescript
{
  arena_role_of_user: string           // "seller" | "client"
  ai_role_this_turn: string            // "client" | "seller"
  user_message: string | null
  ai_message: string | null
  conversation_state_before: "favorable" | "tense" | "critical"
  conversation_state_after:  "favorable" | "tense" | "critical"
  terminal_state_detected: "yes" | "no"
  terminal_state_type: string | null
  terminal_state_source: string | null
  tension_or_momentum: string
  hidden_reasoning_summary: string | null   // heurístico keyword-based
  coach_lite?: CoachLiteFields             // solo client mode
  journey?: JourneyFields                  // solo client mode
}
```

**Importante:** `hidden_reasoning_summary` es una estimación heurística basada en keywords. NO es el razonamiento interno real del modelo.

### `CoachLiteFields` (arena, client mode)

```typescript
{
  signal: string
  reading: string
  mission: string
  next_move: string
  strategy: string
  why_this_response: string
  alternative: string
}
```

### `JourneyFields` (arena, client mode)

```typescript
{
  stages: {
    context: "done" | "current" | "upcoming"
    problem: "done" | "current" | "upcoming"
    blocker: "done" | "current" | "upcoming"
    fit: "done" | "current" | "upcoming"
    advance: "done" | "current" | "upcoming"
    close: "done" | "current" | "upcoming"
  }
  now_help: string
  next_help: string
  premature_close_risk: "low" | "medium" | "high"
}
```

### `SessionSummary`

| Campo | Descripción |
|-------|-------------|
| `final_outcome` | String de outcome declarado |
| `final_outcome_source` | `"user"`, `"ai"`, `"system"`, o `"mixed"` |
| `final_score` | Score numérico (0–10) del debrief/resumen |
| `final_global_state` | Label breve de estado |
| `final_result_label` | Descriptor corto del resultado |
| `final_momentum_or_state` | Tendencia de momentum o estado final |
| `total_turns` | Conteo total de turnos |
| `total_user_turns` | Turnos hablados por el usuario |
| `total_ai_turns` | Turnos hablados por la IA (solo arena) |
| `session_end_reason` | Por qué terminó la sesión |
| `strongest_moment` | null (reservado) |
| `weakest_moment` | null (reservado) |
| `unresolved_objections` | null (reservado) |
| `missed_closing_window` | null (reservado) |
| `final_call_memory` | Ítems de memoria al final de sesión (copiloto) |
| `strengths` | Fortalezas identificadas por IA |
| `improvements` | Mejoras identificadas / critique del debrief |
| `full_report` | Informe narrativo completo (copiloto, si se solicitó) |
| `seller_notes` | Lista de notas inyectadas (arena) |

### `AuditHints`

9 flags de diagnóstico para el VELA Auditor GPT.

```typescript
{
  likely_primary_failure: "seller" | "technical" | "system" | "none"
  suspected_prompt_issue: "yes" | "no"
  suspected_ui_issue: "yes" | "no"
  suspected_support_gap: "yes" | "no"
  suspected_close_timing_issue: "yes" | "no"
  suspected_repetition_issue: "yes" | "no"
  suspected_claim_risk: "yes" | "no"             // nuevo
  suspected_false_confidence: "yes" | "no"        // nuevo
  suspected_soft_next_step: "yes" | "no"          // nuevo
  next_step_quality: "strong" | "useful" | "weak" | "none"  // nuevo
  audit_notes: string[]
}
```

Reglas de detección automática:

| Hint | Se activa cuando |
|------|-----------------|
| `suspected_prompt_issue` | `>1` error de parse O `>2` `say_now` idénticos consecutivos |
| `suspected_support_gap` | Outcome es `lost` |
| `suspected_close_timing_issue` | Outcome es `lost` O momentum final es `amber` |
| `suspected_repetition_issue` | `>1` turno consecutivo con mismo `say_now` |
| `suspected_claim_risk` | Detectado por heurística de momentum (>2 rojos consecutivos) |
| `suspected_false_confidence` | Score > 7 pero outcome es `lost` o `unclear` |
| `suspected_soft_next_step` | Next_step con score < 6 |
| `next_step_quality` | Calculado según score: `"strong"` ≥8, `"useful"` 6-7, `"weak"` 4-5, `"none"` <4 |

---

## Notas Arena en readable_transcript

Las entradas de `sellerNotes[]` aparecen en el readable_transcript intercaladas como:

```
[→ INSTRUCCIÓN AL VENDEDOR]: ${nota}
```

Esto permite que el audit log documente las restricciones inyectadas en el momento en que ocurrieron.

---

## Tendencia de momentum (Copiloto)

`detectMomentumTrend()` clasifica: `green=2`, `amber=1`, `red=0`. Compara primera y última lectura:

- Mejorando: primera < última (`"improving (red → green)"`)
- Declinando: primera > última
- Estable: iguales (`"stable (amber)"`)

---

## Heurística de estado Arena

`deriveArenaState()` clasifica un mensaje como `"favorable"`, `"tense"`, o `"critical"` usando keywords:

**Keywords críticas (es):** `no me interesa`, `imposible`, `demasiado caro`, `no voy a`, `no lo necesito`…  
**Keywords favorables (es):** `interesante`, `me gusta`, `cuéntame más`, `de acuerdo`, `suena bien`…  
**Default:** `"tense"`

---

## Estructura del Markdown generado

```markdown
# VELA AUDIT LOG

## SESSION_META
## SESSION_CONTEXT
## SESSION_CONFIG
## READABLE_TRANSCRIPT
## TURNS
  ### TURN_0
  ### TURN_1
  ...
## SUMMARY
## AUDIT_HINTS
```

El archivo está diseñado para ser legible por el VELA Auditor GPT sin explicación adicional.
