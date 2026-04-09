# 08 — Debug Panel (AI Monitor)

_Generado: 2026-04-09 · VELA internal docs_

---

## Qué es

Panel de observabilidad para desarrolladores. Monitoriza en tiempo real el coste, tokens, latencia y estado de sesión de cada llamada AI que hace la aplicación. No tiene lógica de negocio; es solo una vista de los datos que acumula `ai-tracker.ts`.

**Nombre visible en UI:** "AI Monitor"  
**Identificador informal:** "Debug Panel"

---

## Activación

| Método | Detalle |
|---|---|
| Botón `AI $` | Fijo en `bottom-right`, `z-40`. Muestra el coste de la sesión actual o el total global si no hay sesión activa. |
| Teclado | `Ctrl+Shift+D` (o `Cmd+Shift+D` en Mac). `Escape` cierra si no está fijado. |

El botón siempre está visible. El coste del label se actualiza cada 4 segundos incluso con el panel cerrado.

---

## Archivos involucrados

| Rol | Ruta |
|---|---|
| UI + polling | `artifacts/silent-closer/src/components/debug-panel.tsx` |
| Tracker (in-memory) | `artifacts/api-server/src/lib/ai-tracker.ts` |
| Endpoint | `artifacts/api-server/src/routes/debug.ts` |
| Integrado en páginas | `copilot.tsx` (líneas 12, 1146, 1269, 1466), `arena.tsx` (líneas 7, 1968) |

---

## Endpoint

```
GET /api/debug/usage
```

Responde con un `UsageSnapshot`:

```ts
interface UsageSnapshot {
  serverStartedAt: string;
  global: { calls: number; totalTokens: number; totalCostUsd: number };
  routes: RouteStats[];
  sessions: SessionStats[];
  recentCalls: RecentCall[];
}
```

La ruta es un wrapper mínimo: llama a `getUsageSnapshot()` del tracker y devuelve JSON. No requiere auth. No escribe nada.

---

## Polling

- Intervalo: **4 segundos** fijo mediante `setInterval`.
- Siempre activo (no se pausa cuando el panel está cerrado).
- El coste del botón se actualiza en cada poll.

---

## Estado persistido en localStorage

| Clave | Tipo | Descripción |
|---|---|---|
| `cwiz-debug-pinned` | boolean | Panel fijado (no se cierra al hacer clic fuera) |
| `cwiz-debug-open` | boolean | Panel abierto/cerrado |
| `cwiz-debug-detail` | boolean | Sección de detalle expandida |

---

## Estructura del panel

### Sección: Sesión actual
- Muestra coste, tokens, llamadas y latencia media de **la sesión actual** (filtrada por `sessionId` prop).
- Si no hay sesión, muestra "Sin sesión activa".
- Incluye badge de alerta:

| Badge | Color | Condición |
|---|---|---|
| `LATENCIA ALTA` | sky-400 | `avgLatencyMs > 2000` |
| `CARA` | amber-300 | `totalCostUsd > 0.05` |
| `VIGILAR` | amber-400 | `cost > 0.015` OR `latency > 1400ms` OR `calls > 25` |
| `NORMAL` | zinc-500 | todo lo demás |

### Sección: Global · desde arranque
- Totales acumulados desde que arrancó el servidor (se resetean al reiniciar).
- Muestra la ruta dominante si una ruta concentra >70% del coste total.

### Sección: Detalle (colapsable)
Activada por el usuario. Incluye:

**Filtro de modo:** `Todo | copilot | arena`

**Tabs:**
- `Sesiones` — tabla con ID (7 chars), modo, calls, tokens, coste, latencia, estado
- `Rutas` — tabla con endpoint, calls, tokens, coste, latencia media
- `Llamadas` — últimas 50 llamadas del ring buffer de 200

---

## Heavy-call notification

Chip temporal (`⚡`) que aparece sobre el botón cuando una llamada supera los umbrales:

| Umbral | Valor |
|---|---|
| Absoluto (`HEAVY_ABS`) | ≥ 900 tokens en una sola llamada |
| Relativo (`HEAVY_MULT`) | ≥ 1.75× el promedio de la sesión (requiere ≥ 3 llamadas previas, `HEAVY_MIN_N`) |

Comportamiento del chip:
- Aparece con transición CSS (300ms).
- Se oculta automáticamente a los 3.1s.
- El componente se desmonta a los 3.6s.
- Si llega otra heavy-call antes de que expire, los timers se cancelan y el chip se renueva.

---

## Comportamiento del backdrop

- Cuando el panel está **abierto y NO fijado**: hay un div de backdrop `inset-0 z-49` que captura clics fuera del panel y lo cierra.
- Cuando está **fijado**: el backdrop desaparece; el panel es un overlay transparente que no bloquea interacción con la app.

---

## Limitaciones conocidas

- Los datos son **in-memory**: se pierden al reiniciar el servidor API.
- `audit-report` (copilot y arena) no llama a `logAICall()` → sus tokens no aparecen en el panel.
- `latencyMs` de CoachLite y Journey siempre aparece como `0` (bug de tracking: el tiempo de inicio no se captura en llamadas paralelas).
- El panel no soporta múltiples clientes simultáneos: el `sessionId` prop filtra la vista de "Sesión actual", pero el global y las rutas son compartidos entre todos.
