# Closer Wizard — AI Usage Tracking

`artifacts/api-server/src/lib/ai-tracker.ts`

Cada llamada a OpenAI en el sistema pasa por `logAICall()`. Esto le da al debug panel y a los logs del servidor visibilidad completa sobre coste, tokens y latencia sin dependencias de base de datos.

---

## Visión general

```
openai.chat.completions.create(...)
         │
         ▼
logAICall({ route, endpoint, mode, sessionId, model,
            promptTokens, completionTokens, totalTokens,
            latencyMs, status, maxTokensConfigured })
         │
         ├──▶ Ring buffer (recentCalls, máx 200)
         ├──▶ Totales globales (calls, totalTokens, totalCostUsd)
         ├──▶ Agregados por ruta (por route: totales + rolling averages)
         ├──▶ Agregados por sesión (por sessionId: totales + rolling averages)
         └──▶ Línea de log Pino (JSON estructurado)
```

---

## Cálculo de coste

```typescript
cost = (promptTokens / 1000) * pricing.input
     + (completionTokens / 1000) * pricing.output
```

| Modelo | Input (por 1K) | Output (por 1K) |
|--------|--------------|----------------|
| `gpt-4o-mini` | $0.00015 | $0.0006 |
| `gpt-4o` | $0.0025 | $0.01 |
| `gpt-4` | $0.03 | $0.06 |
| `gpt-4-turbo` | $0.01 | $0.03 |

Modelos desconocidos devuelven `estimatedCostUsd = null`.

---

## Estructuras de datos

### `AiUsageRecord` (llamada individual)

```typescript
{
  callId: string           // UUID por llamada
  timestamp: string        // ISO 8601
  route: string            // e.g. "copilot/analyze"
  endpoint: string         // e.g. "analyze" | "terminal-state"
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
  notes?: string           // errores de parsing, fallbacks
}
```

### `SessionUsageSummary` (por sesión)

```typescript
{
  sessionId: string
  mode: "copilot" | "arena"
  calls: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalCostUsd: number
  avgLatencyMs: number     // rolling average
  createdAt: string
  lastCallAt: string
}
```

### `RouteUsageSummary` (por ruta)

```typescript
{
  route: string
  calls: number
  totalTokens: number
  totalCostUsd: number
  avgLatencyMs: number            // rolling average
  avgPromptTokens: number         // rolling average
  avgCompletionTokens: number     // rolling average
}
```

---

## Límites de almacenamiento

| Store | Límite | Notas |
|-------|--------|-------|
| Ring buffer `recentCalls` | 200 llamadas | FIFO — el más antiguo se evicta primero |
| `sessionStore` | Sin límite durante sesión | Eliminado 10 min tras `closeSession()` |
| `routeStore` | Una entrada por route string | Crece con rutas usadas; lifetime del proceso |
| Totales globales | N/A | Monotónicos; lifetime del proceso |

---

## Funciones clave

### `logAICall(params)` → `AiUsageRecord`

El punto de entrada principal. Se llama después de cada `openai.chat.completions.create()` exitoso. Debe llamarse manualmente en cada ruta tras extraer `completion.usage`.

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

Llamar cuando termina una sesión (fin de llamada en copiloto o finish en arena). Registra totales de sesión en Pino y programa la eliminación de las stats tras 10 minutos. Mantiene los datos visibles en el debug panel durante ese tiempo.

### `getUsageSnapshot()`

Devuelve la estructura completa servida por `GET /api/debug/usage`. Top 20 sesiones por coste, todas las rutas ordenadas por coste, últimas 50 llamadas recientes invertidas (más reciente primero).

### `estimateModelCost(model, promptTokens, completionTokens)`

Devuelve `number | null`. Usar para estimación de coste por llamada con cualquier modelo.

### `estimateCost(promptTokens, completionTokens)` *(deprecated)*

Alias legacy que hardcodea gpt-4o-mini. Usar `estimateModelCost()` en su lugar.

---

## Líneas de log Pino

Cada `logAICall()` emite un log Pino estructurado:

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

Mensaje legible: `[AI] copilot/analyze:analyze | in=712 out=443 | $0.000372 | 834ms`

`closeSession()` emite una línea de totales de sesión:
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

## Tags de ruta

| Route tag | Endpoints |
|-----------|---------|
| `copilot/analyze` | `analyze` |
| `copilot/summarize` | `summarize` |
| `copilot/context-label` | `context-label` |
| `arena/start` | `opening` |
| `arena/turn` | `turn`, `terminal-state` |
| `arena/suggest` | `suggest` |
| `arena/finish` | `debrief` |
