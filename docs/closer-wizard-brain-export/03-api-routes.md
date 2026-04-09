# VELA — API Routes

Todas las rutas se sirven desde el API server en el puerto `8080` con prefijo `/api/`.

---

## Rutas de Copiloto

### `POST /api/copilot/analyze`

Analiza un fragmento de conversación y devuelve coaching táctico.

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

**Llamada IA:** gpt-4o-mini, `max_tokens=900`, temperature=0.4  
**Route tag:** `copilot/analyze` / endpoint `analyze`

---

### `POST /api/copilot/summarize`

Genera el resumen de fin de llamada. Se puede llamar dos veces: una para resumen rápido y otra con `full_report=true` para el informe completo.

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
  "score": 7,
  "globalState": "string",
  "resultLabel": "string",
  "strengths": ["string"],
  "improvements": ["string"],
  "fullReport": "string | undefined"
}
```

**Llamada IA:** gpt-4o-mini, `max_tokens=400` (resumen) o `max_tokens=1600` (full report), temperature=0.3  
**Route tag:** `copilot/summarize` / endpoint `summarize`

---

### `POST /api/copilot/context-label`

Auto-genera un label corto de 3–5 palabras a partir del texto de contexto del usuario.

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

**Llamada IA:** gpt-4o-mini, `max_tokens=25`, temperature=0  
**Route tag:** `copilot/context-label`  
**Nota:** No se envía `sessionId` (el label se genera antes de iniciar la sesión).

---

## Rutas de Arena

### `POST /api/arena/start`

Crea una sesión de Arena nueva y devuelve el mensaje de apertura de la IA.

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

**Llamada IA:** gpt-4o-mini, `max_tokens=150`  
**Route tag:** `arena/start` / endpoint `opening`  
**Lifetime de sesión:** En memoria en servidor; eliminada 5 min después de `finish`.

---

### `POST /api/arena/turn`

Envía un mensaje del usuario y recibe la respuesta de la IA. También detecta estado terminal condicionalmente.

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

**Llamadas IA (hasta 2):**
1. Respuesta del turno — gpt-4o-mini, `max_tokens=300`
2. Detección de estado terminal — gpt-4o-mini, `max_tokens=5`, temperature=0 (condicional)

**Route tag:** `arena/turn` / endpoints `turn` + `terminal-state`

---

### `POST /api/arena/suggest`

Genera la respuesta ideal para que el usuario envíe a continuación. En seller mode se auto-envía como turno del usuario.

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

**Llamada IA:** gpt-4o-mini, `max_tokens=200`  
**Route tag:** `arena/suggest` / endpoint `suggest`  
**Nota:** El frontend llama automáticamente a `/api/arena/turn` con la sugerencia tras recibirla.

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
      "critique": ["punto 1", "punto 2", "punto 3"]
    }
  }
}
```

**Llamada IA (opcional):** gpt-4o-mini, `max_tokens=300` — solo cuando `role=seller` y hay al menos un turno del usuario  
**Route tag:** `arena/finish` / endpoint `debrief`  
**Limpieza:** Sesión en memoria eliminada 5 min después. `closeSession()` llamado en ai-tracker (mantiene stats 10 min).

---

## Rutas de Debug

### `GET /api/debug/usage`

Devuelve el snapshot completo de uso de IA para el debug panel. Sin autenticación.

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

**Polling:** El debug panel consulta este endpoint cada 5 segundos cuando está abierto.  
**recentCalls:** Últimas 50 de las 200 del ring buffer, más reciente primero.
