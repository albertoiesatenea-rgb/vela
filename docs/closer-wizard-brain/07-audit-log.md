# Closer Wizard — Audit Log System

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
| `model` | `"gpt-4o-mini"` |
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
| `inferred_speaker` | E.g. `"CLIENTE"`, `"YO"`, `"AI_SELLER"` |
| `memory_before` | Estado de call memory antes de este turno |
| `model_request_summary` | Descripción legible de la llamada API realizada |
| `model_output_raw` | String JSON crudo del modelo (copiloto) o mensaje IA (arena) |
| `response_status` | `"ok"`, `"error"`, o `"partial"` |
| `parse_error` | Mensaje de error de parse JSON si aplica |
| `notes` | Notas en texto libre |
| `copilot?` | `CopilotTurnData` (solo modo copiloto) |
| `arena?` | `ArenaTurnData` (solo modo arena) |

### `CopilotTurnData`

```typescript
{
  signal, say_now, avoid, reading, mission, next_move, support,
  journey_past, journey_now, journey_next,
  momentum: "green" | "amber" | "red" | null,
  memory_after: string[],
  why_this_turn_exists: "auto_listen_batch" | "manual_submit"
}
```

### `ArenaTurnData`

```typescript
{
  arena_role_of_user: string
  ai_role_this_turn: string
  user_message: string | null
  ai_message: string | null
  conversation_state_before: "favorable" | "tense" | "critical"
  conversation_state_after:  "favorable" | "tense" | "critical"
  terminal_state_detected: "yes" | "no"
  terminal_state_type: string | null        // tipo de outcome si es terminal
  terminal_state_source: string | null
  tension_or_momentum: string
  hidden_reasoning_summary: string | null   // heurístico, NO razonamiento real del modelo
}
```

**Importante:** `hidden_reasoning_summary` en Arena es una estimación heurística basada en análisis de keywords del texto del mensaje. NO es el razonamiento interno real del modelo.

### `SessionSummary`

| Campo | Descripción |
|-------|-------------|
| `final_outcome` | String de outcome declarado |
| `final_outcome_source` | `"user"`, `"ai"`, `"system"`, o `"mixed"` |
| `final_score` | Score numérico (1–10) del debrief/resumen |
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

### `AuditHints`

Flags de diagnóstico para el Closer Wizard Auditor GPT.

```typescript
{
  likely_primary_failure: "seller" | "technical" | "system" | "none"
  suspected_prompt_issue: "yes" | "no"
  suspected_ui_issue: "yes" | "no"
  suspected_support_gap: "yes" | "no"
  suspected_close_timing_issue: "yes" | "no"
  suspected_repetition_issue: "yes" | "no"
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

---

## Tendencia de momentum (Copiloto)

`detectMomentumTrend()` clasifica los valores de momentum: `green=2`, `amber=1`, `red=0`. Compara las primeras y últimas lecturas de momentum:

- Mejorando: primera < última (e.g. `"improving (red → green)"`)
- Declinando: primera > última
- Estable: iguales (e.g. `"stable (amber)"`)

---

## Heurística de estado Arena

`deriveArenaState()` clasifica un mensaje como `"favorable"`, `"tense"`, o `"critical"` usando keywords:

**Keywords críticas (es):** `no me interesa`, `imposible`, `demasiado caro`, `no voy a`, `no lo necesito`, etc.  
**Keywords favorables (es):** `interesante`, `me gusta`, `cuéntame más`, `de acuerdo`, `suena bien`, etc.  
**Default:** `"tense"`

---

## Estructura del Markdown generado

El archivo `.md` generado contiene estas secciones:

```markdown
# CLOSER WIZARD AUDIT LOG

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

El archivo está diseñado para ser legible por el Closer Wizard Auditor GPT sin explicación adicional.
