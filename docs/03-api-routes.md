# 03 — API ROUTES
_Generated: 2026-04-09_

Base URL: `/api/`  
Server: Express on port 8080.  
All bodies: `application/json`.  
All responses: `application/json`.

---

## COPILOT ROUTES

### POST /api/copilot/analyze

Real-time tactical analysis of a conversation fragment.

**Request body**
```json
{
  "text": "string (required) — conversation fragment",
  "context": "string (optional) — session context",
  "call_memory": "string (optional) — accumulated memory lines, newline-separated",
  "lang": "\"es\" | \"en\" (default: es)"
}
```

**Request header**
```
x-session-id: <uuid>   (optional — used for AI tracking only)
```

**Response**
```json
{
  "signal": "2-5 word tactical label",
  "say_now": "4-12 word imperative action",
  "avoid": "2-7 word warning or null",
  "detail": {
    "reading": "what is happening ≤20 words",
    "mission": "what to achieve now",
    "next_move": "concrete action expanded",
    "support": "data / argument / criterion"
  },
  "journey": {
    "past": "2-4 words",
    "now": "3-6 words",
    "next": "2-4 words"
  },
  "call_memory": {
    "summary_lines": ["line 1", "... up to 6"]
  },
  "momentum": "green | amber | red"
}
```

Validated by Zod (`AnalyzeConversationResponse`). On JSON parse failure, returns a safe fallback with `signal: "falta claridad"`.

---

### POST /api/copilot/summarize

End-of-call performance analysis.

**Request body**
```json
{
  "call_memory": ["line 1", "line 2"],
  "outcome": "string — e.g. 'closed', 'lost', 'unclear'",
  "lang": "\"es\" | \"en\"",
  "full_report": false
}
```

`full_report: true` → generates a structured text report in addition to JSON fields. Increases max_tokens from 400 to 1600.

**Response**
```json
{
  "score": 7.4,
  "global_state": "fuerte | strong | ...",
  "result_label": "string",
  "strengths": ["s1", "s2"],
  "improvements": ["i1", "i2"],
  "full_report": "string or null"
}
```

---

### POST /api/copilot/audit-report

Brutal post-session audit. Lazy-loaded on demand (not triggered automatically).

**Request body**
```json
{
  "call_memory": ["line 1", "..."],
  "outcome": "string",
  "context": "string (optional)",
  "lang": "\"es\" | \"en\""
}
```

**Response** (`BrutalAudit`)
```json
{
  "verdict": "string",
  "what_worked": ["string"],
  "what_failed": ["string"],
  "failure_owner": ["vendedor|timing|sistema|técnico|setup|sin fallo real — description"],
  "missed_closes": ["string"],
  "rules_violated": ["string"],
  "priority_changes": ["string", "string", "string"],
  "prompt_patch": "string or null",
  "prompt_for_replit": "string or null",
  "what_i_would_have_done": "string"
}
```

No Zod validation — raw JSON from model. 500 on failure.

---

### POST /api/copilot/context-label

Generates a 4-6 word scene title from raw context text.

**Request body**
```json
{
  "context": "string",
  "lang": "\"es\" | \"en\""
}
```

**Response**
```json
{ "label": "4-6 word title string" }
```

Returns `{ label: "" }` on empty input or error (never 500).

---

## ARENA ROUTES

### POST /api/arena/preset-context

Generates a role-concordant 1st-person scenario description for a preset.

**Request body**
```json
{
  "preset": "immvest | saas | b2b | high_ticket | coaching | challenge",
  "role": "seller | client",
  "lang": "\"es\" | \"en\""
}
```

**Response**
```json
{ "context": "generated scenario text" }
```

max_tokens: 120 for immvest, 65 for all others. Temperature: 0.95.  
400 on invalid preset or role.

---

### POST /api/arena/adapt-context

Rewrites an existing context text to match a different role's POV. Called when user switches role with text already written.

**Request body**
```json
{
  "text": "string (required)",
  "fromRole": "seller | client",
  "toRole": "seller | client",
  "lang": "\"es\" | \"en\""
}
```

**Response**
```json
{ "context": "rewritten text" }
```

On error: returns original `text` (never 500 to user). max_tokens: 150, temp: 0.2.

---

### POST /api/arena/start

Creates a new session, generates AI opening message.

**Request body**
```json
{
  "role": "seller | client",
  "lang": "\"es\" | \"en\"",
  "context": "string",
  "clientProfile": "analytical|emotional|skeptical|cautious|dominant|indecisive|negotiator (optional)",
  "sellerProfile": "communicative|authoritative|technical|passive|aggressive|consultive (optional)",
  "difficulty": "easy | normal | hard | brutal (optional)",
  "forceTerminal": false,
  "randomPreset": "immvest|saas|b2b|high_ticket|coaching|challenge (optional)"
}
```

Legacy aliases resolved server-side: `insecure` → `cautious`, `hard_negotiator` → `negotiator`, `random`/`aleatorio` → undefined.

**Response**
```json
{
  "arenaSessionId": "uuid",
  "openingMessage": "AI first line"
}
```

---

### POST /api/arena/turn

Sends user message, gets AI response + side data.

**Request body**
```json
{
  "arenaSessionId": "uuid",
  "userMessage": "string (optional — omitted for shortcut)",
  "shortcutDirection": "agree | object (optional — client mode only)"
}
```

If `shortcutDirection` is set, a synthetic user message is generated server-side via `generateShortcutResponse` (max_tokens: 80, temp: 0.7).

**Response**
```json
{
  "aiMessage": "string",
  "terminalSignal": "none | closed | next_step | lost | broken",
  "coachLite": {
    "explanation": "3-line string",
    "journey": {
      "stages": { "context": "done|current|upcoming", "problem": "...", "blocker": "...", "fit": "...", "advance": "...", "close": "..." },
      "now_help": "string",
      "next_help": "string",
      "premature_close_risk": "low | medium | high"
    }
  },
  "generatedUserMessage": "string (only if shortcutDirection used)"
}
```

`coachLite` only present in client mode. `journey` only present if model returned valid JSON. Terminal detection only runs in seller mode and is gated by `shouldCheckTerminal()` (keyword check + every 3rd turn after turn 6) unless `forceTerminal=true`.

---

### POST /api/arena/finish

Closes the session, generates debrief (seller mode only).

**Request body**
```json
{
  "arenaSessionId": "uuid",
  "outcome": "closed | next_step | lost | broken | manual_stop"
}
```

**Response**
```json
{
  "turns": [{ "index": 0, "timestamp": "ISO", "speaker": "user|ai", "message": "string" }],
  "summary": {
    "role": "seller | client",
    "context": "string",
    "lang": "es | en",
    "totalTurns": 10,
    "userTurns": 5,
    "createdAt": "ISO",
    "closedAt": "ISO",
    "outcome": "string",
    "debrief": {
      "score": 7,
      "critique": ["line 1", "line 2", "line 3"]
    }
  }
}
```

`debrief` is `null` if role is client or no user turns. Session removed from Map 5 min after finish.

---

### POST /api/arena/note

Injects a seller constraint note mid-session (client mode).

**Request body**
```json
{
  "arenaSessionId": "uuid",
  "note": "string"
}
```

**Response**
```json
{ "ok": true, "noteCount": 3 }
```

---

### POST /api/arena/repitch

Makes the AI seller restate its position naturally after a note injection.

**Request body**
```json
{ "arenaSessionId": "uuid" }
```

**Response**
```json
{ "message": "string", "index": 5 }
```

max_tokens: 300, temp: 0.7.

---

### POST /api/arena/suggest

Generates the ideal seller response for the current conversation state.

**Request body**
```json
{
  "arenaSessionId": "uuid",
  "lang": "\"es\" | \"en\" (optional — falls back to session lang)"
}
```

**Response**
```json
{ "suggestion": "2-3 sentence ideal seller message" }
```

Uses last 10 turns. max_tokens: 200, temp: 0.5.

---

### POST /api/arena/audit-report

Brutal post-session audit for Arena. Role-aware prompt.

**Request body**
```json
{
  "transcript": [{ "speaker": "user | ai", "message": "string" }],
  "context": "string",
  "outcome": "string",
  "role": "seller | client",
  "clientProfile": "string (optional)",
  "sellerProfile": "string (optional)",
  "difficulty": "string (optional)",
  "lang": "\"es\" | \"en\""
}
```

When `role=seller`: evaluates user as seller, client IA as opponent.  
When `role=client`: evaluates quality of the AI seller (was the simulation useful?).

**Response**: same `BrutalAudit` schema as copilot audit-report.

---

## DEBUG ROUTE

### GET /api/debug/usage

Returns AI usage snapshot (in-memory, resets on restart).

**Response**
```json
{
  "serverStartedAt": "ISO",
  "global": { "calls": 42, "totalTokens": 50000, "totalCostUsd": 0.012 },
  "routes": [{ "route": "...", "calls": 10, "totalTokens": 5000, "totalCostUsd": 0.005, "avgLatencyMs": 800, "avgPromptTokens": 400, "avgCompletionTokens": 100 }],
  "sessions": [{ "sessionId": "...", "mode": "arena", "calls": 5, "totalTokens": 3000, "totalCostUsd": 0.003, "avgLatencyMs": 750 }],
  "recentCalls": [{ "callId": "...", "route": "...", "endpoint": "...", "promptTokens": 400, ... }]
}
```
