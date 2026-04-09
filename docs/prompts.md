# VELA — AI Prompts

All prompts target **gpt-4o-mini**. Two optimization levels exist behind feature flags.

---

## Copilot Prompts

### V2 (Default — ~700 input tokens)

The V2 prompt is the production default. It is compact, structured, and enforces strict JSON output.

**System prompt (abridged structure):**
```
Eres un copiloto de ventas en tiempo real.
Contexto de la llamada: {sessionContext}
Memoria actual: {callMemory as bullet list}
Idioma: {lang rule}

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

### V1 (Legacy — ~2100 input tokens)

Enabled with `LEGACY_PROMPTS=true`. More verbose, includes extensive examples and instruction repetition. Functionally equivalent output. Use only for debugging regressions.

---

### Copilot: summarize

Called at end-of-call. Two modes:

**Quick summary** (`full_report=false`, `max_tokens=400`):
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

**Full report** (`full_report=true`, `max_tokens=1600`):
Same as above but adds `"fullReport": "<análisis narrativo detallado>"` to the JSON schema and instructs the model to write 3–5 paragraphs of coaching analysis.

---

### Copilot: context-label

Generates a 3–5 word display label from the user's typed context.

```
Generate a 3-5 word label for this sales call context.
Context: {context}
Reply with only the label, no punctuation.
Language: {lang}
```

`max_tokens=25`, temperature=0.

---

## Arena Prompts

### System prompt (seller mode — AI plays client)

```
Eres el cliente/prospecto en una simulación de conversación de venta.

Contexto: {context}
PERSONALIDAD: {CLIENT_PROFILE_DESC[clientProfile]}
DIFICULTAD: {DIFFICULTY_DESC[difficulty]}
[windowing note if history > 12 turns]

Tu papel es la otra parte. Mantén tu personalidad de forma consistente.
Responde con 1-3 frases conversacionales naturales. Sin etiquetas ni metacomentarios. Solo el texto.
Responde solo en español. / Respond only in English.
```

### System prompt (client mode — AI plays seller)

```
Eres el vendedor/consultor en una simulación de conversación de venta.

Contexto: {context}
PERSONALIDAD: {SELLER_PROFILE_DESC[sellerProfile]}
[windowing note if history > 12 turns]

Tu papel es el vendedor. Mantén tu personalidad de forma consistente.
Responde con 1-3 frases conversacionales naturales. Sin etiquetas ni metacomentarios. Solo el texto.
```

`max_tokens=300` per turn.

---

### Arena: opening message

A one-shot prompt (no system message, single user turn):

```
Genera el primer mensaje de un {cliente/prospecto | vendedor experto} que inicia o responde a
una conversación de venta. Contexto: {context}. Personalidad: {profile}.
Escribe 1-2 frases naturales como esa persona. Sin etiquetas. Solo el texto.
```

`max_tokens=150`.

---

### Arena: terminal state detection

Called conditionally (see [arena-logic.md](./arena-logic.md)). Single user message, no system prompt.

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
{last 6 turns as VENDEDOR/CLIENTE: message}

Responde solo con la palabra:
```

`max_tokens=5`, temperature=0.

---

### Arena: suggest

Generates the ideal next message for the user.

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

Post-session coaching analysis. Only generated for seller-role sessions with at least one user turn.

```
Eres coach de ventas experto. Evalúa al vendedor con precisión y sin rodeos.

Contexto: {context}
Resultado: {outcome label}
[windowing note if turns > 15]

Conversación:
{transcript — last 15 turns max}

Responde SOLO con JSON válido:
{"score":<1-10>,"critique":["frase 1","frase 2","frase 3"]}

Reglas: score honesto pesando el resultado (cerrada contra cliente difícil → mínimo 7;
perdida → máximo 6). critique: exactamente 3 frases cortas accionables, imperativo
(Escucha, Controla, Adapta...), específicas a esta conversación.
```

`max_tokens=300`, temperature=0.4.

---

## Token Budget Summary

| Endpoint | max_tokens | Approx input tokens |
|----------|-----------|---------------------|
| copilot/analyze | 900 | ~700 (V2) / ~2100 (V1) |
| copilot/summarize (quick) | 400 | ~300 |
| copilot/summarize (full) | 1600 | ~500 |
| copilot/context-label | 25 | ~60 |
| arena/opening | 150 | ~120 |
| arena/turn | 300 | ~200–600 (windowed) |
| arena/terminal-state | 5 | ~200 |
| arena/suggest | 200 | ~300 |
| arena/debrief | 300 | ~500 |
