# 09 — Feature Flags

_Generado: 2026-04-09 · VELA internal docs_

---

## Flags de comportamiento (booleanos por env)

Hay exactamente **2 feature flags** en el proyecto. Ambos son de tipo "legacy escape hatch": `false` (default) activa la ruta optimizada; `"true"` activa la ruta antigua.

---

### `LEGACY_PROMPTS`

**Archivo:** `artifacts/api-server/src/routes/copilot.ts`, línea 21

```ts
const USE_OPTIMIZED_PROMPTS = process.env["LEGACY_PROMPTS"] !== "true";
const BASE_SYSTEM_PROMPT = USE_OPTIMIZED_PROMPTS ? BASE_SYSTEM_PROMPT_V2 : BASE_SYSTEM_PROMPT_V1;
```

**Qué cambia:**

| Estado | Prompt activo | Tokens aprox. | Uso |
|---|---|---|---|
| `false` (default) | V2 — comprimido | ~700 | Producción normal |
| `"true"` | V1 — verbose | ~2100 | Debug de regresiones |

- Solo afecta al `BASE_SYSTEM_PROMPT` del route `/copilot`.
- El prompt V1 incluye ejemplos extensos y fue el prompt original antes de la compresión.
- El prompt V2 es la versión vigente, ~3× más barata por llamada.
- Ambos están definidos como constantes en el mismo archivo y coexisten en el código.

**Cuándo activarlo:** si el Copilot da respuestas degradadas y se sospecha que la compresión del prompt eliminó algo necesario. Se activa, se compara, se identifica la regresión, se parchea V2 y se vuelve a `false`.

---

### `LEGACY_ARENA`

**Archivo:** `artifacts/api-server/src/routes/arena.ts`, línea 49

```ts
const USE_OPTIMIZED_ARENA = process.env["LEGACY_ARENA"] !== "true";
```

**Qué cambia:**

| Comportamiento | `false` (default) | `"true"` |
|---|---|---|
| Historia enviada al modelo | Ventana de últimos `ARENA_HISTORY_WINDOW = 12` turnos | Historia completa siempre |
| Terminal detection | Condicional: keywords O cada 3 turnos desde el turno 6 | Forzada desde el turno 4 en adelante (cada turno) |
| Debrief | Últimos `DEBRIEF_MAX_TURNS = 15` turnos | Todos los turnos |
| Suggest | Últimos `SUGGEST_MAX_TURNS = 10` turnos | Todos los turnos |

**Constantes relacionadas (no modificables por env):**

| Constante | Valor | Descripción |
|---|---|---|
| `ARENA_HISTORY_WINDOW` | 12 | Turnos máximos enviados al modelo en cada turn |
| `DEBRIEF_MAX_TURNS` | 15 | Turnos máximos usados en debrief |
| `SUGGEST_MAX_TURNS` | 10 | Turnos máximos usados en suggest |

**Lógica de `shouldCheckTerminal`** (con `LEGACY_ARENA=false`):
```
si turns < 4 → skip
si turns >= 6 Y turns % 3 === 0 → checkear siempre (safety net)
si último mensaje de la IA contiene keyword terminal → checkear
```

**Cuándo activarlo:** si la IA en Arena pierde coherencia de contexto por windowing o si terminal detection falla en conversaciones largas. Se usa para diagnosticar.

---

## Variables de entorno del sistema (no son feature flags, son requeridas)

| Variable | Archivo | Comportamiento | Requerida |
|---|---|---|---|
| `PORT` | `artifacts/api-server/src/index.ts` | Puerto del servidor API. Falla con error explícito si no está presente. | Sí |
| `NODE_ENV` | `artifacts/api-server/src/lib/logger.ts` | `"production"` → logger pino sin pretty-print. Dev/staging → `pino-pretty` con color. | No (default: dev) |
| `LOG_LEVEL` | `artifacts/api-server/src/lib/logger.ts` | Nivel mínimo de log. Default: `"info"`. Opciones pino estándar: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. | No |
| `DATABASE_URL` | `lib/db/src/index.ts` | Connection string PostgreSQL. Requerida para la capa de DB. | Sí |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | `lib/integrations-openai-ai-server/src/client.ts` | API key de OpenAI. Gestionada por Replit integrations. | Sí |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | `lib/integrations-openai-ai-server/src/client.ts` | Base URL para llamadas OpenAI. Gestionada por Replit integrations. | Sí |
| `SESSION_SECRET` | sesión Express | Secret para firma de cookies de sesión. Gestionado por Replit secrets. | Sí |

---

## Cómo activar un flag (Replit)

Los flags se activan desde el panel de Environment Variables de Replit (no en `.env` ni en código). Cambiar un flag requiere **reiniciar el servidor API** porque se evalúan al carga del módulo (`const USE_OPTIMIZED_PROMPTS = ...` es constante de módulo, no se re-evalúa por request).

---

## Zonas ambiguas

- No existe un flag de "modo debug" o "modo verbose" para el frontend. El debug panel no tiene flag; siempre se compila.
- No hay flags de A/B testing ni de feature rollout progresivo.
- `LEGACY_PROMPTS` y `LEGACY_ARENA` son completamente independientes; pueden activarse juntos sin conflicto.
