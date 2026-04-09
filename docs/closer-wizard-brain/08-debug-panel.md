# VELA — Debug Panel

`artifacts/silent-closer/src/components/debug-panel.tsx`

El debug panel es un overlay para developers que muestra estadísticas de uso de IA en tiempo real. Siempre se renderiza en los 3 return paths de `copilot.tsx` y en la página `arena.tsx`.

---

## Layout

```
┌─────────────────────────────────────────────┐
│ [●] DEBUG  [!] CARA  ◐ LATENCIA ALTA   [X] │  ← fila de header
├─────────────────────────────────────────────┤
│ ESTA SESIÓN                                  │
│ $0.0042  1 820tok  12 llamadas  834ms avg   │  ← KPIs
├─────────────────────────────────────────────┤
│ GLOBAL DESDE INICIO                          │
│ $0.018  total tok: 65k  llamadas: 47        │
│ Top ruta: copilot/analyze ($0.014)           │
├─────────────────────────────────────────────┤
│ [Ver detalle ▾]                              │  ← colapsable
│   Filtrar: Todos Copilot Arena               │
│   [Sesiones] [Rutas] [Llamadas]              │
│   ... filas de tabla ...                     │
└─────────────────────────────────────────────┘
```

---

## Sistema de alertas

El panel calcula un nivel de alerta a partir de las stats de sesión. Paleta colorblind-safe (sin rojo para información importante).

| Nivel | Condición | Color |
|-------|-----------|-------|
| `LATENCIA ALTA` | `avgLatencyMs > 2000ms` | sky-400 |
| `CARA` | `totalCostUsd > $0.05` | amber-300 |
| `VIGILAR` | coste > $0.015 O latencia > 1400ms O llamadas > 25 | amber-400 |
| `NORMAL` | Ninguna de las anteriores | zinc-500 |

Los niveles de alerta se evalúan en orden de prioridad: LATENCIA ALTA → CARA → VIGILAR → NORMAL.

El nivel de alerta activo se muestra en el header del panel junto al título.

---

## Badge de ruta dominante

Si una ruta representa más del 70% del gasto total de la sesión, se muestra un badge: e.g. `copilot/analyze (>70%)`.

---

## Pin / Unpin

- **Sin pin (default):** Un backdrop semitransparente cubre la UI; el panel es un overlay fijo. El usuario debe interactuar con el panel o cerrarlo para usar la app.
- **Con pin:** Sin backdrop. El panel permanece visible pero los clicks pasan a través a la app subyacente. El estado de pin se guarda en `localStorage` (`cwiz-debug-pinned`).

Pin/unpin usa un botón de icono Pin / PinOff en el header del panel.

---

## Persistencia (localStorage)

| Clave | Valor |
|-------|-------|
| `cwiz-debug-pinned` | `"true"` o `"false"` |
| `cwiz-debug-open` | `"true"` o `"false"` |
| `cwiz-debug-detail` | `"true"` o `"false"` (estado del acordeón de detalle) |

---

## Acordeón de detalle

Se activa con "Ver detalle" / "Ocultar detalle". Contiene tres tabs:

### Filtro de modo

Todas las llamadas se pueden filtrar por modo: `Todos` / `Copilot` / `Arena`.

### Tabs

**Sesiones** — tabla de resúmenes de sesión (coste, tokens, llamadas, latencia avg, hora de última llamada)  
**Rutas** — tabla de agregados por ruta (llamadas, tokens totales, coste total, latencia avg, tokens in/out avg)  
**Llamadas** — últimas 50 llamadas IA individuales del ring buffer (ruta, endpoint, tokens in/out, coste, latencia, status)

---

## Fuente de datos

El panel consulta `GET /api/debug/usage` cada **5 segundos** cuando está abierto. El polling se gestiona con `setInterval` y se limpia al desmontar o cuando el panel se cierra.

Las stats de sesión mostradas en el bloque "ESTA SESIÓN" vienen del `sessionId` actual en el array `sessions` del snapshot.

---

## Z-Index

| Elemento | z-index |
|----------|---------|
| Backdrop (sin pin) | z-49 |
| Panel | z-50 |

---

## Activación

El debug panel no tiene un botón visible en uso normal. Se abre mediante un atajo de teclado o mecanismo interno de dev (específico de la implementación). Una vez abierto, se cierra con el botón `[X]`.
