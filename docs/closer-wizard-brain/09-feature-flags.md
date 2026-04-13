# VELA — Feature Flags

Los feature flags se establecen como variables de entorno en el proceso del API server. Tienen valores optimizados para producción cuando no están definidos.

---

## `LEGACY_PROMPTS`

**Default:** `false` (prompt V2 optimizado)

| Valor | Comportamiento |
|-------|---------------|
| sin definir / `"false"` | Prompt de copiloto V2 (~700 tokens de sistema, compacto, con conversation_history) |
| `"true"` | Prompt de copiloto V1 (~2100 tokens de sistema, verboso, con ejemplos) |

El prompt V1 es funcionalmente equivalente al V2 pero cuesta ~3× más por llamada de analyze. Ambos usan `gpt-4o`. Usar V1 solo para depurar regresiones de prompt.

**Impacto:** Solo afecta a `POST /api/copilot/analyze`. Sin efecto en summarize, context-label, o rutas de Arena.

---

## `LEGACY_ARENA`

**Default:** `false` (arena optimizada)

| Valor | Comportamiento |
|-------|---------------|
| sin definir / `"false"` | Historial con windowing (últimos 12 turnos), detección terminal condicional |
| `"true"` | Historial completo en cada turno, detección terminal en cada turno tras el 4 |

### Modo optimizado (default)

- Ventana de historial: solo los **últimos 12 turnos** se envían al modelo por respuesta de turno
- Detección de estado terminal: solo corre en keyword match O cada 3 turnos tras el turno 6
- Transcripción del debrief: limitada a los últimos 15 turnos
- Transcripción del suggest: limitada a los últimos 10 turnos
- CoachLite y Journey: usan ventana de 12 turnos

### Modo legacy

- Array `session.turns` completo enviado en cada petición
- Detección terminal en cada turno (≥ turno 4), independientemente de keywords
- Sin límites de transcripción para debrief o suggest

Usar `LEGACY_ARENA=true` para depurar problemas de consistencia de la IA en sesiones muy largas.

**Impacto:** Afecta a `POST /api/arena/turn`, `POST /api/arena/suggest`, y `POST /api/arena/finish`.

---

## Cómo establecer los flags

En desarrollo, establecerlos en la shell antes de arrancar el API server:

```bash
LEGACY_PROMPTS=true pnpm --filter @workspace/api-server run dev
LEGACY_ARENA=true pnpm --filter @workspace/api-server run dev
```

O via las environment variables / secrets de Replit en el API server.

---

## Comparativa de coste (estimado)

Los precios a continuación son aproximados con longitudes de conversación medias.

| Modo | Coste por llamada copilot/analyze | Coste por turno Arena (gpt-4o) |
|------|----------------------------------|-------------------------------|
| Optimizado (default) | ~$0.0060 | ~$0.0045 (windowed) |
| Legacy | ~$0.0180 | ~$0.0090+ (historial completo) |

**Nota:** El modelo de analyze y arena/turn principal es ahora `gpt-4o` (~16× más caro por token de output que gpt-4o-mini). El coste por sesión es significativamente mayor que en versiones anteriores que usaban gpt-4o-mini para estas llamadas.

Las llamadas auxiliares (terminal-state, coach-lite, journey, suggest, debrief, etc.) siguen siendo `gpt-4o-mini` y tienen coste marginal comparado con el turno principal.
