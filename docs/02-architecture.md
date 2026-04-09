# 02 — ARCHITECTURE
_Generated: 2026-04-09_

## Repository structure

```
/
├── artifacts/
│   ├── api-server/          # Express API — port 8080
│   │   └── src/
│   │       ├── index.ts     # Server entry, route mounting
│   │       ├── routes/
│   │       │   ├── copilot.ts
│   │       │   └── arena.ts
│   │       └── lib/
│   │           ├── ai-tracker.ts
│   │           └── logger.ts
│   ├── silent-closer/       # React + Vite frontend
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── copilot.tsx
│   │       │   └── arena.tsx
│   │       ├── components/
│   │       │   └── context-panel.tsx
│   │       └── lib/
│   │           ├── audit-log.ts
│   │           └── utils.ts
│   └── mockup-sandbox/      # Canvas/design sandbox only
└── lib/
    └── sales-brain/         # @workspace/sales-brain — shared commercial logic
        └── src/index.ts
```

## Data flow

### Copilot mode
```
User types fragment
  → POST /api/copilot/analyze
      body: { text, context?, call_memory?, lang }
      header: x-session-id
  ← JSON: { signal, say_now, avoid, detail, journey, call_memory, momentum }
  → UI updates signal panel + momentum indicator

User ends call
  → POST /api/copilot/summarize
      body: { call_memory[], outcome, lang, full_report? }
  ← JSON: { score, global_state, result_label, strengths[], improvements[], full_report? }

User opens brutal audit (lazy)
  → POST /api/copilot/audit-report
      body: { call_memory[], outcome, context?, lang }
  ← JSON: BrutalAudit

User downloads audit log
  → buildCopilotAuditLog(sessionData) → AuditLog
  → renderAuditLogMarkdown(log) → .md string
  → Blob download in browser
```

### Arena mode
```
User configures session (role, context, profile, difficulty, preset)
  → POST /api/arena/start
      body: { role, lang, context, clientProfile?, sellerProfile?, difficulty?, forceTerminal?, randomPreset? }
  ← { arenaSessionId: uuid, openingMessage: string }

User sends message
  → POST /api/arena/turn
      body: { arenaSessionId, userMessage?, shortcutDirection?: "agree"|"object" }
  ← { aiMessage, terminalSignal, coachLite?, generatedUserMessage? }
  (terminalSignal in: none|closed|next_step|lost|broken)

  Parallel inside turn:
    - Terminal detection (seller mode only, conditional)
    - CoachLite generation (client mode only)
    - Journey generation (client mode only)

User ends session
  → POST /api/arena/finish
      body: { arenaSessionId, outcome }
  ← { turns[], summary: { role, context, lang, totalTurns, userTurns, createdAt, closedAt, outcome, debrief? } }
  Session removed from memory after 5 min.

User opens brutal audit (lazy)
  → POST /api/arena/audit-report
      body: { transcript[], context, outcome, role, clientProfile?, sellerProfile?, difficulty?, lang }
  ← JSON: BrutalAudit

User downloads audit log
  → buildArenaAuditLog(sessionData) → AuditLog
  → renderAuditLogMarkdown(log) → .md string
  → Blob download
```

## Session state

### Copilot
- Entirely client-side. `sessionId` is a UUID generated in the frontend and sent as `x-session-id` header.
- `call_memory` is accumulated client-side from each analyze response and sent back on the next call.
- No server-side session store for copilot.

### Arena
- Server-side `Map<string, ArenaSession>` in `arena.ts`.
- Session created at `POST /api/arena/start`, keyed by UUID.
- Deleted immediately at `POST /api/arena/finish` (then removed from Map after 5 min via setTimeout).
- `ArenaSession` fields: id, role, lang, context, turns[], createdAt, closedAt?, outcome?, clientProfile?, sellerProfile?, difficulty?, forceTerminal?, randomPreset?, sellerNotes[].

## Optimization flags (env)
- `LEGACY_PROMPTS=true` → use original V1 copilot prompt (~2100 tokens) instead of V2 (~700 tokens).
- `LEGACY_ARENA=true` → disable history windowing and conditional terminal detection.

## History windowing (Arena)
- `ARENA_HISTORY_WINDOW = 12` turns (6 exchanges) sent to GPT in seller mode.
- `DEBRIEF_MAX_TURNS = 15` — transcript truncated at 15 turns for debrief.
- `SUGGEST_MAX_TURNS = 10` — transcript truncated at 10 turns for suggest.
- Journey: last 10 turns used for prompt.
- Shortcut + terminal detection: last 6 turns.

## Model configuration per endpoint

| Endpoint | max_tokens | temp | Notes |
|---|---|---|---|
| copilot/analyze | 900 | default | JSON output |
| copilot/summarize | 400 / 1600 | default | 1600 if full_report |
| copilot/audit-report | 900 | 0.3 | BrutalAudit JSON |
| copilot/context-label | 25 | default | 4-6 word label |
| arena/start (opening) | 150 | default | First AI message |
| arena/turn (conversation) | 220 (client) / 300 (seller) | default | AI response |
| arena/turn (terminal) | 5 | 0 | Single word |
| arena/turn (coach-lite) | 280 | 0 | 3-line annotation |
| arena/turn (journey) | 200 | 0 | JSON |
| arena/turn (shortcut) | 80 | 0.7 | 1-2 sentence |
| arena/preset-context | 120 (immvest) / 65 (others) | 0.95 | Context generation |
| arena/adapt-context | 150 | 0.2 | Role rewrite |
| arena/repitch | 300 | 0.7 | Seller reposition |
| arena/suggest | 200 | 0.5 | Ideal seller response |
| arena/debrief | 300 | 0.2 | Score + 3 critiques |
| arena/audit-report | 900 | 0.3 | BrutalAudit JSON |

All calls use `gpt-4o-mini`.
