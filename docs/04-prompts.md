# 04 — PROMPTS (VIGENTES)
_Generated: 2026-04-09_

All prompts are defined locally in their route files. `@workspace/sales-brain` exports blocks injected into them. No prompt logic inside sales-brain itself.

---

## COPILOT — BASE_SYSTEM_PROMPT (V2, active by default)

~700 tokens. Used when `LEGACY_PROMPTS` env var is not `"true"`.

**Structure:**
1. Role definition ("copiloto táctico silencioso")
2. JSON schema (inline, single-line)
3. Field differentiation rules (signal / reading / mission / next_move / journey.now / say_now)
4. Fragment classification (seller move / client doubt / ambiguous noise)
5. Decision criterion anchoring rule
6. Implicit advance detection rule
7. Anti-repetition rule (5 cases)
8. `OBJECTION_TAXONOMY_BLOCK.es` (injected from sales-brain)
9. `COMPARISON_RULE_BLOCK.es` (injected from sales-brain)
10. SAY_NOW quality rules + examples
11. "falta claridad" restriction
12. AVOID rules
13. SUPPORT hierarchy (3 levels, no invented data)
14. `CLOSING_CRITERIA_BLOCK.es` (injected from sales-brain)
15. CALL_MEMORY rules
16. MOMENTUM rules

**Then appended dynamically** (via `buildSystemPrompt(context, lang)`):
- `CONTEXTO DE SESIÓN: {context}` block — only if context is non-empty.
- Language rule: `IDIOMA: La llamada es en español.` OR `LANGUAGE: The call is in English.`

**V1 legacy prompt**: ~2100 tokens, same rules but verbose prose. Kept behind `LEGACY_PROMPTS=true` flag. Not used by default.

**User message format** (per analyze call):
```
MEMORIA ACUMULADA:
{call_memory}

FRAGMENTO:
{text}

JSON táctico:
```

---

## COPILOT — SUMMARIZE PROMPT

Two-language prompt (`isEn` branch). System message defines role and scoring rubric.

**Scoring (0-10, result-weighted):**
- 8.5-9.5: Close/solid next step + good execution
- 7.5-8.4: Clear advance, good direction
- 6.0-7.4: Workable, partial
- 4.0-5.9: Weak
- 0-3.9: Failed
- Key rule: `closed|next_step` without major errors → base ≥ 8.0
- Short efficient calls NOT penalized for brevity.

**Full report format** (when `full_report: true`):
Predefined section headers (Resumen ejecutivo / Lo que se hizo bien / Lo que se puede mejorar / Objeciones / Control de la conversación / Cierre / Recomendación).

**User message format:**
```
MEMORIA TÁCTICA:
- line 1
- line 2

RESULTADO DECLARADO: {outcome}

Analiza y devuelve el JSON:
```

---

## COPILOT — AUDIT-REPORT PROMPT

System defines auditor role with very high standards. Two language branches.

**Critical rules injected:**
- No gap-filling if evidence is insufficient
- Penalize: vagueness, accumulated generic questions, unresolved objections, soft closes, loss of control
- Next step ≠ strong session
- `failure_owner` taxonomy: vendedor | timing | sistema | técnico | setup | sin fallo real
- `missed_closes`: concrete moments with implicit permission to advance
- `rules_violated`: anti-patterns clearly present
- `priority_changes`: 2-4 concrete changes (not generic advice)
- `what_i_would_have_done`: concrete alternative, not vague
- `prompt_patch` / `prompt_for_replit`: null unless clear system/setup error

**User message format:**
```
MEMORIA TÁCTICA:
- {lines}
CONTEXTO: {context}

RESULTADO DECLARADO: {outcome}
```

---

## ARENA — SYSTEM PROMPT (seller mode — AI plays client)

Built by `buildSystemPrompt(role="seller", ...)`.

**Injected from sales-brain:**
- `CLIENT_PROFILE_DESC[clientProfile]` → `PERSONALIDAD: ...`
- `DIFFICULTY_DESC[difficulty]` → `DIFICULTAD: ...`
- `PRESET_SYSTEM_DESC[randomPreset]` → full preset block

**Core rules:**
- 1-3 conversational sentences per response
- Bold (**) for key objections, prices, deadlines, commitments
- No labels or metacommentary
- Language rule (es or en)
- Window note if history > 12 turns

---

## ARENA — SYSTEM PROMPT (client mode — AI plays seller)

Built by `buildSystemPrompt(role="client", ...)`.

**Injected:**
- `SELLER_PROFILE_DESC[sellerProfile]` → `PERSONALIDAD: ...`
- Seller notes → `RESTRICCIONES DEL VENDEDOR (no negociable):`
- `PRESET_SYSTEM_DESC[randomPreset]`
- `SALES_ANTIPATTERNS_BLOCK.es` (full forbidden list)

**Core rules:**
- 4 available moves: diagnose with specific question / respond direct / identify threshold / honestly admit no fit
- When client defines a threshold: it becomes the axis of the conversation
- Context coherence: no proposing changes already defined as fixed
- Repeated objection detection: go to threshold or acknowledge block
- Burned frames: never revive a rejected argument frame
- When conclusion is stated: don't elaborate, one sentence max
- Formatting: line breaks between ideas; bold on key numbers, conditions, questions; short sentences (≤20 words); question always on its own paragraph
- Tone: conversational, not chatbot

---

## ARENA — OPENING PROMPT

`buildOpeningPrompt(role, context, lang, clientProfile?, sellerProfile?, randomPreset?)`

**Seller mode** (AI = client): Generate first message of the client/prospect.  
1 short natural sentence. No labels.

**Client mode** (AI = seller): Invent a specific real-sounding name and company. EXACTLY ONE sentence. Must vary approach (observation, reference to prospect, hook, question). Never explain the product. Bold on most important word if relevant.

Constraints injected: profileHint + presetHint (first line of preset block only).

max_tokens: 150, temp: default.

---

## ARENA — DEBRIEF PROMPT

`generateDebrief(turns, context, lang, outcome, sessionId?, clientProfile?)`

Transcript limited to last 15 turns. `DEBRIEF_CLIENT_PROFILE[clientProfile]` injected as coaching context.

**Rubric (both languages):**
1. Outcome AND execution quality weighted equally
2. HARD CAP ≤ 7 if buyer repeats core demand 2+ times and seller never addresses concretely
3. PENALTIES (−1 to −2 each): proposes meeting/close before resolving main objection; next step ambiguous without date/action; repeats same response structure
4. Profile sensitivity: apply buyer profile criterion to judge seller response
5. Score references: closed vs tough client → min 8; lost/broken → max 5; next_step good → up to 8; next_step weak → 5-6

**Response:** `{"score": 1-10, "critique": ["sentence 1", "sentence 2", "sentence 3"]}`  
3 critique sentences, imperative, actionable, specific to this conversation.  
max_tokens: 300, temp: 0.2.

---

## ARENA — TERMINAL DETECTION PROMPT

`detectTerminalState(turns, role, lang, sessionId?, force?)`

Only runs in seller mode. Uses last 6 turns. Returns exactly one word.

**Strict definitions:**
- `none` — in progress or ambiguous (default when in doubt)
- `closed` — client explicitly closed (said they'll buy, asked to sign/pay)
- `next_step` — client committed concrete action (confirmed date, requested contract/proposal) — "I'll think about it" does NOT qualify
- `lost` — definitive rejection, no turning back
- `broken` — total breakdown, conversation cut off

max_tokens: 5, temp: 0.

**Conditional check** (`shouldCheckTerminal()`):
- Returns false if < 4 turns
- Returns true if turns ≥ 6 AND turns % 3 === 0 (every 3rd turn as safety net)
- Returns true if last AI message contains a terminal keyword from `TERMINAL_HINTS[lang]`

---

## ARENA — COACH-LITE PROMPT (client mode)

`buildCoachLitePrompt(userMessage, aiMessage, context, lang)`

**MANDATORY FORMAT — exactly 3 lines:**
```
Line 1: **Tactical name** (2-4 words bold, no period)
Line 2: - what the seller does or detects (≤7 words, no period)
Line 3: - why it works / what goal it achieves (≤7 words, no period)
```

No intro, no extra sentences, no praise.  
max_tokens: 280, temp: 0.

---

## ARENA — JOURNEY PROMPT (client mode)

`buildJourneyPrompt(turns, context, lang)`

Analyzes last 10 turns. Returns JSON with 6-stage status.

**Stages:** context → problem → blocker → fit → advance → close  
**Status per stage:** `done` / `current` / `upcoming`  
**Constraint:** exactly ONE stage = current; all done stages must precede current.

**Additional fields:**
- `now_help`: what seller is trying to achieve NOW (1 short sentence)
- `next_help`: what needs to happen to advance (1 short sentence)
- `premature_close_risk`: `low | medium | high`

Validated by `isValidJourney()` before use. max_tokens: 200, temp: 0.

---

## ARENA — SHORTCUT PROMPT (client mode)

`buildShortcutPrompt(lastAiMessage, recentTurns, context, direction, lang)`

Direction `"agree"`: short natural CLIENT response that advances the conversation positively. If seller asked for a specific fact, invent a realistic concrete answer.  
Direction `"object"`: short natural CLIENT objection specific to what seller just said. Not generic resistance.

1-2 sentences. No quotes, no labels. max_tokens: 80, temp: 0.7.

---

## ARENA — SUGGEST PROMPT

Expert sales professional writes the PERFECT seller response now.  
Uses last 10 turns. 2-3 sentences max. Natural, conversational, tactically sound.  
max_tokens: 200, temp: 0.5.

---

## ARENA — ADAPT-CONTEXT PROMPT

`fromRole=seller → toRole=client`:  
"Rewrite from BUYER/CLIENT first-person. Keep every concrete detail. Only change who is speaking."

`fromRole=client → toRole=seller`:  
"Rewrite from SELLER first-person. Keep every concrete detail."

max_tokens: 150, temp: 0.2. On error: returns original text.

---

## ARENA — PRESET-CONTEXT PROMPT

Role-concordant 1st person. Two major branches:

**Immvest seller:** "Tengo que vender a... / Mi prospecto es..." (2-3 frases). Invent concrete details.  
**Immvest client:** "Me están intentando convencer de invertir en..." (2-3 frases).  
**Other presets seller:** 1-2 punchy sentences. "Tengo que vender X a Y que..."  
**Other presets client:** 1-2 sentences. "Me están intentando vender X..."  
**Challenge preset:** Extra constraint injected — must be absurd, specific numbers, banned tropes list.

All variations use same bilingual structure. max_tokens: 120 (immvest) / 65 (others). temp: 0.95.

---

## ARENA — AUDIT-REPORT PROMPT (role-aware, 4 variants)

**EN + role=seller:** Coach evaluating seller execution — penalize monologues, lack of control, soft closes, no evidence. Evaluate in context of AI client profile and difficulty.

**EN + role=client:** Evaluating AI seller quality — was the simulation useful? Was there enough challenge? Did AI seller exploit openings?

**ES + role=seller:** Same as EN seller variant in Spanish.

**ES + role=client:** Same as EN client variant in Spanish.

**failure_owner taxonomy (Arena):** usuario | timing | setup | sistema | sin fallo real  
(vs copilot: vendedor | timing | sistema | técnico | setup | sin fallo real)

max_tokens: 900, temp: 0.3. User message includes: context, profile block, outcome, full transcript.
