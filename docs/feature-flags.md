# Closer Wizard — Feature Flags

Feature flags are set as environment variables on the API server process. They default to production-optimized values when not set.

---

## `LEGACY_PROMPTS`

**Default:** `false` (optimized V2 prompt)

| Value | Behaviour |
|-------|-----------|
| unset / `"false"` | V2 copilot prompt (~700 input tokens, compact, structured) |
| `"true"` | V1 copilot prompt (~2100 input tokens, verbose, with examples) |

The V1 prompt is functionally equivalent to V2 but costs ~3× more per analyze call. Use V1 only to debug prompt regression issues or when the V2 prompt is producing incorrect output.

**Impact:** Only affects `POST /api/copilot/analyze`. No effect on summarize, context-label, or Arena routes.

---

## `LEGACY_ARENA`

**Default:** `false` (optimized arena)

| Value | Behaviour |
|-------|-----------|
| unset / `"false"` | Windowed history (last 12 turns), conditional terminal detection |
| `"true"` | Full history every turn, terminal detection runs every turn after turn 4 |

### Optimized mode (default)

- History window: only the **last 12 turns** are sent to the model per turn response
- Terminal state detection: only runs on keyword match OR every 3 turns after turn 6
- Debrief transcript: capped at last 15 turns
- Suggest transcript: capped at last 10 turns

### Legacy mode

- Full `session.turns` array sent on every request
- Terminal detection runs after every turn (≥ turn 4), regardless of keywords
- No transcript caps for debrief or suggest

Use `LEGACY_ARENA=true` to debug arena consistency issues on very long sessions, or to compare token spend against the optimized mode.

**Impact:** Affects `POST /api/arena/turn`, `POST /api/arena/suggest`, and `POST /api/arena/finish`.

---

## Setting Flags

In development, set them in the shell before starting the API server:

```bash
LEGACY_PROMPTS=true pnpm --filter @workspace/api-server run dev
```

Or via the Replit environment secrets / `.env` file on the API server.

---

## Cost Comparison

| Mode | Copilot analyze cost/call (approx) | Arena turn cost/call (approx) |
|------|------------------------------------|-------------------------------|
| Optimized (default) | ~$0.00037 | ~$0.00025 (windowed) |
| Legacy | ~$0.00110 | ~$0.00040+ (full history) |

Numbers are rough estimates at gpt-4o-mini pricing assuming average conversation lengths.
