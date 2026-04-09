# VELA — AI Usage Tracking

`artifacts/api-server/src/lib/ai-tracker.ts`

Every OpenAI call in the system passes through `logAICall()`. This gives the debug panel and server logs complete observability over cost, tokens, and latency with zero database dependencies.

---

## Overview

```
openai.chat.completions.create(...)
         │
         ▼
logAICall({ route, endpoint, mode, sessionId, model,
            promptTokens, completionTokens, totalTokens,
            latencyMs, status, maxTokensConfigured })
         │
         ├──▶ Ring buffer (recentCalls, max 200)
         ├──▶ Global totals (calls, totalTokens, totalCostUsd)
         ├──▶ Route aggregates (per route: totals + rolling averages)
         ├──▶ Session aggregates (per sessionId: totals + rolling averages)
         └──▶ Pino log line (structured JSON)
```

---

## Cost Calculation

```typescript
cost = (promptTokens / 1000) * pricing.input
     + (completionTokens / 1000) * pricing.output
```

| Model | Input (per 1K) | Output (per 1K) |
|-------|---------------|----------------|
| `gpt-4o-mini` | $0.00015 | $0.0006 |
| `gpt-4o` | $0.0025 | $0.01 |
| `gpt-4` | $0.03 | $0.06 |
| `gpt-4-turbo` | $0.01 | $0.03 |

Unknown models get `estimatedCostUsd = null`.

---

## Data Structures

### `AiUsageRecord` (individual call)

```typescript
{
  callId: string          // UUID per call
  timestamp: string       // ISO 8601
  route: string           // e.g. "copilot/analyze"
  endpoint: string        // e.g. "analyze" | "terminal-state"
  mode: "copilot" | "arena"
  sessionId?: string
  model: string
  maxTokensConfigured: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number | null
  latencyMs: number
  status: "ok" | "error" | "partial"
  notes?: string          // parse errors, fallbacks
}
```

### `SessionUsageSummary` (per session)

```typescript
{
  sessionId: string
  mode: "copilot" | "arena"
  calls: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalCostUsd: number
  avgLatencyMs: number    // rolling average
  createdAt: string
  lastCallAt: string
}
```

### `RouteUsageSummary` (per route)

```typescript
{
  route: string
  calls: number
  totalTokens: number
  totalCostUsd: number
  avgLatencyMs: number           // rolling average
  avgPromptTokens: number        // rolling average
  avgCompletionTokens: number    // rolling average
}
```

---

## Storage Limits

| Store | Limit | Notes |
|-------|-------|-------|
| `recentCalls` ring buffer | 200 calls | FIFO — oldest evicted first |
| `sessionStore` | Unbounded during session | Removed 10 min after `closeSession()` |
| `routeStore` | One entry per route string | Grows with routes used; process-lifetime |
| Global totals | N/A | Monotonic; process-lifetime |

---

## Key Functions

### `logAICall(params)` → `AiUsageRecord`

The primary entry point. Called after every `openai.chat.completions.create()` succeeds. Must be called manually in each route after extracting `completion.usage`.

```typescript
logAICall({
  route: "copilot/analyze",
  endpoint: "analyze",
  sessionId: req.body.sessionId,
  mode: "copilot",
  model: "gpt-4o-mini",
  maxTokensConfigured: 900,
  promptTokens: usage.prompt_tokens,
  completionTokens: usage.completion_tokens,
  totalTokens: usage.total_tokens,
  latencyMs: Date.now() - t0,
  status: "ok",
});
```

### `closeSession(sessionId)`

Call when a session ends (copilot end-of-call or arena finish). Logs session totals to Pino and schedules deletion of session stats after 10 minutes. Keeps data visible in debug panel during the window.

### `getUsageSnapshot()`

Returns the full data structure served by `GET /api/debug/usage`. Top 20 sessions by cost, all routes sorted by cost, last 50 recent calls reversed (newest first).

### `estimateModelCost(model, promptTokens, completionTokens)`

Returns `number | null`. Use this for per-call cost estimation with any model.

### `estimateCost(promptTokens, completionTokens)` *(deprecated)*

Legacy alias that hard-codes gpt-4o-mini. Use `estimateModelCost()` instead.

---

## Pino Log Lines

Every `logAICall()` emits a structured Pino log:

```json
{
  "ai_usage": true,
  "callId": "uuid",
  "route": "copilot/analyze",
  "endpoint": "analyze",
  "sessionId": "uuid",
  "mode": "copilot",
  "model": "gpt-4o-mini",
  "prompt_tokens": 712,
  "completion_tokens": 443,
  "total_tokens": 1155,
  "cost_usd": 0.000372,
  "latency_ms": 834,
  "status": "ok",
  "notes": null
}
```

Human-readable message: `[AI] copilot/analyze:analyze | in=712 out=443 | $0.000372 | 834ms`

`closeSession()` emits a session-total line:
```json
{
  "ai_session_total": true,
  "sessionId": "uuid",
  "mode": "copilot",
  "calls": 12,
  "total_tokens": 14200,
  "cost_usd": 0.004680,
  "avg_latency_ms": 798
}
```

---

## Route Tags

| Route tag | Endpoints |
|-----------|---------|
| `copilot/analyze` | `analyze` |
| `copilot/summarize` | `summarize` |
| `copilot/context-label` | `context-label` |
| `arena/start` | `opening` |
| `arena/turn` | `turn`, `terminal-state` |
| `arena/suggest` | `suggest` |
| `arena/finish` | `debrief` |
