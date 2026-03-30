# Closer Wizard — Architecture

## Overview

Closer Wizard is a single-screen, ultraminimalist sales call tactical assistant. It has two core modes:

- **Copiloto** — real-time AI coaching during live sales calls
- **Arena** — AI conversation simulation for sales practice

The system is a monorepo (`pnpm` workspaces) with two main services:

| Service | Package | Tech | Port |
|---------|---------|------|------|
| Frontend | `@workspace/silent-closer` | React + Vite + Tailwind | `$PORT` (env) |
| API | `@workspace/api-server` | Node.js + Express + Pino | `8080` |

All API routes are prefixed `/api/`.

---

## Directory Structure

```
workspace/
├── artifacts/
│   ├── silent-closer/          # React frontend
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── copilot.tsx     # Copiloto mode UI
│   │       │   └── arena.tsx       # Arena mode UI
│   │       ├── components/
│   │       │   └── debug-panel.tsx # Developer debug overlay
│   │       └── lib/
│   │           └── audit-log.ts    # Audit log builder + renderer
│   └── api-server/             # Express API
│       └── src/
│           ├── routes/
│           │   ├── copilot.ts      # /api/copilot/* endpoints
│           │   ├── arena.ts        # /api/arena/* endpoints
│           │   └── debug.ts        # /api/debug/usage
│           └── lib/
│               ├── ai-tracker.ts   # Centralized AI call observability
│               └── logger.ts       # Pino structured logger
└── docs/                       # This documentation
```

---

## Data Flow — Copiloto

```
User Speech / Text
      │
      ▼
Web Speech API (or manual paste)
      │
      ▼
POST /api/copilot/analyze  ←─ session context, call memory, lang, speaker_mode
      │
      ▼ (gpt-4o-mini, ~700 tokens prompt)
JSON response: signal, say_now, avoid, detail, journey, call_memory, momentum
      │
      ▼
UI updates hero card + memory strip
      │
 (end of call)
      ▼
POST /api/copilot/summarize  ←─ full turn log
      │
      ▼ (gpt-4o-mini, 900–1600 tokens budget)
JSON: score, globalState, resultLabel, strengths, improvements, fullReport
      │
      ▼
Audit log built client-side → .md download
```

## Data Flow — Arena

```
Config (role, context, profiles, difficulty)
      │
      ▼
POST /api/arena/start  ←─ role, lang, context, clientProfile, sellerProfile, difficulty
      │
      ▼ (gpt-4o-mini, max_tokens=150)
AI opening message → stored in server-side session map
      │
User types message
      ▼
POST /api/arena/turn  ←─ arenaSessionId, userMessage
      │
      ├──▶ Turn AI response (max_tokens=300)
      └──▶ Terminal state detection (conditional, max_tokens=5)
           │
           ▼
{ aiMessage, terminalSignal }
      │
 (session ends)
      ▼
POST /api/arena/finish  ←─ arenaSessionId, outcome
      │
      ▼ (debrief via gpt-4o-mini, max_tokens=300)
{ turns, summary { debrief { score, critique } } }
      │
      ▼
Audit log built client-side → .md download
```

---

## State Management

### Server-side (in-memory only, no DB)

| Store | Location | Lifetime |
|-------|---------|---------|
| Arena sessions (`Map<id, ArenaSession>`) | `arena.ts` | Deleted 5 min after `finish` |
| AI call ring buffer (200 calls) | `ai-tracker.ts` | Process lifetime |
| Session usage summaries | `ai-tracker.ts` | 10 min after `closeSession()` |
| Route & global aggregates | `ai-tracker.ts` | Process lifetime |

**Server restart = all session and arena data lost.**

### Client-side (localStorage)

| Key | Purpose |
|-----|---------|
| `sc_lang` | Language preference (es/en) |
| `sc_context_label` | Last used context label |
| `cwiz-debug-pinned` | Debug panel pin state |
| `cwiz-debug-open` | Debug panel open state |
| `cwiz-debug-detail` | Debug panel detail open state |

The copilot session (context text, turn log, call memory) lives in React state only and is lost on page refresh.

---

## AI Model

All AI calls use **gpt-4o-mini** exclusively.

Pricing:
- Input: $0.00015 per 1K tokens ($0.15 per 1M)
- Output: $0.0006 per 1K tokens ($0.60 per 1M)

---

## Language Support

All user-facing text and prompts support **ES** (Spanish, default) and **EN** (English). The language toggle is stored in localStorage and sent with every API request as the `lang` field.

---

## Accessibility Notes

- Color palette uses sky-blue, amber, and teal instead of red/green to accommodate colorblindness.
- Debug panel alerts use sky-400 (latency), amber-300 (cost), amber-400 (vigilar), zinc-500 (normal).
