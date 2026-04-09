# VELA — API Routes

All routes are served from the API server on port `8080` with prefix `/api/`.

---

## Copilot Routes

### `POST /api/copilot/analyze`

Analyzes a conversation fragment and returns tactical coaching.

**Request body:**
```json
{
  "fragment": "string",
  "lang": "es | en",
  "sessionContext": "string",
  "callMemory": ["string"],
  "speakerMode": "auto | client | me",
  "sessionId": "string"
}
```

**Response:**
```json
{
  "signal": "string",
  "say_now": "string",
  "avoid": "string | null",
  "detail": {
    "reading": "string",
    "mission": "string",
    "next_move": "string",
    "support": "string"
  },
  "journey": {
    "past": "string",
    "now": "string",
    "next": "string"
  },
  "call_memory": ["string"],
  "momentum": "green | amber | red"
}
```

**AI call:** gpt-4o-mini, `max_tokens=900`, temperature=0.4  
**Route tag for tracker:** `copilot/analyze`

---

### `POST /api/copilot/summarize`

Generates end-of-call summary. Called once for a quick summary; a second time with `full_report=true` for the extended report.

**Request body:**
```json
{
  "lang": "es | en",
  "sessionContext": "string",
  "callMemory": ["string"],
  "outcome": "closed | next_step | lost | unclear",
  "full_report": false,
  "sessionId": "string"
}
```

**Response:**
```json
{
  "score": 1,
  "globalState": "string",
  "resultLabel": "string",
  "strengths": ["string"],
  "improvements": ["string"],
  "fullReport": "string | undefined"
}
```

**AI call:** gpt-4o-mini, `max_tokens=400` (summary) or `max_tokens=1600` (full report), temperature=0.3  
**Route tag for tracker:** `copilot/summarize`

---

### `POST /api/copilot/context-label`

Auto-generates a short 3–5 word label from the user's session context text.

**Request body:**
```json
{
  "context": "string",
  "lang": "es | en"
}
```

**Response:**
```json
{
  "label": "string"
}
```

**AI call:** gpt-4o-mini, `max_tokens=25`, temperature=0  
**Route tag for tracker:** `copilot/context-label`  
**Note:** `sessionId` is not sent for this call (label is generated pre-session).

---

## Arena Routes

### `POST /api/arena/start`

Creates a new arena session and returns the AI's opening message.

**Request body:**
```json
{
  "role": "seller | client",
  "lang": "es | en",
  "context": "string",
  "clientProfile": "analytical | emotional | insecure | dominant | indecisive | hard_negotiator",
  "sellerProfile": "communicative | authoritative | technical | passive | aggressive | consultive",
  "difficulty": "easy | normal | hard | brutal"
}
```

**Response:**
```json
{
  "arenaSessionId": "uuid",
  "openingMessage": "string"
}
```

**AI call:** gpt-4o-mini, `max_tokens=150`  
**Route tag for tracker:** `arena/start` / endpoint `opening`  
**Session lifetime:** In-memory on server; deleted 5 min after `finish` is called.

---

### `POST /api/arena/turn`

Sends a user message and gets the AI's response. Also conditionally detects terminal state.

**Request body:**
```json
{
  "arenaSessionId": "uuid",
  "userMessage": "string"
}
```

**Response:**
```json
{
  "aiMessage": "string",
  "terminalSignal": "none | closed | next_step | lost | broken"
}
```

**AI calls (up to 2):**
1. Turn response — gpt-4o-mini, `max_tokens=300`  
2. Terminal state detection — gpt-4o-mini, `max_tokens=5`, temperature=0 (conditional — see [arena-logic.md](./arena-logic.md))

**Route tag for tracker:** `arena/turn` / endpoints `turn` + `terminal-state`

---

### `POST /api/arena/suggest`

Generates an ideal response for the user to send next. In seller mode, it auto-sends the suggestion as the user's next turn after the API returns.

**Request body:**
```json
{
  "arenaSessionId": "uuid",
  "lang": "es | en"
}
```

**Response:**
```json
{
  "suggestion": "string"
}
```

**AI call:** gpt-4o-mini, `max_tokens=200`  
**Route tag for tracker:** `arena/suggest` / endpoint `suggest`  
**Note:** The frontend automatically calls `/api/arena/turn` with the suggestion after receiving it.

---

### `POST /api/arena/finish`

Ends the arena session, generates debrief (seller mode only), and cleans up.

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
  "turns": [
    {
      "index": 0,
      "timestamp": "ISO8601",
      "speaker": "user | ai",
      "message": "string"
    }
  ],
  "summary": {
    "role": "seller | client",
    "context": "string",
    "lang": "es | en",
    "totalTurns": 10,
    "userTurns": 5,
    "createdAt": "ISO8601",
    "closedAt": "ISO8601",
    "outcome": "closed | next_step | lost | broken | manual_stop",
    "debrief": {
      "score": 7,
      "critique": ["point 1", "point 2", "point 3"]
    }
  }
}
```

**AI call (optional):** gpt-4o-mini, `max_tokens=300` — only when `role=seller` and at least one user turn exists  
**Route tag for tracker:** `arena/finish` / endpoint `debrief`  
**Cleanup:** In-memory session deleted 5 min after this call. `closeSession()` called on ai-tracker (keeps stats 10 min).

---

## Debug Routes

### `GET /api/debug/usage`

Returns the complete AI usage snapshot for the debug panel. No authentication.

**Response:**
```json
{
  "serverStartedAt": "ISO8601",
  "global": {
    "calls": 42,
    "totalTokens": 85000,
    "totalCostUsd": 0.024
  },
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
      "model": "gpt-4o-mini",
      "promptTokens": 700,
      "completionTokens": 450,
      "totalTokens": 1150,
      "estimatedCostUsd": 0.000375,
      "latencyMs": 820,
      "status": "ok"
    }
  ]
}
```

**Polling:** Debug panel polls this endpoint every 5 seconds when open.  
**recentCalls:** Last 50 of the 200-call ring buffer, most recent first.
