# Closer Wizard — Audit Log System

`artifacts/silent-closer/src/lib/audit-log.ts`

The audit log system produces forensic, audit-ready Markdown files for both Copiloto and Arena sessions. Logs are built entirely client-side from session state and do not require an additional API call.

---

## Pipeline

```
Session ends
     │
     ▼
buildCopilotAuditLog(data: CopilotSessionData)
  OR
buildArenaAuditLog(data: ArenaSessionData)
     │
     ▼
AuditLog (typed object)
     │
     ▼
renderAuditLogMarkdown(log: AuditLog)
     │
     ▼
.md file downloaded in browser
```

---

## AuditLog Schema

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

Session-level metadata.

| Field | Description |
|-------|-------------|
| `app_mode` | `"copilot"` or `"arena"` |
| `session_id` | UUID or null |
| `exported_at` | ISO 8601 timestamp of export |
| `app_version` | `"1.0.0"` |
| `model` | `"gpt-4o-mini"` |
| `lang` | `"es"` or `"en"` |
| `ui_mode` | `"copilot"` or `"arena"` |
| `source_mode` | `"listen"`, `"simulate"`, `"mixed"`, or `"chat"` (arena) |
| `speaker_mode_default` | `"auto"`, `"client"`, or `"me"` (copilot only) |
| `role_in_arena` | `"seller"` or `"client"` (arena only) |
| `context_label` | Short label for the session context |
| `session_status` | Declared outcome or `"ended_without_declared_outcome"` |

### `SessionContext`

```typescript
{
  raw_context: string       // Full context text typed by user
  objective: null           // Reserved (not yet extracted)
  known_objections: null    // Reserved
  relevant_data: null       // Reserved
}
```

### `SessionConfig`

```typescript
{
  input_mode: string | null
  speaker_mode_default: string | null
  arena_role: string | null
  arena_variant: null              // Reserved
  arena_state_model: string | null // e.g. "keyword_heuristic + gpt-4o-mini"
}
```

### `AuditTurn`

One entry per conversation turn.

| Field | Description |
|-------|-------------|
| `turn_index` | Zero-based |
| `timestamp` | ISO 8601 |
| `mode` | `"copilot"` or `"arena"` |
| `source_mode` | `"listen"`, `"simulate"`, `"chat"` |
| `speaker_mode` | Active speaker mode for this turn |
| `raw_input` | Original unprocessed text |
| `normalized_input` | Cleaned text sent to model |
| `inferred_speaker` | E.g. `"CLIENTE"`, `"YO"`, `"AI_SELLER"` |
| `memory_before` | Call memory state before this turn |
| `model_request_summary` | Human-readable description of the API call made |
| `model_output_raw` | Raw JSON string from model (copilot) or AI message (arena) |
| `response_status` | `"ok"`, `"error"`, or `"partial"` |
| `parse_error` | JSON parse error message if applicable |
| `notes` | Free-form notes |
| `copilot?` | `CopilotTurnData` (copilot mode only) |
| `arena?` | `ArenaTurnData` (arena mode only) |

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
  terminal_state_type: string | null        // outcome type if terminal
  terminal_state_source: string | null
  tension_or_momentum: string
  hidden_reasoning_summary: string | null   // heuristic-derived, not actual model reasoning
}
```

**Important:** `hidden_reasoning_summary` in Arena is a heuristic estimate based on keyword analysis of the message text. It is NOT the model's actual internal reasoning.

### `SessionSummary`

| Field | Description |
|-------|-------------|
| `final_outcome` | Declared outcome string |
| `final_outcome_source` | `"user"`, `"ai"`, `"system"`, or `"mixed"` |
| `final_score` | Numeric score (1–10) from debrief/summary |
| `final_global_state` | Brief state label |
| `final_result_label` | Short result descriptor |
| `final_momentum_or_state` | Momentum trend or final state |
| `total_turns` | Total turn count |
| `total_user_turns` | User-spoken turns |
| `total_ai_turns` | AI-spoken turns (arena only) |
| `session_end_reason` | Why the session ended |
| `strongest_moment` | null (reserved) |
| `weakest_moment` | null (reserved) |
| `unresolved_objections` | null (reserved) |
| `missed_closing_window` | null (reserved) |
| `final_call_memory` | Memory items at session end (copilot) |
| `strengths` | AI-identified strengths |
| `improvements` | AI-identified improvements / debrief critique |
| `full_report` | Full narrative report (copilot, if requested) |

### `AuditHints`

Diagnostic flags for the Closer Wizard Auditor GPT.

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

Automatic detection rules:

| Hint | Triggered when |
|------|---------------|
| `suspected_prompt_issue` | `>1` parse error OR `>2` consecutive identical `say_now` |
| `suspected_support_gap` | outcome is `lost` |
| `suspected_close_timing_issue` | outcome is `lost` OR final momentum is `amber` |
| `suspected_repetition_issue` | `>1` consecutive turn with same `say_now` |

---

## Momentum Trend (Copilot)

`detectMomentumTrend()` ranks momentum values: `green=2`, `amber=1`, `red=0`. It compares first and last momentum readings:

- Improving: first < last (e.g. `"improving (red → green)"`)
- Declining: first > last
- Stable: equal (e.g. `"stable (amber)"`)

---

## Arena State Heuristic

`deriveArenaState()` classifies a message as `"favorable"`, `"tense"`, or `"critical"` using keyword matching:

**Critical keywords (es):** `no me interesa`, `imposible`, `demasiado caro`, `no voy a`, `no lo necesito`, etc.  
**Favorable keywords (es):** `interesante`, `me gusta`, `cuéntame más`, `de acuerdo`, `suena bien`, etc.  
**Default:** `"tense"`

---

## Markdown Output Structure

The rendered `.md` file contains these sections:

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

The file is designed to be machine-readable by the Closer Wizard Auditor GPT without additional explanation.
