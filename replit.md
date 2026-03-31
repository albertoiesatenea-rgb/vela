# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: OpenAI via Replit AI Integrations (gpt-4o-mini)
- **Frontend**: React + Vite + Tailwind + Framer Motion

## Project: Silent Closer Copilot

A single-screen, ultraminimalist sales call assistant for use on a second screen during calls.

### Features
- **ESCUCHAR mode**: Uses Web Speech API (SpeechRecognition) for live transcription. Sends buffered text to analysis API every 8 seconds. Works in Chrome/Edge.
- **SIMULAR mode**: Paste conversation text manually, click Analizar to get tactical advice.
- **Tactical engine**: POST /api/copilot/analyze → { signal, say_now, avoid }
- **UI**: Pure black background, large centered text, SEÑAL / DI AHORA / EVITA layout, smooth Framer Motion transitions.
- **Arena mode**: Separate chat-based conversation simulator. User picks "Yo soy vendedor" or "Yo soy cliente", AI plays the opposite role. Routes: POST /api/arena/start, /api/arena/turn, /api/arena/finish. In-memory sessions. Exportable unified audit log (.md). Completely separate UX from Copilot mode.
- **Arena profiles**: Client personality profiles (analítico, emocional, inseguro, arrogante, indeciso, duro) when user is seller. Seller profiles (comunicativo, autoritario, técnico, pasivo, agresivo, consultivo) when user is client. Difficulty levels (fácil, normal, difícil, brutal) for seller role. Random context generator (shuffle button). ArenaAdvancedForm with role-specific step questions. Profiles/difficulty injected into system prompts on the backend.
- **Unified Audit Log**: `artifacts/silent-closer/src/lib/audit-log.ts` — shared module for both Copiloto and Arena. Types: AuditLog, SessionMeta, SessionContext, SessionConfig, AuditTurn, CopilotTurnData, ArenaTurnData, SessionSummary, AuditHints. Functions: buildCopilotAuditLog(), buildArenaAuditLog(), renderAuditLogMarkdown(), triggerAuditLogDownload(). Output: forensic markdown (.md) compatible with Closer Wizard Auditor GPT.

### Codebase notes
- `src/components/ui/` only contains the 4 components actually used: `card.tsx`, `toast.tsx`, `toaster.tsx`, `tooltip.tsx`. All other shadcn/ui scaffolding was removed.
- `src/hooks/` only contains `use-speech.ts`, `use-theme.ts`, `use-toast.ts`. `use-mobile.tsx` was removed (had no live references).
- `api-server/src/lib/ai-tracker.ts` — exports: `estimateModelCost`, `logAICall`, `closeSession`, `getSessionStats`, `getUsageSnapshot`. Deprecated aliases `estimateCost` / `logSessionTotal` removed.
- Copilot page: `DOWNLOAD_TRAINING` key and `buildTrainingTranscript` / `handleDownloadTraining` dead code removed. The `.md` audit log download (`DOWNLOAD_AUDIT`) is the only download action.

### Known limitations (first MVP)
- Mic mode requires Chrome/Edge (Web Speech API)
- Mic requires HTTPS in production (works in deployed app, may not work in Replit iframe preview)
- Use SIMULAR mode to test the AI engine directly

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── silent-closer/      # React + Vite frontend (main app)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   ├── integrations-openai-ai-server/  # OpenAI server-side client
│   └── integrations-openai-ai-react/   # OpenAI React hooks
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## API Routes

- `GET /api/healthz` — Health check
- `POST /api/copilot/analyze` — Tactical analysis engine
  - Body: `{ text: string }` — conversation fragment
  - Returns: `{ signal: string, say_now: string, avoid: string }`

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes in `src/routes/`.

- Entry: `src/index.ts`
- App setup: `src/app.ts`
- Routes: `health.ts`, `copilot.ts`
- Depends on: `@workspace/db`, `@workspace/api-zod`, `@workspace/integrations-openai-ai-server`

### `artifacts/silent-closer` (`@workspace/silent-closer`)

Main frontend app. Single-page, pure black UI.

- `src/pages/copilot.tsx` — main page with mode toggle
- `src/components/tactical-display.tsx` — the main tactical HUD
- `src/hooks/use-speech.ts` — Web Speech API integration

### `lib/sales-brain` (`@workspace/sales-brain`)

Fuente de verdad comercial compartida entre Copilot y Arena. Centraliza:
- `CLIENT_PROFILE_DESC` / `SELLER_PROFILE_DESC` / `DIFFICULTY_DESC` — perfiles de personalidad para el juego de Arena
- `DEBRIEF_CLIENT_PROFILE` — criterios de evaluación por perfil (para el coach/debrief de Arena)
- `PRESET_SYSTEM_DESC` — descriptores de los 6 presets de Arena (immvest, saas, b2b, high_ticket, coaching, challenge)
- `OBJECTION_TAXONOMY` / `OBJECTION_TAXONOMY_BLOCK` — taxonomía canónica de señales y objeciones
- `JOURNEY_STAGES` — modelo de 6 fases del journey comercial (context → problem → blocker → fit → advance → close)
- `CLOSING_CRITERIA_BLOCK` — condiciones para recomendar cierre
- `COMPARISON_RULE_BLOCK` — regla de alternativas: la alternativa revela el criterio
- `SALES_ANTIPATTERNS_BLOCK` — lista PROHIBIDO de anti-patrones tácticos
- `SALES_HEURISTICS` / `buildHeuristicsBlock()` — reglas de decisión acumulativas (mini-formaciones)

Para añadir una mini-formación de ventas: editar `SALES_HEURISTICS` en `lib/sales-brain/src/index.ts` y añadir entrada al changelog del archivo. El cambio se propaga automáticamente a todas las superficies que usan el bloque.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec. Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/integrations-openai-ai-server` (`@workspace/integrations-openai-ai-server`)

Server-side OpenAI client using Replit AI Integrations proxy.
