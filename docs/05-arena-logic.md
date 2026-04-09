# 05 — ARENA LOGIC
_Generated: 2026-04-09_

## Session lifecycle

```
preset-context? (optional, pre-session)
adapt-context? (optional, on role switch)
  ↓
POST /arena/start → creates ArenaSession, stores in Map, generates opening message
  ↓
POST /arena/turn (N times)
  → receives userMessage OR shortcutDirection
  → windowed history sent to GPT
  → AI response generated
  → parallel: terminal detection + coachLite + journey
  → response returned
  ↓
POST /arena/finish
  → session closedAt set, outcome recorded
  → debrief generated (seller mode only)
  → closeSession() called (logs AI totals)
  → session queued for deletion (5 min)
```

## Role semantics

| User role | AI role | CoachLite | Journey | Shortcut | Debrief |
|---|---|---|---|---|---|
| seller | client | no | no | no | yes |
| client | seller | yes | yes | yes | no |

- **Seller mode**: user practices selling. AI plays a buyer with optional profile + difficulty.
- **Client mode**: user practices being a client. AI plays a seller with optional seller profile. CoachLite annotates AI seller moves for learning.

## Turn processing (POST /api/arena/turn)

1. Load session from Map (404 if not found).
2. If `shortcutDirection` set → call `generateShortcutResponse()` → use as effective user message.
3. Append user turn to `session.turns`.
4. Build windowed history: if optimized + history > 12, slice last 12 turns.
5. Build GPT messages: `[system, ...windowedTurns]`.
6. Call OpenAI for AI response (220 tokens if client mode, 300 if seller mode).
7. Append AI turn to `session.turns`.
8. In parallel:
   - `detectTerminalState()` → seller mode only, gated by `shouldCheckTerminal()`
   - `generateCoachLite()` → client mode only
   - `generateJourney()` → client mode only
9. Merge journey into coachLite payload.
10. Return `{ aiMessage, terminalSignal, coachLite?, generatedUserMessage? }`.

## Terminal detection logic

Seller mode only. Two-tier gate:

**Tier 1 — `shouldCheckTerminal()`:**
- Skip if < 4 turns.
- Always check if turns ≥ 6 AND turns % 3 === 0 (safety net every 3rd turn).
- Check if last AI message contains any keyword from `TERMINAL_HINTS[lang]`.

**Terminal hint keywords (es):**
trato hecho, cerramos, firmamos, me lo quedo, me apunto, lo compro, cuándo firmo/firma, voy a pagar, pago con, con tarjeta, bizum, mándame el contrato/propuesta, cuando quieras empezamos, no me interesa en absoluto, definitivamente no, no voy a comprar, no quiero saber más, hasta aquí, no seguimos, adiós, hasta luego.

**Tier 2 — GPT call:**
5 tokens, temp 0. Returns one word: `none | closed | next_step | lost | broken`.
Strict definitions — "I'll think about it" → `none`, not `next_step`.

`forceTerminal=true` on session bypasses Tier 1 gate (always checks from turn 2+).

## Debrief logic

Only generated if: `role === "seller"` AND `userTurns > 0`.

- Transcript capped at last 15 turns (`DEBRIEF_MAX_TURNS`).
- `DEBRIEF_CLIENT_PROFILE[clientProfile]` injected as coaching context.
- Score clamped to [1, 10] and rounded.
- Critique capped at 3 sentences.
- Returns null on any error — debrief is optional.

## CoachLite

Generated after each AI turn in client mode.  
Input: last user message + AI response just generated + session context.  
Output: 3-line markdown string (bold tactical name + 2 bullet lines).  
Stored in `coachLiteMap` on the frontend (keyed by AI message index).  
Available in audit log if present.

## Journey

Generated after each AI turn in client mode.  
Input: last 10 turns + context.  
Output: `JourneyData` with 6-stage statuses + now_help + next_help + premature_close_risk.  
Validated by `isValidJourney()` before use — invalid or missing JSON → null (silently dropped).

## Session configuration

| Field | Type | Notes |
|---|---|---|
| role | seller \| client | Required |
| lang | es \| en | Default: es |
| context | string | Free text, 1st-person by convention |
| clientProfile | string | Optional, from CLIENT_PROFILE_DESC keys |
| sellerProfile | string | Optional, from SELLER_PROFILE_DESC keys |
| difficulty | string | Optional: easy/normal/hard/brutal |
| forceTerminal | boolean | Default: false |
| randomPreset | string | Optional, from PRESET_SYSTEM_DESC keys |
| sellerNotes | string[] | Accumulated via /arena/note |

## Profiles and presets

### Client profiles (seller mode — AI behavior)
- `analytical` — demands data, precision, evidence
- `emotional` — decides by trust and connection
- `skeptical` — distrusts by default, demands proof
- `cautious` — fears mistakes, avoids risk and pressure
- `dominant` — controls pace, punishes weakness
- `indecisive` — needs guidance, changes mind
- `negotiator` — presses on price, demands concessions

### Seller profiles (client mode — AI behavior)
- `communicative` — anecdotes and examples, sometimes too verbose
- `authoritative` — direct, assertive, controls conversation
- `technical` — data and features, less emotional
- `passive` — listens, doesn't push
- `aggressive` — creates urgency, doesn't accept no
- `consultive` — many questions, adapts solution

### Difficulty (seller mode only)
- `easy` — few objections, open to listen
- `normal` — some valid objections, needs good arguments
- `hard` — many objections, compares with competition
- `brutal` — skeptical, questions everything, only yields to very solid arguments

### Presets (injects full commercial frame)
- `immvest` — real estate investment Germany, Immvest methodology
- `saas` — software sale: demo, pilot, ROI, integration
- `b2b` — business sale: formal proposal, committee, budget
- `high_ticket` — high-value sale >5k€, trust, fear of wrong decision
- `coaching` — coaching/training sale: results, method, transfer
- `challenge` — absurd/impossible sale, must be specific and creative

## Seller notes (client mode — runtime constraints)

User writes a restriction for the AI seller (e.g. "don't offer discounts", "you only sell in Berlin").  
Stored in `session.sellerNotes[]`.  
Injected in system prompt as numbered list under `RESTRICCIONES DEL VENDEDOR (aplica SIEMPRE)`.  
After adding a note, frontend can call `/api/arena/repitch` to make AI restate its position.

## History windowing

`USE_OPTIMIZED_ARENA = process.env["LEGACY_ARENA"] !== "true"` (default: true = optimized).

In optimized mode:
- Turn history for GPT capped at last 12 turns.
- A window note is appended to system prompt informing the model of total turns and the windowed subset.
- Debrief transcript capped at last 15 turns.
- Suggest transcript capped at last 10 turns.
- Journey uses last 10 turns.
- Shortcut / terminal detection use last 6 turns.

## Repitch

After note injection, frontend calls `/api/arena/repitch`.  
AI receives a hidden trigger message: `[El entrenador del cliente acaba de actualizar tus restricciones. Sin mencionarlo, replantea tu posición...]`  
AI response is appended as a new AI turn.  
max_tokens: 300, temp: 0.7.
