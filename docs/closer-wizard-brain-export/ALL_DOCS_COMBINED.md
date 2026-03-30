# CLOSER WIZARD BRAIN — ALL DOCS COMBINED

> Archivo combinado generado automáticamente. Contiene los 12 documentos del Closer Wizard Brain.
> Para navegar usa el índice en 00-index.md o busca por sección con Ctrl+F.

---

<!-- ============================================================ -->
<!-- ARCHIVO: 00-index.md -->
<!-- ============================================================ -->

# Closer Wizard — Brain Docs Index

| Archivo | Contenido |
|---------|-----------|
| [01-current-state.md](./01-current-state.md) | Estado actual del proyecto, features completadas, decisiones clave |
| [02-architecture.md](./02-architecture.md) | Vista general del sistema, flujos de datos, state management |
| [03-api-routes.md](./03-api-routes.md) | Todos los endpoints — request/response, tokens, route tags |
| [04-prompts.md](./04-prompts.md) | Cada prompt de IA — copilot V1/V2, arena, debrief, terminal, suggest |
| [05-arena-logic.md](./05-arena-logic.md) | Lifecycle Arena, roles, personalidades, windowing, detección terminal |
| [06-ai-tracking.md](./06-ai-tracking.md) | Tracker de uso — estructuras, coste, log lines, tags de ruta |
| [07-audit-log.md](./07-audit-log.md) | Pipeline audit log, schema completo, heurística, formato Markdown |
| [08-debug-panel.md](./08-debug-panel.md) | Layout panel, alertas, pin, tabs, polling |
| [09-feature-flags.md](./09-feature-flags.md) | LEGACY_PROMPTS y LEGACY_ARENA — comportamiento y coste |
| [10-replit-prompt-style.md](./10-replit-prompt-style.md) | Cómo escribir prompts para Replit AI — estructura, plantilla, ejemplos |
| [11-sales-references.md](./11-sales-references.md) | Principios de venta, perfiles de comprador, objeciones, cierre, aplicación a Closer Wizard |


---

<!-- ============================================================ -->
<!-- ARCHIVO: 01-current-state.md -->
<!-- ============================================================ -->

# Closer Wizard — Estado Actual del Proyecto

Fecha de referencia: marzo 2026

---

## Features completadas

### Copiloto
- Setup screen con campo de contexto libre
- Auto-generación de context label (POST /api/copilot/context-label, max_tokens=25)
- Modo escucha (Web Speech API) y modo simulación (texto pegado)
- Speaker mode: auto / cliente / yo
- Análisis en tiempo real (POST /api/copilot/analyze, gpt-4o-mini V2 ~700 tokens)
- Hero card: signal + say_now
- Detail expandible: reading, mission, next_move, support
- Journey (past/now/next)
- Call memory strip (hasta 5 ítems)
- Momentum indicator: green / amber / red (colorblind-safe, no rojo de alarma)
- End-of-call: declarar outcome (closed / next_step / lost / unclear)
- Resumen post-llamada con score 1–10, globalState, resultLabel, strengths, improvements
- Full report opcional (max_tokens=1600)
- Descarga de audit log en .md

### Arena
- Setup: role (seller/client), contexto, clientProfile, sellerProfile, difficulty
- Apertura AI generada (max_tokens=150)
- Turnos bidireccionales (max_tokens=300, historial con windowing de 12 turnos)
- Detección terminal condicional: keywords + clasificación IA (max_tokens=5)
- Outcomes: closed / next_step / lost / broken / manual_stop
- Botón ✨ Suggest: genera respuesta ideal y la auto-envía
- Debrief post-sesión: score 1–10 + 3 frases accionables (seller mode only)
- Descarga de audit log en .md

### Debug Panel
- Overlay con z-index correcto (z-49 backdrop, z-50 panel)
- Pin/unpin con Pin/PinOff icons; pin = sin backdrop, clicks pasan al app
- Persistencia en localStorage (cwiz-debug-pinned / cwiz-debug-open / cwiz-debug-detail)
- KPIs de sesión: coste / tokens / llamadas / latencia avg
- KPIs globales: total$ / tokens / llamadas / top ruta
- Alert system: LATENCIA ALTA >2000ms (sky-400) / CARA >$0.05 (amber-300) / VIGILAR >$0.015 o >1400ms o >25 llamadas (amber-400) / NORMAL (zinc-500)
- Badge de ruta dominante si una ruta >70% del gasto
- Detalle colapsable: filtro de modo + tabs Sesiones / Rutas / Llamadas
- Polling cada 5s cuando está abierto
- Presente en los 3 return paths de copilot.tsx y en arena.tsx

### AI Tracker (v2)
- Ring buffer de 200 llamadas
- Agregados por sesión con rolling averages
- Agregados por ruta con rolling averages
- closeSession() mantiene stats 10 min para el debug panel
- Pino structured logging por cada llamada y por sesión

### Audit Log
- buildCopilotAuditLog / buildArenaAuditLog → AuditLog → renderAuditLogMarkdown → .md
- Schema completo: meta, context, config, turns, readable_transcript, summary, audit_hints
- Detección automática de anomalías: parse errors, repetición, momentum, outcomes

---

## Decisiones de diseño clave

- **Paleta colorblind-safe**: sky-blue / amber / teal. Sin rojo para información importante.
- **Minimalismo**: sin etiquetas de sección innecesarias, sin flechas `→`, sin seller hints.
- **No DB**: todo en memoria. Server restart = pérdida de datos de sesión.
- **Un solo modelo**: gpt-4o-mini para todo. Sin mezcla de modelos.
- **Idioma**: ES por defecto, EN disponible. Toggle guardado en localStorage.
- **V2 prompt default**: ~700 tokens vs ~2100 del V1. Feature flag LEGACY_PROMPTS para debug.

---

## Limitaciones conocidas

- La sesión de Copiloto no persiste entre recargas de página (solo React state).
- Las sesiones de Arena son in-memory; un restart del servidor las pierde.
- Arena sessions se eliminan 5 min después de `finish` — no hay histórico permanente.
- El `hidden_reasoning_summary` del audit log de Arena es heurístico (keyword-based), no razonamiento real del modelo.
- `copilot/context-label` no envía `sessionId` (el label se genera antes de iniciar sesión).
- No hay autenticación ni cuentas de usuario.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Node.js + Express + Pino |
| Modelo IA | gpt-4o-mini (OpenAI) |
| Monorepo | pnpm workspaces |
| Estado servidor | In-memory (Map) |
| Estado cliente | React state + localStorage |
| Puerto API | 8080 |


---

<!-- ============================================================ -->
<!-- ARCHIVO: 02-architecture.md -->
<!-- ============================================================ -->

# Closer Wizard — Architecture

## Overview

Closer Wizard es un asistente táctico ultraminimalista para llamadas de ventas. Tiene dos modos principales:

- **Copiloto** — coaching IA en tiempo real durante llamadas de ventas en vivo
- **Arena** — simulación de conversación de ventas para práctica

El sistema es un monorepo (`pnpm` workspaces) con dos servicios principales:

| Servicio | Package | Tech | Puerto |
|---------|---------|------|--------|
| Frontend | `@workspace/silent-closer` | React + Vite + Tailwind | `$PORT` (env) |
| API | `@workspace/api-server` | Node.js + Express + Pino | `8080` |

Todas las rutas API tienen prefijo `/api/`.

---

## Estructura de directorios

```
workspace/
├── artifacts/
│   ├── silent-closer/          # Frontend React
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── copilot.tsx     # UI modo Copiloto
│   │       │   └── arena.tsx       # UI modo Arena
│   │       ├── components/
│   │       │   └── debug-panel.tsx # Overlay de debug para developers
│   │       └── lib/
│   │           └── audit-log.ts    # Builder + renderer del audit log
│   └── api-server/             # API Express
│       └── src/
│           ├── routes/
│           │   ├── copilot.ts      # /api/copilot/*
│           │   ├── arena.ts        # /api/arena/*
│           │   └── debug.ts        # /api/debug/usage
│           └── lib/
│               ├── ai-tracker.ts   # Observabilidad centralizada de llamadas IA
│               └── logger.ts       # Pino structured logger
└── docs/                       # Esta documentación
```

---

## Flujo de datos — Copiloto

```
Voz del usuario / Texto pegado
         │
         ▼
Web Speech API (o paste manual)
         │
         ▼
POST /api/copilot/analyze  ←─ contexto de sesión, call memory, lang, speaker_mode
         │
         ▼ (gpt-4o-mini, ~700 tokens prompt)
JSON: signal, say_now, avoid, detail, journey, call_memory, momentum
         │
         ▼
UI actualiza hero card + memory strip
         │
    (fin de llamada)
         ▼
POST /api/copilot/summarize  ←─ turn log completo
         │
         ▼ (gpt-4o-mini, 900–1600 tokens budget)
JSON: score, globalState, resultLabel, strengths, improvements, fullReport
         │
         ▼
Audit log construido en cliente → descarga .md
```

## Flujo de datos — Arena

```
Config (role, context, profiles, difficulty)
         │
         ▼
POST /api/arena/start  ←─ role, lang, context, clientProfile, sellerProfile, difficulty
         │
         ▼ (gpt-4o-mini, max_tokens=150)
Mensaje de apertura IA → guardado en Map de sesiones (servidor)
         │
Usuario escribe mensaje
         ▼
POST /api/arena/turn  ←─ arenaSessionId, userMessage
         │
         ├──▶ Respuesta IA del turno (max_tokens=300)
         └──▶ Detección de estado terminal (condicional, max_tokens=5)
              │
              ▼
      { aiMessage, terminalSignal }
         │
    (sesión termina)
         ▼
POST /api/arena/finish  ←─ arenaSessionId, outcome
         │
         ▼ (debrief gpt-4o-mini, max_tokens=300)
{ turns, summary { debrief { score, critique } } }
         │
         ▼
Audit log construido en cliente → descarga .md
```

---

## Gestión de estado

### Servidor (solo en memoria, sin DB)

| Store | Ubicación | Lifetime |
|-------|---------|---------|
| Sesiones Arena (`Map<id, ArenaSession>`) | `arena.ts` | Eliminadas 5 min tras `finish` |
| Ring buffer de llamadas IA (200 máx) | `ai-tracker.ts` | Lifetime del proceso |
| Resúmenes de uso por sesión | `ai-tracker.ts` | 10 min tras `closeSession()` |
| Agregados por ruta y totales globales | `ai-tracker.ts` | Lifetime del proceso |

**Server restart = pérdida de todos los datos de sesión y Arena.**

### Cliente (localStorage)

| Clave | Propósito |
|-------|---------|
| `sc_lang` | Preferencia de idioma (es/en) |
| `sc_context_label` | Último context label usado |
| `cwiz-debug-pinned` | Estado de pin del debug panel |
| `cwiz-debug-open` | Estado de apertura del debug panel |
| `cwiz-debug-detail` | Estado del acordeón de detalle |

La sesión de Copiloto (texto de contexto, turn log, call memory) vive en React state y se pierde al recargar la página.

---

## Modelo IA

Todas las llamadas IA usan **gpt-4o-mini** exclusivamente.

Precios:
- Input: $0.00015 por 1K tokens ($0.15 por 1M)
- Output: $0.0006 por 1K tokens ($0.60 por 1M)

---

## Soporte de idiomas

Todo el texto de usuario y los prompts soportan **ES** (español, por defecto) y **EN** (inglés). El toggle de idioma se guarda en localStorage y se envía con cada petición API como campo `lang`.

---

## Paleta de accesibilidad

- Paleta colorblind-safe: sky-blue, amber, teal en lugar de rojo/verde para información crítica.
- Alertas del debug panel: sky-400 (latencia), amber-300 (coste), amber-400 (vigilar), zinc-500 (normal).


---

<!-- ============================================================ -->
<!-- ARCHIVO: 03-api-routes.md -->
<!-- ============================================================ -->

# Closer Wizard — API Routes

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


---

<!-- ============================================================ -->
<!-- ARCHIVO: 04-prompts.md -->
<!-- ============================================================ -->

# Closer Wizard — AI Prompts

Todos los prompts usan **gpt-4o-mini**. Dos niveles de optimización existen detrás de feature flags.

---

## Prompts de Copiloto

### V2 (Default — ~700 tokens de entrada)

El prompt V2 es el default de producción. Compacto, estructurado y con JSON output estricto.

**Estructura del system prompt (abreviada):**
```
Eres un copiloto de ventas en tiempo real.
Contexto de la llamada: {sessionContext}
Memoria actual: {callMemory como lista}
Idioma: {regla de lang}

Analiza el fragmento y responde SOLO con JSON válido:
{
  "signal": "<etiqueta de señal breve>",
  "say_now": "<frase exacta a decir ahora>",
  "avoid": "<qué evitar o null>",
  "detail": {
    "reading": "<lectura de la situación>",
    "mission": "<objetivo de este turno>",
    "next_move": "<movimiento recomendado>",
    "support": "<argumento de apoyo>"
  },
  "journey": { "past": "...", "now": "...", "next": "..." },
  "call_memory": ["<hasta 5 ítems actualizados>"],
  "momentum": "green | amber | red"
}
```

**User message:**
```
[{inferred_speaker}]: {fragment}
```

### V1 (Legacy — ~2100 tokens de entrada)

Activado con `LEGACY_PROMPTS=true`. Más verboso, incluye ejemplos extensos y repetición de instrucciones. Output funcionalmente equivalente. Usar solo para debug de regresiones.

---

### Copiloto: summarize

Llamado al final de la llamada. Dos modos:

**Resumen rápido** (`full_report=false`, `max_tokens=400`):
```
Evalúa esta llamada de ventas.
Contexto: {sessionContext}
Resultado declarado: {outcome}
Memoria final: {callMemory}

Responde SOLO con JSON:
{
  "score": <1-10>,
  "globalState": "<estado global breve>",
  "resultLabel": "<etiqueta de resultado>",
  "strengths": ["...","..."],
  "improvements": ["...","..."]
}
```

**Informe completo** (`full_report=true`, `max_tokens=1600`):
Igual que arriba pero añade `"fullReport": "<análisis narrativo detallado>"` al schema JSON e instruye al modelo a escribir 3–5 párrafos de análisis de coaching.

---

### Copiloto: context-label

Genera un label de 3–5 palabras a partir del contexto escrito por el usuario.

```
Genera un label de 3-5 palabras para este contexto de llamada de ventas.
Contexto: {context}
Responde solo con el label, sin puntuación.
Idioma: {lang}
```

`max_tokens=25`, temperature=0.

---

## Prompts de Arena

### System prompt (seller mode — IA juega de cliente)

```
Eres el cliente/prospecto en una simulación de conversación de venta.

Contexto: {context}
PERSONALIDAD: {CLIENT_PROFILE_DESC[clientProfile]}
DIFICULTAD: {DIFFICULTY_DESC[difficulty]}
[nota de windowing si historial > 12 turnos]

Tu papel es la otra parte. Mantén tu personalidad de forma consistente.
Responde con 1-3 frases conversacionales naturales. Sin etiquetas ni metacomentarios. Solo el texto.
Responde solo en español. / Respond only in English.
```

### System prompt (client mode — IA juega de vendedor)

```
Eres el vendedor/consultor en una simulación de conversación de venta.

Contexto: {context}
PERSONALIDAD: {SELLER_PROFILE_DESC[sellerProfile]}
[nota de windowing si historial > 12 turnos]

Tu papel es el vendedor. Mantén tu personalidad de forma consistente.
Responde con 1-3 frases conversacionales naturales. Sin etiquetas ni metacomentarios. Solo el texto.
```

`max_tokens=300` por turno.

---

### Arena: mensaje de apertura

Prompt one-shot (sin system message, un único user turn):

```
Genera el primer mensaje de un {cliente/prospecto | vendedor experto} que inicia o responde a
una conversación de venta. Contexto: {context}. Personalidad: {profile}.
Escribe 1-2 frases naturales como esa persona. Sin etiquetas. Solo el texto.
```

`max_tokens=150`.

---

### Arena: detección de estado terminal

Llamado condicionalmente (ver 05-arena-logic.md). Single user message, sin system prompt.

```
Analiza esta conversación de venta y determina si ha llegado a un estado terminal CLARO E INEQUÍVOCO.
Responde ÚNICAMENTE con una de estas palabras:
none | closed | next_step | lost | broken

Definiciones ESTRICTAS — en caso de duda responde none:
none = conversación abierta, en proceso, o ambigua
closed = cliente cerró explícitamente (dijo que compra, cuándo firma, cómo paga)
next_step = cliente COMPROMETIÓ un paso concreto: confirmó fecha de reunión, pidió contrato/propuesta,
            preguntó por formas de pago, confirmó disponibilidad para llamada concreta
            — NO vale solo "lo pensaré" ni "me parece bien"
lost = cliente rechazó DEFINITIVAMENTE, sin vuelta atrás
broken = ruptura total, corte de conversación

Conversación:
{últimos 6 turnos como VENDEDOR/CLIENTE: mensaje}

Responde solo con la palabra:
```

`max_tokens=5`, temperature=0.

---

### Arena: suggest

Genera el mensaje ideal para el usuario.

```
Eres coach de ventas. Basándote en esta conversación, genera el mensaje ideal
que debería enviar el vendedor ahora.

Contexto: {context}
Conversación (últimos {SUGGEST_MAX_TURNS} mensajes):
{transcript}

Responde SOLO con el mensaje exacto, sin explicaciones ni etiquetas.
```

`max_tokens=200`.

---

### Arena: debrief

Análisis de coaching post-sesión. Solo para sesiones de seller con al menos un turno del usuario.

```
Eres coach de ventas experto. Evalúa al vendedor con precisión y sin rodeos.

Contexto: {context}
Resultado: {outcome label}
[nota de windowing si turns > 15]

Conversación:
{transcript — últimos 15 turnos máx}

Responde SOLO con JSON válido:
{"score":<1-10>,"critique":["frase 1","frase 2","frase 3"]}

Reglas: score honesto pesando el resultado (cerrada contra cliente difícil → mínimo 7;
perdida → máximo 6). critique: exactamente 3 frases cortas accionables, imperativo
(Escucha, Controla, Adapta...), específicas a esta conversación.
```

`max_tokens=300`, temperature=0.4.

---

## Resumen de presupuesto de tokens

| Endpoint | max_tokens | Tokens de entrada aprox |
|----------|-----------|------------------------|
| copilot/analyze | 900 | ~700 (V2) / ~2100 (V1) |
| copilot/summarize (rápido) | 400 | ~300 |
| copilot/summarize (full) | 1600 | ~500 |
| copilot/context-label | 25 | ~60 |
| arena/opening | 150 | ~120 |
| arena/turn | 300 | ~200–600 (windowed) |
| arena/terminal-state | 5 | ~200 |
| arena/suggest | 200 | ~300 |
| arena/debrief | 300 | ~500 |


---

<!-- ============================================================ -->
<!-- ARCHIVO: 05-arena-logic.md -->
<!-- ============================================================ -->

# Closer Wizard — Arena Logic

Arena es un simulador de conversación de ventas donde el usuario practica vendiendo (o siendo vendido) contra una IA.

---

## Lifecycle de sesión

```
POST /api/arena/start
  └─ Crea ArenaSession en memoria del servidor
  └─ IA genera mensaje de apertura (max_tokens=150)
  └─ Devuelve { arenaSessionId, openingMessage }

Usuario envía mensaje → POST /api/arena/turn  (se repite)
  └─ Añade turno del usuario a session.turns
  └─ IA genera respuesta (max_tokens=300, historial con windowing)
  └─ Detección de estado terminal condicional (max_tokens=5)
  └─ Devuelve { aiMessage, terminalSignal }

Sesión termina (detectado o manual) → POST /api/arena/finish
  └─ Genera debrief si role=seller
  └─ Llama closeSession() en ai-tracker (mantiene stats 10 min)
  └─ Devuelve { turns, summary }
  └─ Sesión en memoria eliminada tras 5 min timeout
```

---

## Roles

| Rol del usuario | IA juega de |
|----------------|------------|
| `seller` | Cliente/prospecto — configurado con personalidad y dificultad |
| `client` | Vendedor/consultor — configurado con personalidad de vendedor |

En seller mode la IA juega de prospecto realista y la detección terminal está activa. En client mode la IA juega de consultor y la detección terminal está desactivada.

---

## Personalidades de cliente (`clientProfile`)

| Clave | Descripción |
|-------|-------------|
| `analytical` | Necesitas datos y evidencia antes de decidir. Haces preguntas técnicas. Los argumentos emocionales no convencen. |
| `emotional` | Decides por confianza y relación personal. Te influyen testimonios y la conexión con el vendedor. |
| `insecure` | Muchas dudas, miedo a equivocarte, necesitas validación constante. Postpones y buscas opiniones externas. |
| `dominant` | Tomas el control, interrumpes, marcas los tiempos. Necesitas sentir que tienes el poder. |
| `indecisive` | Cambias de opinión, dices "me lo pienso" repetidamente, difícil que te comprometas. |
| `hard_negotiator` | Presionas siempre en precio, pides descuentos agresivos, comparas con competencia, amenazas con no cerrar. |

---

## Personalidades de vendedor (`sellerProfile`)

| Clave | Descripción |
|-------|-------------|
| `communicative` | Construyes relación con anécdotas y ejemplos. A veces te extiendes demasiado. |
| `authoritative` | Directo, asertivo, controlas la conversación, rebates objeciones con firmeza. |
| `technical` | Hablas de características y datos con detalle. Preciso pero a veces poco emocional. |
| `passive` | Escuchas mucho, no presionas, esperas que el cliente llegue a sus conclusiones. |
| `aggressive` | Presionas para cerrar, creas urgencia, no aceptas "no" fácilmente. |
| `consultive` | Haces muchas preguntas, entiendes necesidades primero y adaptas tu solución. |

---

## Niveles de dificultad (`difficulty`)

| Clave | Comportamiento |
|-------|---------------|
| `easy` | Pocas objeciones, abierto a escuchar. |
| `normal` | Algunas objeciones válidas, necesitas buenos argumentos. |
| `hard` | Muchas objeciones, comparas con competencia, difícil de convencer. |
| `brutal` | Escéptico, cuestionas todo, objeciones fuertes, solo cedes ante argumentos muy sólidos. |

---

## History Windowing

Cuando `LEGACY_ARENA=false` (default):

- Solo los **últimos 12 turnos** de la conversación se envían a la IA por cada respuesta de turno.
- El system prompt incluye una nota explicando la longitud total de la conversación para mantener consistencia.
- El historial completo siempre se guarda en `session.turns` para la transcripción final y el debrief.
- `DEBRIEF_MAX_TURNS = 15` — el debrief solo analiza los últimos 15 turnos en sesiones largas.
- `SUGGEST_MAX_TURNS = 10` — suggest solo usa los últimos 10 turnos.

Cuando `LEGACY_ARENA=true`:
- Se envía el historial completo en cada turno. Sin windowing. Sin detección terminal condicional.

---

## Detección de estado terminal

La detección terminal es el mecanismo que identifica automáticamente cuándo una conversación de ventas ha llegado a un desenlace definitivo.

### Cuándo se ejecuta

La detección solo corre en **seller mode**. Un check se dispara si CUALQUIERA de:

1. `turns.length >= 4` Y se encuentra una **keyword** en el último mensaje de la IA
2. `turns.length >= 6` Y `turns.length % 3 === 0` (safety net cada 3 turnos tras el turno 6)

Esta es la función `shouldCheckTerminal()`. Si ninguna condición se cumple, la detección se omite completamente (ahorra una llamada API).

### Keywords que disparan detección (Español)

```
trato hecho, cerramos, firmamos, me lo quedo, me apunto, lo compro,
cuándo firmo, cuándo firma, voy a pagar, pago con, con tarjeta, bizum,
mándame el contrato, mándame la propuesta, cuando quieras empezamos,
no me interesa en absoluto, definitivamente no, no voy a comprar,
no quiero saber más, hasta aquí, no seguimos, adiós, hasta luego
```

### Keywords que disparan detección (Inglés)

```
deal, let's close, i'll take it, i'll buy, send me the contract,
when do i sign, i'll pay with, by card, send the proposal,
not interested at all, definitely not, won't buy, stop here, goodbye, bye
```

**Excluidos intencionalmente:** Frases amplias como "de acuerdo", "siguiente paso", "cuándo podemos" NO disparan detección porque aparecen frecuentemente en conversación normal.

### Prompt de detección

Envía los últimos 6 turnos al modelo y pide exactamente una palabra: `none | closed | next_step | lost | broken`.

**Definiciones de outcome (estrictas):**
- `none` — conversación abierta o ambigua (default ante la duda)
- `closed` — cliente se comprometió explícitamente a comprar (dijo que compra, preguntó cuándo firma, preguntó cómo pagar)
- `next_step` — cliente comprometió una acción **concreta**: confirmó fecha de reunión, pidió contrato/propuesta, preguntó por formas de pago — "lo pensaré" NO cuenta
- `lost` — cliente rechazó definitivamente, sin vuelta atrás
- `broken` — ruptura total, cliente cortó la conversación

### Fallback

Si la llamada API falla o devuelve un valor inesperado, el resultado es `"none"`.

---

## Feature de Suggest

El botón ✨ en seller mode llama a `POST /api/arena/suggest`. La sugerencia devuelta:

1. Se muestra al usuario brevemente
2. Se envía automáticamente como turno del usuario (llama a `POST /api/arena/turn`)

Esto significa que suggest cuenta como dos llamadas API — una para la sugerencia y otra para la respuesta de la IA a ella.

---

## Debrief

Generado al final de sesión para sesiones de seller con al menos un turno del usuario.

- Score: 1–10 (honesto, ponderado por resultado — cerrada contra cliente difícil → mín 7; perdida → máx 6)
- Critique: exactamente 3 frases cortas accionables en imperativo, específicas a esta conversación

El debrief se muestra en la pantalla post-sesión de Arena y se incluye en el audit log.

---

## Limpieza de sesión

| Evento | Qué pasa |
|--------|---------|
| `POST /api/arena/finish` llamado | `closeSession()` llamado en ai-tracker |
| 5 minutos tras finish | Entrada en Map de sesiones Arena eliminada |
| 10 minutos tras `closeSession()` | Resumen de sesión en ai-tracker eliminado |
| Restart del servidor | Todas las sesiones perdidas (solo en memoria) |


---

<!-- ============================================================ -->
<!-- ARCHIVO: 06-ai-tracking.md -->
<!-- ============================================================ -->

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


---

<!-- ============================================================ -->
<!-- ARCHIVO: 07-audit-log.md -->
<!-- ============================================================ -->

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


---

<!-- ============================================================ -->
<!-- ARCHIVO: 08-debug-panel.md -->
<!-- ============================================================ -->

# Closer Wizard — Debug Panel

`artifacts/silent-closer/src/components/debug-panel.tsx`

El debug panel es un overlay para developers que muestra estadísticas de uso de IA en tiempo real. Siempre se renderiza en los 3 return paths de `copilot.tsx` y en la página `arena.tsx`.

---

## Layout

```
┌─────────────────────────────────────────────┐
│ [●] DEBUG  [!] CARA  ◐ LATENCIA ALTA   [X] │  ← fila de header
├─────────────────────────────────────────────┤
│ ESTA SESIÓN                                  │
│ $0.0042  1 820tok  12 llamadas  834ms avg   │  ← KPIs
├─────────────────────────────────────────────┤
│ GLOBAL DESDE INICIO                          │
│ $0.018  total tok: 65k  llamadas: 47        │
│ Top ruta: copilot/analyze ($0.014)           │
├─────────────────────────────────────────────┤
│ [Ver detalle ▾]                              │  ← colapsable
│   Filtrar: Todos Copilot Arena               │
│   [Sesiones] [Rutas] [Llamadas]              │
│   ... filas de tabla ...                     │
└─────────────────────────────────────────────┘
```

---

## Sistema de alertas

El panel calcula un nivel de alerta a partir de las stats de sesión. Paleta colorblind-safe (sin rojo para información importante).

| Nivel | Condición | Color |
|-------|-----------|-------|
| `LATENCIA ALTA` | `avgLatencyMs > 2000ms` | sky-400 |
| `CARA` | `totalCostUsd > $0.05` | amber-300 |
| `VIGILAR` | coste > $0.015 O latencia > 1400ms O llamadas > 25 | amber-400 |
| `NORMAL` | Ninguna de las anteriores | zinc-500 |

Los niveles de alerta se evalúan en orden de prioridad: LATENCIA ALTA → CARA → VIGILAR → NORMAL.

El nivel de alerta activo se muestra en el header del panel junto al título.

---

## Badge de ruta dominante

Si una ruta representa más del 70% del gasto total de la sesión, se muestra un badge: e.g. `copilot/analyze (>70%)`.

---

## Pin / Unpin

- **Sin pin (default):** Un backdrop semitransparente cubre la UI; el panel es un overlay fijo. El usuario debe interactuar con el panel o cerrarlo para usar la app.
- **Con pin:** Sin backdrop. El panel permanece visible pero los clicks pasan a través a la app subyacente. El estado de pin se guarda en `localStorage` (`cwiz-debug-pinned`).

Pin/unpin usa un botón de icono Pin / PinOff en el header del panel.

---

## Persistencia (localStorage)

| Clave | Valor |
|-------|-------|
| `cwiz-debug-pinned` | `"true"` o `"false"` |
| `cwiz-debug-open` | `"true"` o `"false"` |
| `cwiz-debug-detail` | `"true"` o `"false"` (estado del acordeón de detalle) |

---

## Acordeón de detalle

Se activa con "Ver detalle" / "Ocultar detalle". Contiene tres tabs:

### Filtro de modo

Todas las llamadas se pueden filtrar por modo: `Todos` / `Copilot` / `Arena`.

### Tabs

**Sesiones** — tabla de resúmenes de sesión (coste, tokens, llamadas, latencia avg, hora de última llamada)  
**Rutas** — tabla de agregados por ruta (llamadas, tokens totales, coste total, latencia avg, tokens in/out avg)  
**Llamadas** — últimas 50 llamadas IA individuales del ring buffer (ruta, endpoint, tokens in/out, coste, latencia, status)

---

## Fuente de datos

El panel consulta `GET /api/debug/usage` cada **5 segundos** cuando está abierto. El polling se gestiona con `setInterval` y se limpia al desmontar o cuando el panel se cierra.

Las stats de sesión mostradas en el bloque "ESTA SESIÓN" vienen del `sessionId` actual en el array `sessions` del snapshot.

---

## Z-Index

| Elemento | z-index |
|----------|---------|
| Backdrop (sin pin) | z-49 |
| Panel | z-50 |

---

## Activación

El debug panel no tiene un botón visible en uso normal. Se abre mediante un atajo de teclado o mecanismo interno de dev (específico de la implementación). Una vez abierto, se cierra con el botón `[X]`.


---

<!-- ============================================================ -->
<!-- ARCHIVO: 09-feature-flags.md -->
<!-- ============================================================ -->

# Closer Wizard — Feature Flags

Los feature flags se establecen como variables de entorno en el proceso del API server. Tienen valores optimizados para producción cuando no están definidos.

---

## `LEGACY_PROMPTS`

**Default:** `false` (prompt V2 optimizado)

| Valor | Comportamiento |
|-------|---------------|
| sin definir / `"false"` | Prompt de copiloto V2 (~700 tokens de entrada, compacto, estructurado) |
| `"true"` | Prompt de copiloto V1 (~2100 tokens de entrada, verboso, con ejemplos) |

El prompt V1 es funcionalmente equivalente al V2 pero cuesta ~3× más por llamada de analyze. Usar V1 solo para depurar regresiones de prompt o cuando el prompt V2 produce output incorrecto.

**Impacto:** Solo afecta a `POST /api/copilot/analyze`. Sin efecto en summarize, context-label, o rutas de Arena.

---

## `LEGACY_ARENA`

**Default:** `false` (arena optimizada)

| Valor | Comportamiento |
|-------|---------------|
| sin definir / `"false"` | Historial con windowing (últimos 12 turnos), detección terminal condicional |
| `"true"` | Historial completo en cada turno, detección terminal en cada turno tras el 4 |

### Modo optimizado (default)

- Ventana de historial: solo los **últimos 12 turnos** se envían al modelo por respuesta de turno
- Detección de estado terminal: solo corre en keyword match O cada 3 turnos tras el turno 6
- Transcripción del debrief: limitada a los últimos 15 turnos
- Transcripción del suggest: limitada a los últimos 10 turnos

### Modo legacy

- Array `session.turns` completo enviado en cada petición
- Detección terminal en cada turno (≥ turno 4), independientemente de keywords
- Sin límites de transcripción para debrief o suggest

Usar `LEGACY_ARENA=true` para depurar problemas de consistencia de la IA en sesiones muy largas, o para comparar gasto de tokens contra el modo optimizado.

**Impacto:** Afecta a `POST /api/arena/turn`, `POST /api/arena/suggest`, y `POST /api/arena/finish`.

---

## Cómo establecer los flags

En desarrollo, establecerlos en la shell antes de arrancar el API server:

```bash
LEGACY_PROMPTS=true pnpm --filter @workspace/api-server run dev
LEGACY_ARENA=true pnpm --filter @workspace/api-server run dev
```

O via las environment variables / secrets de Replit en el API server.

---

## Comparativa de coste

| Modo | Coste por llamada analyze (aprox) | Coste por turno Arena (aprox) |
|------|----------------------------------|------------------------------|
| Optimizado (default) | ~$0.00037 | ~$0.00025 (windowed) |
| Legacy | ~$0.00110 | ~$0.00040+ (historial completo) |

Números aproximados con precios de gpt-4o-mini asumiendo longitudes de conversación medias.


---

<!-- ============================================================ -->
<!-- ARCHIVO: 10-replit-prompt-style.md -->
<!-- ============================================================ -->

# 10 — Cómo escribir prompts para Replit AI (Closer Wizard Brain)

---

## Principio rector

**Pide cambios implementables, no teoría.**
Un buen prompt produce código real, modificaciones concretas y criterios verificables.
Un prompt malo produce explicaciones, opciones y preguntas de vuelta.

---

## Reglas base

1. **Cambio pequeño y limpio** — si basta con editar una función, no pidas refactorizar el módulo entero.
2. **No romper lo que funciona** — cualquier modificación debe preservar el comportamiento existente salvo que el prompt lo contradiga explícitamente.
3. **Sin humo** — nada de "mejora la UX", "optimiza la arquitectura" ni "sigue las buenas prácticas". Describe el cambio exacto.
4. **Estado actual primero** — el prompt debe asumir que la app funciona hoy. El agente no debe reescribir desde cero.
5. **Un objetivo por prompt** — si tienes dos cambios independientes, son dos prompts.

---

## Estructura obligatoria de cada prompt

```
## OBJETIVO
Una frase. Qué debe cambiar y por qué.

## CONTEXTO
Qué existe hoy. Archivos relevantes. Comportamiento actual.

## RESTRICCIONES
Qué NO debe tocarse. Qué comportamiento debe conservarse.

## ENTREGABLES
Qué archivos se modifican y qué debe verse diferente al terminar.

## CRITERIOS DE ACEPTACIÓN
Lista de condiciones verificables. El agente puede marcar cada una como ✓ o ✗.
```

---

## Plantilla de prompt completo

```
## OBJETIVO
[Una línea: qué cambia exactamente]

## CONTEXTO
- Archivo principal: [ruta]
- Comportamiento actual: [descripción breve]
- Datos relevantes: [interfaces, props, rutas API, etc.]

## RESTRICCIONES
- No modificar: [lista de archivos o funciones intocables]
- Conservar: [comportamiento existente que debe mantenerse]
- No instalar dependencias nuevas salvo que sea estrictamente necesario

## ENTREGABLES
- [ ] Archivo modificado: [ruta]
- [ ] Cambio visible: [descripción de qué se ve diferente]

## CRITERIOS DE ACEPTACIÓN
- [ ] [condición verificable 1]
- [ ] [condición verificable 2]
- [ ] La app compila sin errores
- [ ] No hay regresión en [funcionalidad adyacente]
```

---

## Cómo pedir refactors seguros

**Mal:**
> Refactoriza el módulo de arena para que sea más mantenible.

**Bien:**
```
## OBJETIVO
Extraer la función `shouldCheckTerminal` de arena.ts a un archivo separado
`lib/terminal-detector.ts` para facilitar su testing independiente.

## CONTEXTO
- Función actual en: artifacts/api-server/src/routes/arena.ts, líneas ~94–101
- La función recibe (turns, lang) y devuelve boolean
- No tiene dependencias externas

## RESTRICCIONES
- El comportamiento de la función NO cambia
- arena.ts importa desde el nuevo archivo; nada más cambia en arena.ts
- No tocar nada en el frontend

## ENTREGABLES
- [ ] artifacts/api-server/src/lib/terminal-detector.ts (función extraída)
- [ ] artifacts/api-server/src/routes/arena.ts (import actualizado)

## CRITERIOS DE ACEPTACIÓN
- [ ] arena.ts importa shouldCheckTerminal desde ../lib/terminal-detector
- [ ] La lógica de la función es byte-a-byte idéntica a la original
- [ ] El servidor arranca sin errores
```

---

## Cómo pedir optimizaciones sin degradación

**Mal:**
> Optimiza el rendimiento del copiloto.

**Bien:**
```
## OBJETIVO
Reducir el tamaño del prompt enviado a /api/copilot/analyze cuando callMemory
está vacío, eliminando el bloque de memoria del system prompt en ese caso.

## CONTEXTO
- Archivo: artifacts/api-server/src/routes/copilot.ts
- El system prompt incluye siempre un bloque "Memoria actual:" aunque esté vacío
- callMemory vacío → el bloque ocupa ~20 tokens innecesarios

## RESTRICCIONES
- Cuando callMemory tiene ítems, el bloque se incluye igual que ahora
- El output JSON del modelo no cambia
- No tocar el prompt V1 (LEGACY_PROMPTS=true)

## ENTREGABLES
- [ ] artifacts/api-server/src/routes/copilot.ts modificado

## CRITERIOS DE ACEPTACIÓN
- [ ] Con callMemory=[], el system prompt no incluye el bloque de memoria
- [ ] Con callMemory=["ítem"], el sistema funciona igual que antes
- [ ] Los tests manuales de /api/copilot/analyze devuelven JSON válido en ambos casos
```

---

## Cómo pedir limpieza de código sin destrucción

**Mal:**
> Limpia y mejora el código del debug panel.

**Bien:**
```
## OBJETIVO
Eliminar los console.log de debug que quedaron en debug-panel.tsx.

## CONTEXTO
- Archivo: artifacts/silent-closer/src/components/debug-panel.tsx
- Hay varios console.log(...) que se usaron durante desarrollo
- No aportan valor en producción

## RESTRICCIONES
- Solo eliminar console.log — no cambiar ninguna lógica
- No reformatear el archivo entero
- No tocar comentarios ni tipos

## ENTREGABLES
- [ ] artifacts/silent-closer/src/components/debug-panel.tsx sin console.log

## CRITERIOS DE ACEPTACIÓN
- [ ] grep "console.log" en debug-panel.tsx devuelve 0 resultados
- [ ] El panel sigue funcionando igual (pin, alertas, tabs, polling)
```

---

## Señales de un prompt malo

| Señal | Problema |
|-------|---------|
| "Mejora la experiencia de usuario" | Sin criterio verificable |
| "Sigue las mejores prácticas" | Ambiguo, subjetivo |
| "Refactoriza todo X" | Scope demasiado grande |
| Sin mencionar archivos concretos | El agente tiene que adivinar el contexto |
| Sin criterios de aceptación | No se puede saber si terminó bien |
| "Hazlo más rápido / más limpio / mejor" | No es implementable sin una métrica concreta |

---

## Señales de un prompt bueno

- Menciona el archivo y la función exacta a cambiar
- Define qué NO debe cambiar
- Los criterios de aceptación son verificables con grep, un test o cargando la app
- El objetivo cabe en una frase
- No hay adjetivos de calidad sin métrica (rápido, limpio, mejor, robusto)


---

<!-- ============================================================ -->
<!-- ARCHIVO: 11-sales-references.md -->
<!-- ============================================================ -->

# 11 — Referencias de Venta y Cierre (Base Interna Closer Wizard)

Documento de referencia práctica para auditar conversaciones, mejorar prompts y diseñar mejores respuestas dentro de Closer Wizard. Sin motivación vacía ni teoría abstracta.

---

## A. Principios generales de venta

### Control de la conversación

El vendedor que pierde el control de la conversación no cierra. Control no significa hablar más — significa determinar el ritmo, la dirección y los criterios de decisión.

- **Quien hace las preguntas controla.** El comprador que pregunta todo el rato está evaluando; el vendedor debe redirigir hacia necesidades, no solo responder.
- **No sigas el hilo del comprador a ciegas.** Si el comprador salta a precio antes de entender el valor, el vendedor debe pausar y reencuadrar.
- **Las interrupciones no son siempre malas.** Un comprador dominante que interrumpe puede estar probando si el vendedor tiene criterio o si cede.

### Descubrimiento de criterio

Antes de presentar una solución, hay que saber **qué criterios usa el comprador para decidir**. Sin eso, cualquier argumento es a ciegas.

- Preguntar qué han intentado antes y por qué no funcionó.
- Preguntar qué sería un éxito para ellos en 6 meses.
- Preguntar quién más está involucrado en la decisión.
- Si no hay criterio claro, el precio siempre gana por defecto.

### Manejo de objeciones

Una objeción no es un rechazo. Es una señal de interés incompleto o información que falta.

Estructura básica para cualquier objeción:
1. **Escuchar sin interrumpir** (la mayoría de vendedores rebaten antes de entender)
2. **Validar** ("tiene sentido que te preocupe eso")
3. **Explorar** ("¿qué te llevaría a sentirte más cómodo con eso?")
4. **Responder con evidencia, no con argumento**

Las objeciones que se ignoran o se atropellan vuelven más tarde más fuertes.

### No comparar demasiado pronto

Comparar con la competencia antes de establecer valor propio es un error. Coloca el producto en un marco de coste en lugar de un marco de resultado.

- Dejar que el comprador mencione la competencia primero.
- Si la menciona, preguntar qué les gusta de ella antes de contraatacar.
- No devaluar al competidor — devalúa al vendedor.

### No cerrar demasiado pronto

Cerrar sin señales claras de avance crea resistencia. El comprador que aún no ha comprado mentalmente percibe el cierre como presión, no como ayuda.

Señales de que **aún no toca cerrar:**
- El comprador sigue haciendo preguntas básicas de producto
- No ha mencionado su situación actual ni sus consecuencias
- No ha dicho nada que indique que el problema le duele
- El precio no se ha discutido en contexto de valor

### Cuándo usar prueba social

La prueba social reduce el riesgo percibido. Funciona especialmente con compradores indecisos y aversos al riesgo.

- Usarla **después** de identificar la necesidad, no como presentación inicial.
- Casos concretos y específicos son más creíbles que afirmaciones generales.
- "El 90% de nuestros clientes..." no convence. "Una empresa como la tuya en X sector redujo Y en Z semanas" sí.

### Detectar resistencia temprana

| Señal | Qué indica |
|-------|-----------|
| Respuestas muy cortas | Desinterés o desconfianza |
| "Ya lo veremos" / "Me lo pienso" | No hay urgencia real todavía |
| Preguntas solo sobre precio | No ve el valor diferencial |
| Comparación inmediata con competencia | Está evaluando sin haber decidido comprar |
| Silencio tras una propuesta | Puede ser positivo (procesando) o negativo (rechazo no verbalizado) |
| Habla mucho pero no se compromete | Indecisión o miedo a equivocarse |

### Cuándo apretar y cuándo no

**Apretar tiene sentido cuando:**
- El comprador ya mostró interés claro pero evita decidir
- El problema es real y tiene consecuencias si no actúa
- El comprador ha dicho que le gusta pero "necesita pensarlo" sin razón específica

**No apretar cuando:**
- El comprador genuinamente tiene que consultar con alguien
- La objeción no se ha resuelto — apretar sin resolverla solo cierra la conversación
- La resistencia viene de desconfianza, no de indecisión

---

## B. Perfiles de comprador

### Analítico

**Qué valora:** Datos, estructura, lógica, proceso. Quiere entender cómo funciona antes de confiar.  
**Qué le frena:** Afirmaciones sin evidencia, vendedores que generalizan, ritmo demasiado rápido.  
**Errores del vendedor:** Hablar de beneficios emocionales, presionar para cerrar antes de dar tiempo a evaluar, no tener respuestas técnicas.  
**Approach:** Ir al detalle cuando pregunta. Dar números reales. No apurar. Dejar espacio para que procese. Si hay un caso de estudio con métricas, usarlo.

### Emocional

**Qué valora:** Confianza personal, historia, relación. Compra al vendedor antes que al producto.  
**Qué le frena:** Vendedores fríos o excesivamente técnicos, falta de empatía, sensación de estar siendo "manejado".  
**Errores del vendedor:** Ir directo a características, no conectar primero, ignorar cómo se siente.  
**Approach:** Construir relación antes de vender. Usar historias de clientes reales. Ser auténtico. Si el vendedor no conecta, no hay venta posible.

### Escéptico

**Qué valora:** Coherencia entre lo que se dice y lo que se demuestra. Desconfía por defecto.  
**Qué le frena:** Promesas que suenan exageradas, testimonios genéricos, vendedores que parecen demasiado ansiosos por cerrar.  
**Errores del vendedor:** Exagerar, prometer sin demostrar, ponerse a la defensiva ante sus preguntas.  
**Approach:** Asumir el escepticismo como normal y legítimo. Ofrecer evidencia antes de que la pida. Ser más conservador en las promesas. Si hay garantía o prueba sin riesgo, usarla.

### Averso al riesgo

**Qué valora:** Seguridad, reversibilidad, validación externa. No quiere equivocarse.  
**Qué le frena:** Presión, urgencia artificial, falta de referencias, contratos complejos.  
**Errores del vendedor:** Crear urgencia cuando no existe de verdad, no ofrecer ningún tipo de red de seguridad, cerrar demasiado rápido.  
**Approach:** Reducir el riesgo percibido. Ofrecer próximos pasos pequeños. Usar casos de éxito de empresas similares. Si hay periodo de prueba o garantía, mencionarlo pronto.

### Indeciso

**Qué valora:** Que alguien le ayude a decidir sin sentir que le presionan.  
**Qué le frena:** Demasiadas opciones, falta de claridad, no saber qué pasa si se equivoca.  
**Errores del vendedor:** Dar más opciones de las necesarias, no recomendar claramente, dejarlo solo con la decisión.  
**Approach:** Reducir las opciones a una o dos. Hacer una recomendación directa. Guiar hacia el siguiente paso concreto y pequeño. No pedir el compromiso grande de golpe.

### Dominante

**Qué valora:** Control, tiempo, eficiencia. No le gusta que le vendan — quiere decidir él.  
**Qué le frena:** Vendedores que hablan demasiado, que no van al grano, que parecen débiles o sumisos.  
**Errores del vendedor:** Ser excesivamente complaciente, no tener criterio propio, no ir al punto.  
**Approach:** Ser directo. Ir al grano. Tener una postura clara y no ceder sin razón. Si interrumpe, dejarlo hablar y retomar el control con una pregunta. El que cede todo pierde credibilidad.

---

## C. Objeciones y lógica de respuesta

### Precio

El comprador dice: *"Es demasiado caro"* o *"tengo opciones más baratas"*

**Lógica útil:**
- Precio sin valor de referencia siempre parece alto. El trabajo es reencuadrar el coste en términos de lo que cuesta NO resolver el problema.
- Si el comprador compara con una opción más barata, preguntar qué incluye esa opción y qué no.
- No bajar el precio antes de explorar si el problema de precio es real o es una señal de falta de valor percibido.
- "¿Qué tendría que ser verdad para que esto tuviera sentido para ti?" es más útil que defender el precio.

### Desconfianza

El comprador dice: *"No te conozco"* / *"¿Cómo sé que esto funciona?"*

**Lógica útil:**
- La desconfianza no se combate con argumentos — se combate con evidencia y consistencia.
- Casos específicos de clientes reales con resultados concretos.
- No prometer demasiado. Las promesas exageradas aumentan la desconfianza.
- Si hay garantía, mencionarla sin venderla en exceso.

### Timing

El comprador dice: *"Ahora no es buen momento"*

**Lógica útil:**
- Explorar si el timing es real o es una señal de que el valor no está claro todavía.
- Si es real, acordar un punto de contacto futuro concreto (fecha, condición).
- Si el problema que resuelves tiene un coste de no actuar, mencionarlo sin presionar.
- "¿Qué tendría que cambiar para que sí fuera buen momento?" revela si el bloqueo es timing o algo más.

### Miedo a equivocarse

El comprador dice: *"Necesito pensarlo"* / *"No quiero lanzarme sin estar seguro"*

**Lógica útil:**
- Este es el bloqueo más común y el más subestimado.
- La raíz suele ser: han tomado malas decisiones antes, están en una posición visible y no quieren fallar, o el cambio implica un coste interno (explicar a otros, gestionar la transición).
- Reducir el tamaño del primer paso. El compromiso no tiene que ser todo o nada.
- Validar que el miedo es razonable y luego ayudar a ver qué pasa en el peor caso.

### Comparación con otra alternativa

El comprador dice: *"Estoy viendo otras opciones"*

**Lógica útil:**
- Normal y esperado. No tratar como amenaza.
- Preguntar qué valoran de las otras opciones — da información sobre sus criterios reales.
- No atacar al competidor. Clarificar en qué se diferencia sin exagerar.
- Si la otra opción es más barata, volver al marco de valor, no al de precio.

### Falta de urgencia

El comprador muestra interés pero no avanza.

**Lógica útil:**
- Sin urgencia real, no hay cierre. La urgencia se descubre, no se inventa.
- Preguntar qué pasa si no resuelven el problema en los próximos 3 meses.
- Si el problema no duele suficiente, el comprador no actuará. Esa es información útil.
- La urgencia artificial ("oferta solo hasta mañana") destruye credibilidad con compradores analíticos y escépticos.

### Falta de prueba

El comprador dice: *"¿Puedo ver algo antes de decidir?"*

**Lógica útil:**
- Señal positiva — quiere convencerse, no está rechazando.
- Ofrecer el mínimo de prueba que reduce el riesgo sin retrasar indefinidamente.
- Demo, caso de estudio, periodo de prueba, acceso limitado — lo que aplique.
- Si no hay forma de demostrar, ser honesto. Los compradores inteligentes lo detectan.

### Indecisión

El comprador sigue dando vueltas sin decidir.

**Lógica útil:**
- Hacer una recomendación directa: "Dado lo que me has contado, mi recomendación es X."
- Preguntar qué falta para poder decidir hoy.
- A veces la indecisión es una señal de que hay un criterio oculto que no se ha explorado.
- Si el comprador no puede decidir solo, preguntar quién más está involucrado.

---

## D. Cierre

### Señales de que aún no toca cerrar

- El comprador sigue preguntando cosas básicas de producto o servicio
- No ha reconocido su problema en voz alta
- No ha mostrado ningún criterio de decisión
- Hay preguntas sin respuesta que él mismo planteó
- La conversación está en modo "exploración", no en modo "¿cómo avanzamos?"

### Señales de que ya sí toca avanzar

- El comprador habla en futuro ("cuando lo tengamos..." / "¿cuánto tiempo tarda en...?")
- Pregunta por logística o por el siguiente paso de forma espontánea
- Vuelve sobre beneficios que mencionaste antes
- El tono cambia — de evaluación a planificación
- Silencio largo después de una propuesta clara (señal de consideración real)

### Diferencia entre outcomes (integración con Closer Wizard)

| Outcome | Qué significa realmente |
|---------|------------------------|
| `closed` | El comprador se comprometió a comprar de forma explícita — dijo que sí, pidió contrato, habló de pago |
| `next_step` | El comprador se comprometió a una acción concreta: fecha de reunión, pedir propuesta, confirmar disponibilidad. No vale "lo pensaré" |
| `lost` | Rechazo definitivo y explícito. Sin vuelta atrás |
| `open / unclear` | Conversación activa o ambigua. No asumir que es perdida ni que está ganada |

### Errores típicos de cierre prematuro

- Pedir el compromiso antes de resolver la objeción principal
- Interpretar interés como decisión ("parecía que sí pero luego no")
- Crear urgencia artificial cuando el comprador no la percibe
- Lanzar el precio antes de que el comprador entienda el valor
- Pedir "¿lo hacemos?" cuando el comprador aún está evaluando

### Errores típicos de vendedor blando

- Ceder ante la primera objeción sin explorarla
- No hacer recomendación directa cuando el comprador la necesita
- Dejar al comprador en el aire sin un siguiente paso claro
- Aceptar "me lo pienso" sin acordar una fecha de seguimiento
- No volver a la conversación cuando el comprador deja de responder
- Hablar demasiado para llenar silencios que deberían dejarse

---

## E. Marcos externos útiles (referencias de alto nivel)

Resúmenes de estilos de venta relevantes, sin copiar contenido propietario.

### Venta consultiva
Primero entender, luego recomendar. El vendedor actúa como advisor. Muchas preguntas, poco pitch. Funciona bien con compradores analíticos y con ciclos de venta largos. Riesgo: puede volverse lento y no empujar cuando toca.

### Venta directa / asertiva
Directo al punto, recomendación clara, poca tolerancia al "ya veremos". Funciona con compradores dominantes y en ciclos cortos. Riesgo: quema compradores emocionales o aversos al riesgo si se aplica sin matiz.

### Control de marco (framing)
El que define el contexto de la conversación controla la evaluación. Si el comprador define el marco como "coste", el vendedor pierde. Reencuadrar hacia "inversión" o "coste de no actuar" cambia la dinámica. Requiere habilidad para hacerlo sin parecer manipulador.

### Influencia y reducción de riesgo
Basado en principios psicológicos documentados (reciprocidad, prueba social, autoridad, escasez, compromiso progresivo). Útil para diseñar la secuencia de una conversación. La escasez falsa destruye credibilidad con compradores inteligentes — usarla solo si es real.

### Urgencia construida vs urgencia inventada
La urgencia real viene del coste de no actuar (el problema empeora, la ventana se cierra, el coste sube). La urgencia inventada ("solo hasta hoy") funciona con compradores impulsivos pero destruye la relación con analíticos y escépticos. Closer Wizard debe ayudar a detectar y articular urgencia real, no fabricarla.

---

## F. Aplicación a Closer Wizard

### Para auditar logs de conversación

Usar este documento para evaluar si el vendedor:
- Tuvo control de la conversación o la perdió ante el comprador
- Hizo preguntas de descubrimiento o fue directo a pitch
- Respondió objeciones con evidencia o con argumento
- Detectó señales de resistencia temprana y las gestionó
- Cerró cuando tocaba o cerró demasiado pronto / demasiado tarde
- Identificó el perfil del comprador y adaptó el approach

### Para mejorar prompts del sistema

- El prompt de `copilot/analyze` puede mejorar si el `signal` diferencia entre resistencia, indecisión, interés oculto y cierre próximo.
- El campo `momentum` (green/amber/red) debería reflejar no solo el tono sino si el comprador está en modo evaluación, consideración o decisión.
- El campo `say_now` puede ser más preciso si el sistema entiende en qué fase de la conversación está el vendedor.

### Para mejorar Arena

- Los perfiles de cliente de Arena (analítico, emocional, inseguro, etc.) ya están alineados con esta taxonomía. Este documento sirve para calibrar si se comportan de forma consistente.
- El `difficulty` del cliente debería traducirse en patrones de objeción concretos, no solo en "más resistencia genérica".
- El debrief post-sesión puede usar estos principios para critique específica: "cerró demasiado pronto antes de resolver la objeción de precio" es más útil que "podría haber manejado mejor las objeciones".

### Para detectar si el vendedor estuvo flojo o si el sistema se quedó corto

| Señal en el log | Causa probable |
|----------------|---------------|
| Momentum cayó de green a red en 2 turnos | Objeción no gestionada o cierre prematuro |
| `say_now` repetido 3+ veces | El sistema no detectó cambio de fase — problema de prompt |
| Outcome `lost` con pocos turnos | El vendedor no exploró suficiente o el comprador nunca tuvo intención real |
| Outcome `unclear` con muchos turnos | Indecisión del comprador o vendedor blando sin siguiente paso |
| Score bajo + outcome `closed` | El cierre fue a pesar del vendedor, no gracias a él — cliente con alta intención inicial |
| Score alto + outcome `lost` | El vendedor hizo bien su trabajo pero el comprador tenía un bloqueo real (presupuesto, timing) |


---
