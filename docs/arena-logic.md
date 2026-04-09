# VELA — Arena Logic

Arena is a sales conversation simulator where the user practices selling (or being sold to) against an AI counterpart.

---

## Session Lifecycle

```
POST /api/arena/start
  └─ Creates ArenaSession in server memory
  └─ AI generates opening message (max_tokens=150)
  └─ Returns { arenaSessionId, openingMessage }

User sends message → POST /api/arena/turn  (repeats)
  └─ Appends user turn to session.turns
  └─ AI generates response (max_tokens=300, windowed history)
  └─ Conditional terminal state detection (max_tokens=5)
  └─ Returns { aiMessage, terminalSignal }

Session ends (detected or manual) → POST /api/arena/finish
  └─ Generates debrief if role=seller
  └─ Calls closeSession() on ai-tracker (keeps stats 10 min)
  └─ Returns { turns, summary }
  └─ In-memory session deleted after 5 min timeout
```

---

## Roles

| User role | AI plays |
|-----------|---------|
| `seller` | Client/prospect — configured with personality and difficulty |
| `client` | Seller/consultant — configured with seller personality |

In seller mode, the AI plays a realistic prospect with a configurable personality, and terminal state detection is active. In client mode, the AI plays a consultant and terminal detection is disabled.

---

## Client Personalities (`clientProfile`)

| Key | Description |
|-----|-------------|
| `analytical` | Data-driven, needs evidence, not swayed by emotion |
| `emotional` | Decides by trust and personal connection, influenced by testimonials |
| `insecure` | Many doubts, fear of mistakes, needs constant validation, postpones |
| `dominant` | Takes control, interrupts, sets the pace, needs to feel in power |
| `indecisive` | Changes mind repeatedly, says "I'll think about it", hard to commit |
| `hard_negotiator` | Always pushes on price, demands aggressive discounts, compares competitors, threatens to walk |

---

## Seller Personalities (`sellerProfile`)

| Key | Description |
|-----|-------------|
| `communicative` | Builds rapport with anecdotes. Sometimes over-explains |
| `authoritative` | Direct, assertive, controls the conversation, firm on objections |
| `technical` | Detail-focused on features and data. Precise but sometimes unemotional |
| `passive` | Listens a lot, doesn't pressure, lets client reach conclusions |
| `aggressive` | Pushes to close, creates urgency, doesn't accept no |
| `consultive` | Asks many questions, understands needs first, adapts solution |

---

## Difficulty Levels (`difficulty`)

| Key | Behaviour |
|-----|-----------|
| `easy` | Few objections, open to listening |
| `normal` | Some valid objections, requires good arguments |
| `hard` | Many objections, compares competitors, hard to convince |
| `brutal` | Sceptical, questions everything, strong objections, only yields to very solid arguments |

---

## History Windowing

When `LEGACY_ARENA=false` (default):

- Only the **last 12 turns** of the conversation are sent to the AI for each turn response.
- The system prompt includes a note explaining the total conversation length for consistency.
- Full history is always kept in `session.turns` for the final transcript and debrief.
- `DEBRIEF_MAX_TURNS = 15` — debrief only analyzes the last 15 turns of long sessions.
- `SUGGEST_MAX_TURNS = 10` — suggest only uses last 10 turns.

When `LEGACY_ARENA=true`:
- Full history sent every turn. No windowing. No conditional terminal detection.

---

## Terminal State Detection

Terminal detection is the mechanism that automatically identifies when a sales conversation has reached a definitive outcome.

### When it runs

Detection only runs in **seller mode**. A check is triggered if ANY of:

1. `turns.length >= 4` AND a **keyword match** is found in the last AI message
2. `turns.length >= 6` AND `turns.length % 3 === 0` (safety net every 3 turns after turn 6)

This is the `shouldCheckTerminal()` function. If neither condition is met, detection is skipped entirely (saving one API call).

### Keyword triggers (Spanish)

```
trato hecho, cerramos, firmamos, me lo quedo, me apunto, lo compro,
cuándo firmo, cuándo firma, voy a pagar, pago con, con tarjeta, bizum,
mándame el contrato, mándame la propuesta, cuando quieras empezamos,
no me interesa en absoluto, definitivamente no, no voy a comprar,
no quiero saber más, hasta aquí, no seguimos, adiós, hasta luego
```

### Keyword triggers (English)

```
deal, let's close, i'll take it, i'll buy, send me the contract,
when do i sign, i'll pay with, by card, send the proposal,
not interested at all, definitely not, won't buy, stop here, goodbye, bye
```

**Intentionally excluded:** Broad phrases like "de acuerdo", "siguiente paso", "cuándo podemos" do NOT trigger detection because they occur frequently in normal conversation.

### Detection prompt

Sends the last 6 turns to the model and asks for exactly one word: `none | closed | next_step | lost | broken`.

**Outcome definitions (strict):**
- `none` — conversation is still open or ambiguous (default when in doubt)
- `closed` — client explicitly committed to buying (said they'll buy, asked when to sign, asked about payment)
- `next_step` — client committed to a **concrete** action: confirmed meeting date, requested contract/proposal, asked about payment methods — "I'll think about it" does NOT qualify
- `lost` — client definitively rejected, no way back
- `broken` — total breakdown, client cut off the conversation

### Fallback

If the API call fails or returns an unexpected value, the result defaults to `"none"`.

---

## Suggest Feature

The ✨ button in seller mode calls `POST /api/arena/suggest`. The returned suggestion is:

1. Displayed to the user briefly
2. Automatically sent as the user's next turn (calls `POST /api/arena/turn`)

This means suggest counts as two API calls — one for the suggestion itself and one for the AI's response to it.

---

## Debrief

Generated at session end for seller-role sessions with at least one user turn.

- Score: 1–10 (honest, weighted by outcome — closed vs tough client → min 7; lost → max 6)
- Critique: exactly 3 short actionable sentences in imperative form, specific to this conversation

The debrief is displayed in the Arena post-session screen and included in the audit log.

---

## Session Cleanup

| Event | What happens |
|-------|-------------|
| `POST /api/arena/finish` called | `closeSession()` called on ai-tracker |
| 5 minutes after finish | Arena session Map entry deleted |
| 10 minutes after `closeSession()` | ai-tracker session summary deleted |
| Server restart | All sessions lost (in-memory only) |
