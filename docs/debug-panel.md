# VELA — Debug Panel

`artifacts/silent-closer/src/components/debug-panel.tsx`

The debug panel is a developer overlay that displays real-time AI usage statistics. It is always rendered in all three return paths of `copilot.tsx` and on the `arena.tsx` page.

---

## Layout

```
┌─────────────────────────────────────────────┐
│ [●] DEBUG  [!] CARA  ◐ LATENCIA ALTA   [X] │  ← header row
├─────────────────────────────────────────────┤
│ ESTA SESIÓN                                  │
│ $0.0042  1 820tok  12 llamadas  834ms avg   │  ← KPIs
├─────────────────────────────────────────────┤
│ GLOBAL DESDE INICIO                          │
│ $0.018  total tok: 65k  llamadas: 47        │
│ Top ruta: copilot/analyze ($0.014)           │
├─────────────────────────────────────────────┤
│ [Ver detalle ▾]                              │  ← collapsible
│   Filtrar: Todos Copilot Arena               │
│   [Sesiones] [Rutas] [Llamadas]              │
│   ... table rows ...                         │
└─────────────────────────────────────────────┘
```

---

## Alert System

The panel computes an alert level from session stats. Colorblind-safe palette (no red for important info).

| Level | Condition | Color |
|-------|-----------|-------|
| `LATENCIA ALTA` | `avgLatencyMs > 2000ms` | sky-400 |
| `CARA` | `totalCostUsd > $0.05` | amber-300 |
| `VIGILAR` | cost > $0.015 OR latency > 1400ms OR calls > 25 | amber-400 |
| `NORMAL` | None of the above | zinc-500 |

Alert levels are evaluated in priority order: LATENCIA ALTA → CARA → VIGILAR → NORMAL.

The active alert level is displayed in the panel header next to the panel title.

---

## Dominant Route Badge

If one route accounts for more than 70% of the session's total spend, a badge is shown: e.g. `copilot/analyze (>70%)`.

---

## Pin / Unpin

- **Unpinned (default):** A semi-transparent backdrop covers the UI; the panel is a fixed overlay. User must interact with the panel or close it to use the app.
- **Pinned:** No backdrop. The panel stays visible but clicks pass through to the underlying app. Pin state is saved to `localStorage` (`cwiz-debug-pinned`).

Pin/unpin uses a Pin / PinOff icon button in the panel header.

---

## Persistence (localStorage)

| Key | Value |
|-----|-------|
| `cwiz-debug-pinned` | `"true"` or `"false"` |
| `cwiz-debug-open` | `"true"` or `"false"` |
| `cwiz-debug-detail` | `"true"` or `"false"` (detail accordion state) |

---

## Detail Accordion

Toggled with "Ver detalle" / "Ocultar detalle". Contains three tabs:

### Mode filter

All calls can be filtered by mode: `Todos` / `Copilot` / `Arena`.

### Tabs

**Sesiones** — table of session summaries (cost, tokens, calls, avg latency, last call time)  
**Rutas** — table of route aggregates (calls, total tokens, total cost, avg latency, avg in/out tokens)  
**Llamadas** — last 50 individual AI calls from the ring buffer (route, endpoint, in/out tokens, cost, latency, status)

---

## Data Source

The panel polls `GET /api/debug/usage` every **5 seconds** when it is open. Polling is managed with `setInterval` and cleared on unmount or when the panel is closed.

Session stats displayed in the "ESTA SESIÓN" block come from the current `sessionId` in the snapshot's `sessions` array.

---

## Z-Index

| Element | z-index |
|---------|---------|
| Backdrop (unpinned) | z-49 |
| Panel | z-50 |

---

## Trigger

The debug panel has no visible trigger button in normal use. It is opened by a keyboard shortcut or internal dev mechanism (implementation-specific). Once open, close with the `[X]` button.
