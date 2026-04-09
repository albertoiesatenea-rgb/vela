# 07 — AUDIT LOG SYSTEM
_Generated: 2026-04-09_

## File location

`artifacts/silent-closer/src/lib/audit-log.ts`

Client-side only. Runs in the browser. No server involvement.

## Purpose

Produces forensic, audit-ready `.md` files from a completed session. Compatible with the Closer Wizard Auditor GPT.

## Pipeline

```
Raw session data
  ↓
buildCopilotAuditLog(CopilotSessionData)   OR   buildArenaAuditLog(ArenaSessionData)
  ↓
AuditLog (typed object)
  ↓
renderAuditLogMarkdown(AuditLog) → string
  ↓
triggerAuditLogDownload(log, sessionId) → browser Blob download
```

---

## AuditLog structure

```ts
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

### SessionMeta
```ts
{
  app_mode:            "copilot" | "arena"
  session_id:          string | null
  exported_at:         string    // ISO
  app_version:         "1.0.0"
  model:               "gpt-4o-mini"
  lang:                "es" | "en"
  ui_mode:             string | null
  source_mode:         string | null     // "listen" | "simulate" | "mixed" | "chat"
  speaker_mode_default:string | null
  role_in_arena:       string | null
  context_label:       string | null
  session_status:      string             // outcome string
}
```

### SessionContext
```ts
{
  raw_context:       string              // verbatim context textarea content
  objective:         null               // always null — not parsed from raw
  known_objections:  null               // always null
  relevant_data:     null               // always null
}
```

Note: `objective`, `known_objections`, `relevant_data` are never populated. The structure exists but parsing is not implemented.

### SessionConfig
```ts
{
  input_mode:              string | null
  speaker_mode_default:    string | null
  arena_role:              string | null
  arena_variant:           null             // always null
  arena_state_model:       string | null    // "keyword_heuristic + gpt-4o-mini" (arena)
  runtime_instructions:    string[] | null  // seller notes (arena, client mode)
}
```

### AuditTurn (per turn)
```ts
{
  turn_index:          number
  timestamp:           string         // ISO
  mode:                "copilot" | "arena"
  source_mode:         string | null
  speaker_mode:        string | null
  raw_input:           string | null
  normalized_input:    string | null
  inferred_speaker:    string | null
  memory_before:       string[]
  model_request_summary: string | null
  model_output_raw:    string | null
  response_status:     "ok" | "error" | "partial"
  parse_error:         string | null
  notes:               string | null
  copilot?:            CopilotTurnData
  arena?:              ArenaTurnData
}
```

#### CopilotTurnData (present in copilot turns)
```ts
{
  signal, say_now, avoid,
  reading, mission, next_move, support,
  journey_past, journey_now, journey_next,
  momentum,
  memory_after: string[],
  why_this_turn_exists: "auto_listen_batch" | "manual_submit"
}
```

#### ArenaTurnData (present in arena turns)
```ts
{
  arena_role_of_user:        "seller" | "client"
  ai_role_this_turn:         "seller" | "client"
  user_message:              string | null
  ai_message:                string | null
  conversation_state_before: "favorable" | "tense" | "critical"
  conversation_state_after:  "favorable" | "tense" | "critical"
  terminal_state_detected:   "yes" | "no"
  terminal_state_type:       string | null
  terminal_state_source:     string | null
  tension_or_momentum:       string | null
  hidden_reasoning_summary:  string | null   // keyword-heuristic inference only
  coach?:                    ArenaTurnCoach  // only if coachLiteMap has entry
  journey?:                  ArenaTurnJourney
}
```

#### conversation_state_before/after derivation
`deriveArenaState(text, lang)` — keyword heuristic:
- `critical` if any critical keyword present (no me interesa, imposible, demasiado caro...)
- `favorable` if any favorable keyword present (interesante, me gusta, cuéntame más...)
- `tense` otherwise (default)

This is a simple heuristic, not GPT-based.

### SessionSummary
```ts
{
  final_outcome:          string | null
  final_outcome_source:   "user" | "system" | "ai" | "mixed"
  final_score:            number | null      // from copilot summarize or arena debrief
  final_global_state:     string | null
  final_result_label:     string | null
  final_momentum_or_state:string | null
  total_turns:            number
  total_user_turns:       number | null
  total_ai_turns:         number | null
  session_end_reason:     string | null
  strongest_moment:       null               // always null
  weakest_moment:         null               // always null
  unresolved_objections:  null               // always null
  missed_closing_window:  null               // always null
  final_call_memory:      string[]           // copilot: last call_memory; arena: []
  strengths:              string[]           // from copilot summarize
  improvements:           string[]           // from copilot summarize OR arena debrief critique
  full_report:            string | null      // from copilot summarize (if full_report=true)
}
```

### AuditHints
```ts
{
  likely_primary_failure:       string       // "seller" | "technical" | "system" | "none"
  suspected_prompt_issue:       "yes" | "no"
  suspected_ui_issue:           "yes" | "no"    // always "no"
  suspected_support_gap:        "yes" | "no"
  suspected_close_timing_issue: "yes" | "no"
  suspected_repetition_issue:   "yes" | "no"
  audit_notes:                  string[]
}
```

**Copilot audit notes** (auto-generated):
- Parse errors, API errors, consecutive same `say_now`, outcome=lost, no outcome declared, final momentum=red, no turns recorded.

**Arena audit notes** (auto-generated):
- outcome=lost/broken, outcome=closed (positive example), debrief score mention, exit note text, conversation >20 messages.

---

## Markdown output format

Sections in order:
```
# CLOSER WIZARD AUDIT LOG
## SESSION_META
## SESSION_CONTEXT
## SESSION_CONFIG
## HIDDEN_RUNTIME_INSTRUCTIONS  (only if seller notes exist)
## TURN_LOG
  ### TURN N
    #### COPILOT_ANALYSIS  (copilot turns)
    #### ARENA_TURN        (arena turns)
      #### COACH_ANALYSIS  (if coach entry exists)
      #### JOURNEY_STATE   (if journey data exists)
## READABLE_TRANSCRIPT
## SESSION_SUMMARY
## AUDIT_HINTS
```

Multi-line strings use YAML pipe syntax (`|`).

---

## Download filename format

```
cw-audit-{sessionId}-{YYYY-MM-DDTHH-MM-SS}.md
```

If no sessionId: uses `app_mode` as fallback.

---

## Builder input types

### CopilotSessionData
```ts
{
  sessionId, lang, sessionContext, contextLabel,
  speakerMode, inputModeUsed,
  callOutcome,
  callSummary: { score, globalState, resultLabel, strengths, improvements, fullReport? } | null,
  turnLog: CopilotTurnEntry[],
  finalMemory: string[]
}
```

### ArenaSessionData
```ts
{
  sessionId, lang, role, context, outcome, outcomeSource,
  totalTurns, userTurns, createdAt, closedAt,
  allMessages: ArenaMessageEntry[],
  exitNote: { text, outcome } | null,
  debrief: { score, critique[] } | null,
  runtimeInstructions?: string[],
  coachLiteMap?: Record<number, ArenaCoachEntry>
}
```

`coachLiteMap` keyed by AI message index (the `index` field from Arena allTurns).

---

## Known gaps
- `context.objective`, `context.known_objections`, `context.relevant_data` never populated.
- `strongest_moment`, `weakest_moment`, `unresolved_objections`, `missed_closing_window` always null.
- `arena_variant` always null.
- Arena `turns[].timestamp` uses `session.createdAt` for all turns (not per-turn timestamp — a known simplification).
- `arena_state_model` is always `"keyword_heuristic + gpt-4o-mini"` (hardcoded string in builder).
- `final_call_memory` is empty array for arena (no cumulative memory in arena mode).
