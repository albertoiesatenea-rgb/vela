# 01 — CURRENT STATE
_Generated: 2026-04-09_

## What exists and works today

### Two modes, one app
- **Copilot** — real-time tactical coach listening to an actual sales call. User pastes fragments; AI returns JSON signal.
- **Arena** — role-play simulation. User can play seller (AI plays client) or client (AI plays seller). Full session lifecycle: start → turns → finish → debrief + brutal audit.

### Infrastructure
- Monorepo managed with pnpm.
- API server: Express on port 8080. All routes prefixed `/api/`.
- Frontend: React + Vite, single artifact at root `/`.
- AI: `gpt-4o-mini` for all calls. Key managed via Replit integration (no `.env` file needed).
- In-memory only — no database. Arena sessions and AI tracker data lost on server restart.
- Language toggle: `es` / `en`. All prompts are bilingual (separate branches, not translation).

### Copilot mode — current feature set
- Paste or listen (auto-batch) conversation fragments.
- Returns JSON: `signal`, `say_now`, `avoid`, `detail` (reading/mission/next_move/support), `journey`, `call_memory`, `momentum`.
- `momentum`: green / amber / red. Displayed as a visual indicator.
- End-of-call: declare outcome → `/api/copilot/summarize` → score, global_state, strengths, improvements, optional full_report.
- Brutal post-session audit: lazy-loaded block, calls `/api/copilot/audit-report`. Returns `BrutalAudit` JSON.
- Downloadable audit log as `.md` file (full forensic log via `triggerAuditLogDownload`).
- Context panel: session context textarea + AI-generated 4-6 word label (`/api/copilot/context-label`).

### Arena mode — current feature set
- Role: seller (AI = client) or client (AI = seller).
- Configurable: `clientProfile`, `sellerProfile`, `difficulty`, `randomPreset`.
- Preset context auto-generation: 1st person POV matching user role, role-concordant. Immvest uses 120 tokens, others 65.
- Role-switch context adaptation: `/api/arena/adapt-context` rewrites existing context for opposite role.
- Opening message: AI generates the first line of conversation (150 tokens, temp default).
- Per-turn: terminal detection + coachLite + journey run in parallel after each AI response.
  - CoachLite: 3-line tactical annotation. Client mode only.
  - Journey: 6-stage pipeline status (context/problem/blocker/fit/advance/close). Client mode only.
- Shortcut buttons (client mode): "agree" / "object" — generates a plausible client response.
- Seller notes (client mode): user can inject constraints for the AI seller mid-session → `/api/arena/repitch` rewrites AI position.
- Suggest: `/api/arena/suggest` — generates the ideal seller response for current moment.
- Finish: `/api/arena/finish` → debrief (seller mode only, score 1-10 + 3 critique lines).
- Brutal post-session audit: lazy-loaded block, calls `/api/arena/audit-report`. Role-aware (evaluates user as seller or evaluates AI seller quality if user was client).
- Downloadable audit log as `.md`.

### Post-session features (both modes)
- **Debrief** (Arena seller only): score + 3 actionable critique lines from gpt-4o-mini.
- **Brutal audit** (both modes): 10-field JSON — verdict, what_worked, what_failed, failure_owner, missed_closes, rules_violated, priority_changes, what_i_would_have_done, prompt_patch, prompt_for_replit.
- **Full report** (Copilot only): optional detailed text report generated with summarize.
- **Audit log download**: `.md` file with full forensic session data.

### Shared library: `@workspace/sales-brain`
Central source of truth for commercial logic:
- `CLIENT_PROFILE_DESC` — 7 profiles (analytical, emotional, skeptical, cautious, dominant, indecisive, negotiator)
- `SELLER_PROFILE_DESC` — 6 profiles (communicative, authoritative, technical, passive, aggressive, consultive)
- `DIFFICULTY_DESC` — 4 levels (easy, normal, hard, brutal)
- `PRESET_SYSTEM_DESC` — 6 presets (immvest, saas, b2b, high_ticket, coaching, challenge)
- `DEBRIEF_CLIENT_PROFILE` — debrief coaching hints per profile
- `OBJECTION_TAXONOMY` + `OBJECTION_TAXONOMY_BLOCK` — 14 objection/signal types
- `JOURNEY_STAGES` — 6 stages
- `CLOSING_CRITERIA_BLOCK` — 5 closing conditions
- `SALES_ANTIPATTERNS_BLOCK` — 9 forbidden patterns
- `COMPARISON_RULE_BLOCK` — comparison / alternative handling
- `SALES_HEURISTICS` — 10 decision heuristics

### AI tracking
`ai-tracker.ts` — in-memory observability layer:
- Logs every OpenAI call: route, endpoint, tokens (prompt/completion/total), cost (USD), latency, session.
- Ring buffer of 200 recent calls.
- Route-level and session-level aggregates (rolling averages).
- `/api/debug/usage` endpoint exposes full snapshot.
- `closeSession()` called at Arena finish — logs totals, keeps record 10 min.

### Known limitations / known state
- No persistence: all session data lost on restart.
- `context.objective`, `context.known_objections`, `context.relevant_data` in audit log are always `null` (not parsed from raw context — planned but not implemented).
- `strongest_moment` / `weakest_moment` in SessionSummary always `null` (not implemented).
- CoachLite `latencyMs` hardcoded to 0 (tracking bug — parallel call, start time not captured).
- Journey latencyMs also hardcoded to 0.
- Arena profile aliases: `insecure` → `cautious`, `hard_negotiator` → `negotiator`, `random`/`aleatorio` → undefined (no profile).
