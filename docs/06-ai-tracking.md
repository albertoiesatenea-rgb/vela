# 06 — AI TRACKING
_Generated: 2026-04-09_

## Purpose

`artifacts/api-server/src/lib/ai-tracker.ts` — centralized in-memory observability layer for every OpenAI call.

- No database, no file write. Resets on server restart.
- Records tokens, cost, latency, session context per call.
- Aggregates by route and by session.
- Exposes data via `GET /api/debug/usage`.

---

## Pricing table

| Model | Input (per 1K tokens) | Output (per 1K tokens) |
|---|---|---|
| gpt-4o-mini | $0.00015 | $0.0006 |
| gpt-4o | $0.0025 | $0.01 |
| gpt-4 | $0.03 | $0.06 |
| gpt-4-turbo | $0.01 | $0.03 |

Unknown models → `estimatedCostUsd: null`.

---

## Data structures

### AiUsageRecord (per call)
```ts
{
  callId:               string      // UUID per call
  timestamp:            string      // ISO
  route:                string      // e.g. "copilot/analyze"
  endpoint:             string      // e.g. "analyze" | "terminal-state" | "coach-lite" | "journey"
  mode:                 "copilot" | "arena"
  sessionId?:           string
  model:                string
  maxTokensConfigured:  number
  promptTokens:         number
  completionTokens:     number
  totalTokens:          number
  estimatedCostUsd:     number | null
  latencyMs:            number
  status:               "ok" | "error" | "partial"
  notes?:               string      // parse errors, fallbacks
}
```

### SessionUsageSummary (aggregated per session)
```ts
{
  sessionId:            string
  mode:                 "copilot" | "arena"
  calls:                number
  totalPromptTokens:    number
  totalCompletionTokens: number
  totalTokens:          number
  totalCostUsd:         number
  avgLatencyMs:         number     // rolling average
  createdAt:            string
  lastCallAt:           string
}
```

### RouteUsageSummary (aggregated per route)
```ts
{
  route:                string
  calls:                number
  totalTokens:          number
  totalCostUsd:         number
  avgLatencyMs:         number     // rolling average
  avgPromptTokens:      number     // rolling average
  avgCompletionTokens:  number     // rolling average
}
```

---

## Ring buffer

`recentCalls`: array of up to 200 `AiUsageRecord` objects.  
When full, oldest call is removed (`shift()`).  
`GET /api/debug/usage` returns the last 50 in reverse chronological order.

---

## Global totals

```ts
{ calls: number, totalTokens: number, totalCostUsd: number }
```

Incremented on every `logAICall()`. Not reset except on restart.

---

## API: logAICall(params)

Called from every route after each OpenAI response. Params:
```ts
{
  route, endpoint, mode, sessionId?,
  model, maxTokensConfigured,
  promptTokens, completionTokens, totalTokens,
  latencyMs, status, notes?
}
```

Executes:
1. Calculate `estimatedCostUsd`.
2. Push to `recentCalls` ring buffer.
3. Update `global` totals.
4. Update/create `routeStore` entry (rolling averages).
5. Update/create `sessionStore` entry (rolling average for latency, sums for tokens/cost).
6. Write a Pino log line with `ai_usage: true`.

---

## API: closeSession(sessionId)

Called at `POST /api/arena/finish`.

- Reads session totals from `sessionStore`.
- Writes a Pino log line with `ai_session_total: true` and all cumulative numbers.
- Schedules `sessionStore.delete(sessionId)` after 10 min.

---

## API: getUsageSnapshot()

Returns current state of all stores. Used by `GET /api/debug/usage`.

- Routes sorted by `totalCostUsd` descending.
- Sessions: top 20 by cost.
- Recent calls: last 50, reversed.
- All `costUsd` values rounded to 6 decimal places. `avgLatencyMs` rounded to integer.

---

## Endpoint-to-endpoint mapping (current calls and their tracker labels)

| Route | endpoint | mode | max_tokens |
|---|---|---|---|
| copilot/analyze | analyze | copilot | 900 |
| copilot/summarize | summarize OR summarize-full | copilot | 400 / 1600 |
| copilot/context-label | context-label | copilot | 25 |
| arena/start | opening | arena | 150 |
| arena/turn (main) | turn | arena | 220 or 300 |
| arena/turn (terminal) | terminal-state | arena | 5 |
| arena/turn (coach-lite) | coach-lite | arena | 280 |
| arena/turn (journey) | journey | arena | 200 |
| arena/turn (shortcut) | shortcut | arena | 80 |
| arena/repitch | turn | arena | 300 |
| arena/suggest | suggest | arena | 200 |
| arena/finish (debrief) | debrief | arena | 300 |

Note: `copilot/audit-report` and `arena/audit-report` do NOT currently call `logAICall()`. They call OpenAI directly without tracking. This is a known gap.

CoachLite and Journey `latencyMs` are hardcoded to `0` (parallel calls — start time not captured before parallel block).

---

## Known limitations
- No persistence — all data lost on server restart.
- audit-report endpoints (both) not tracked.
- CoachLite and Journey latency always 0.
- No alerts or threshold triggers — purely observational.
