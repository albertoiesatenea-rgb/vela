# VELA — AI Prompts

Los prompts de análisis principal usan **gpt-4o**. Los prompts auxiliares usan **gpt-4o-mini**.

Fuente de verdad de doctrina comercial: `lib/sales-brain/src/index.ts`.

---

## Prompts de Copiloto

### analyze — V2 (Default)

**Modelo:** `gpt-4o` (ANALYZE_MODEL)  
**max_tokens:** `900`, `temperature=0.4`

**System prompt (estructura real):**
```
${MASTER_SELLER_BRAIN[lang]}   ← MODO:CONSEJERO

MODO: CONSEJERO
Tu misión: analizar el fragmento de conversación y devolver coaching táctico accionable.
Contexto de la sesión: ${context}
${bloque CONTEXTO ESTRUCTURADO si structured_context existe}
${bloque OBJECTION_TAXONOMY_BLOCK[lang]}  ← etiquetas de clasificación de señal

${bloque MEMORIA si call_memory existe}

Responde SOLO con JSON válido (sin markdown):
{
  "signal": "<etiqueta corta, 2-5 palabras>",
  "say_now": "<frase exacta a decir ahora, 4-12 palabras, first person>",
  "avoid": "<qué evitar o null>",
  "detail": {
    "reading": "...",
    "mission": "...",
    "next_move": "...",
    "support": "..."
  },
  "journey": { "past": "...", "now": "...", "next": "..." },
  "call_memory": { "summary_lines": ["<4-6 ítems actualizados>"] },
  "momentum": "red | amber | green"
}
```

**User message (si conversation_history presente):**
```
HISTORIAL DE CONVERSACIÓN:
${conversation_history.join("\n")}
```

**User message (fallback sin conversation_history):**
```
MEMORIA ACUMULADA:
${call_memory}

FRAGMENTO:
${fullText}    ← speaker prefix + text
```

**Nota sobre conversation_history:** Frontend envía las últimas 16 entradas. Si hay más de 20 en total, prepend `[Resumen: N intercambios anteriores]`. El fragmento actual se incluye como la última línea del historial.

### analyze — V1 (Legacy, ~2100 tokens de entrada)

Activado con `LEGACY_PROMPTS=true`. Más verboso, incluye ejemplos extensos. Output funcionalmente equivalente. Solo para debug de regresiones.

---

### summarize

**Modelo:** `gpt-4o-mini`  
**max_tokens:** `400` (resumen) o `1600` (full report)  
**temperature:** `0.3`

**System prompt:**
```
Eres un coach de ventas evaluando una llamada comercial.
${bloque de speaker_uncertainty si high}
Contexto: ${context}
Resultado declarado: ${outcome}
Idioma: ${lang}

Evalúa con rigor. No inflés la nota. Si el resultado fue positivo pero la ejecución fue débil, refléjalo.

Responde SOLO con JSON:
{
  "score": <0-10>,
  "global_state": "<estado global breve>",
  "result_label": "<etiqueta de resultado>",
  "strengths": ["...", "..."],
  "improvements": ["...", "..."]
  ${si full_report}: , "full_report": "<análisis narrativo 3-5 párrafos>"
}
```

**User message:**
```
Memoria de llamada:
${call_memory.join("\n")}
```

---

### audit-report (copiloto)

**Modelo:** `gpt-4o-mini`  
Prompt de auditoría forense post-sesión con `session_summary`, `audit_hints_pack`, `closing_excerpt` y `human_notes`. Estructura exacta: ver implementación en `copilot.ts`.

---

### context-label

**Modelo:** `gpt-4o-mini`  
**max_tokens:** `25`, `temperature=0`

```
Genera un título de escena de 4-6 palabras para este contexto de llamada de ventas.
Contexto: ${context}
Idioma: ${lang}
Responde solo con el título, sin puntuación final.
```

---

## Prompts de Arena

### preset-context

**Modelo:** `gpt-4o-mini`  
**max_tokens:** `65` (standard), `120` (immvest), `temperature=0.95`

Genera un escenario de 1-3 frases en español o inglés para el preset y rol dados.

---

### adapt-context

**Modelo:** `gpt-4o-mini`  
**max_tokens:** `150`, `temperature=0.2`

Reescribe el contexto para la perspectiva del rol opuesto preservando los datos factuales.

---

### Sistema — turno Arena (seller mode, IA = cliente)

**Modelo:** `gpt-4o` (TURN_MODEL)  
**max_tokens:** `300`, `temperature=0.7`

```
${MASTER_SELLER_BRAIN[lang]}   ← MODO:EJECUTOR

MODO: EJECUTOR
Eres el cliente/prospecto en una simulación de venta.

Contexto: ${context}
${bloque CONTEXTO ESTRUCTURADO ARENA si arenaStructuredContext existe}
PERSONALIDAD: ${CLIENT_PROFILE_DESC[clientProfile]}
DIFICULTAD: ${DIFFICULTY_DESC[difficulty]}
${bloque PRESET si randomPreset existe}
${nota de windowing si turns.length > ARENA_HISTORY_WINDOW}
${bloque RESTRICCIONES DEL CLIENTE si sellerNotes existen}

${buildArenaSellerTacticalRules(lang)}  ← Steps 1-5

Tu papel es la otra parte. Mantén tu personalidad de forma consistente.
Responde con 1-3 frases conversacionales naturales. Sin etiquetas ni metacomentarios.
```

**Reglas de MODO:EJECUTOR (noPoliticianMode, holdFrameMode):**

- `noPoliticianMode`: Regex `/polit|consult|bland[ao]|suave|soft/i`. Si el turno del cliente activa esta guarda, la IA rechaza suavidad y mantiene postura.
- `holdFrameMode`: Regex `/dejes ir|dejes al cliente|no.*ir|let.*go|hold|retener/i`. Análogo para mantener el marco.

**Historial (windowing):** Se envían los últimos `ARENA_HISTORY_WINDOW` (=12) turnos. Si hay más, el system prompt incluye nota con total de turnos para consistencia.

---

### Sistema — turno Arena (client mode, IA = vendedor)

**Modelo:** `gpt-4o` (TURN_MODEL)  
**max_tokens:** `220`, `temperature=0.7`

Prompt del vendedor experto con movimientos disponibles, umbral del cliente, coherencia de contexto, detección de objeción repetida, marcos descartados, regla de conclusión honesta. Ver texto completo en doc 04-prompts (versión anterior sección "client mode") — no ha cambiado en esta versión.

**Bloque sellerNotes (si existen):**
```
RESTRICCIONES DEL VENDEDOR (instrucciones adicionales del usuario):
${sellerNotes.join("\n")}
```

---

### shortcutDirection — generación del mensaje del usuario

Si `shortcutDirection = "agree"` o `"object"`, la IA genera primero el mensaje que "diría" el usuario:

**Prompt shortcut (gpt-4o-mini, max_tokens=60, temperature=0.9):**
```
Basándote en esta conversación de ventas, genera el mensaje corto (1-2 frases) que diría
el vendedor para ${agree: acordar / object: objetar o resistir}.
Sin etiquetas. Solo el texto del mensaje.
Conversación: ${últimos 4 turnos}
```

El mensaje generado se usa como `userMessage` para el turno normal. Se devuelve en `generatedUserMessage`.

---

### mensaje de apertura

**Modelo:** `gpt-4o-mini`, `max_tokens=150`

Prompt one-shot (sin system message, un único user turn):

```
Genera el primer mensaje de un {cliente/prospecto | vendedor experto} que inicia o responde
a una conversación de venta. Contexto: ${context}. Personalidad: ${profile}.
Escribe 1-2 frases naturales como esa persona. Sin etiquetas. Solo el texto.
${if sellerNotes}: Restricciones adicionales: ${sellerNotes.join(". ")}
```

---

### detección de estado terminal

**Modelo:** `gpt-4o-mini`, `max_tokens=5`, `temperature=0`

Single user message, sin system prompt. Ver doc 05-arena-logic para trigger logic. Prompt sin cambios.

---

### CoachLite (client mode)

**Modelo:** `gpt-4o-mini`, `max_tokens=500`, `temperature=0`

Llamado en paralelo con el turno cuando `role = "client"`. Analiza la respuesta de la IA vendedora y produce 7 campos de coaching.

**Prompt (abreviado):**
```
Eres coach de ventas. Analiza la última respuesta del vendedor IA y produce coaching táctico.

Contexto: ${context}
Conversación (últimos ${HISTORY_WINDOW} turnos):
${transcript}
Última respuesta del vendedor IA: ${aiMessage}

Responde SOLO con JSON:
{
  "signal": "<etiqueta táctica breve>",
  "reading": "<lectura de la situación>",
  "mission": "<objetivo de este momento>",
  "next_move": "<acción recomendada para el cliente>",
  "strategy": "<estrategia a medio plazo>",
  "why_this_response": "<por qué el vendedor respondió así>",
  "alternative": "<alternativa de respuesta que podría haber dado el vendedor>"
}
```

---

### Journey (client mode)

**Modelo:** `gpt-4o-mini`, `max_tokens=400`

Llamado en paralelo con CoachLite. Clasifica la etapa actual de la conversación con 6 etapas + risk indicator.

**Response:**
```json
{
  "stages": {
    "context": "done | current | upcoming",
    "problem": "done | current | upcoming",
    "blocker": "done | current | upcoming",
    "fit": "done | current | upcoming",
    "advance": "done | current | upcoming",
    "close": "done | current | upcoming"
  },
  "now_help": "string (qué hacer en la etapa actual)",
  "next_help": "string (hacia dónde mover la conversación)",
  "premature_close_risk": "low | medium | high"
}
```

---

### repitch (vendor IA, visual only)

**Modelo:** `gpt-4o-mini`, `max_tokens=300`, `temperature=0.7`

Genera un reposicionamiento del vendedor IA dado el turno actual + sellerNotes acumuladas. El resultado NO se añade a `session.turns`.

---

### suggest

**Modelo:** `gpt-4o-mini`, `max_tokens=300`, `temperature=0.3`

Genera el mensaje ideal del usuario para el siguiente turno. Ver doc 03 para request/response.

---

### debrief (seller mode)

**Modelo:** `gpt-4o-mini`, `max_tokens=300`, `temperature=0.2`

Sin cambios sustanciales en la rúbrica. Ver doc 05-arena-logic para las reglas completas.

**Bloque CoachLite de fallos graves** (nuevo):
Si `GRAVE_PENALTY_COUNT ≥ 1`, el debrief recibe una nota adicional:
```
NOTA IMPORTANTE: Esta sesión tuvo ${n} FALLO(S) GRAVE(S) marcado(s) por el coach:
${gravePenalties.map(p => `- ${p.reason}`).join("\n")}
Los fallos graves limitan el score máximo a 5 independientemente del outcome.
```

---

## Resumen de presupuesto de tokens

| Endpoint | Modelo | max_tokens | Tokens de entrada aprox |
|----------|--------|-----------|------------------------|
| copilot/analyze (V2) | gpt-4o | 900 | ~900 (con historial windowed) |
| copilot/analyze (V1) | gpt-4o | 900 | ~2100 |
| copilot/summarize (rápido) | gpt-4o-mini | 400 | ~300 |
| copilot/summarize (full) | gpt-4o-mini | 1600 | ~500 |
| copilot/context-label | gpt-4o-mini | 25 | ~60 |
| arena/opening | gpt-4o-mini | 150 | ~120 |
| arena/turn (seller mode) | gpt-4o | 300 | ~400-800 (windowed) |
| arena/turn (client mode) | gpt-4o | 220 | ~400-800 (windowed) |
| arena/shortcut | gpt-4o-mini | 60 | ~150 |
| arena/terminal-state | gpt-4o-mini | 5 | ~200 |
| arena/coach-lite | gpt-4o-mini | 500 | ~500 |
| arena/journey | gpt-4o-mini | 400 | ~400 |
| arena/suggest | gpt-4o-mini | 300 | ~300 |
| arena/repitch | gpt-4o-mini | 300 | ~300 |
| arena/debrief | gpt-4o-mini | 300 | ~500 |
| arena/preset-context | gpt-4o-mini | 65-120 | ~80 |
| arena/adapt-context | gpt-4o-mini | 150 | ~200 |
