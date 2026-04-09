# VELA — Feature Flags

Los feature flags se establecen como variables de entorno en el proceso del API server. Tienen valores optimizados para producción cuando no están definidos.

---

## `LEGACY_PROMPTS`

**Default:** `false` (prompt V2 optimizado)

| Valor | Comportamiento |
|-------|---------------|
| sin definir / `"false"` | Prompt de copiloto V2 (~700 tokens de entrada, compacto, estructurado) |
| `"true"` | Prompt de copiloto V1 (~2100 tokens de entrada, verboso, con ejemplos) |

El prompt V1 es funcionalmente equivalente al V2 pero cuesta ~3× más por llamada de analyze. Usar V1 solo para depurar regresiones de prompt o cuando el prompt V2 produce output incorrecto.

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

### Modo legacy

- Array `session.turns` completo enviado en cada petición
- Detección terminal en cada turno (≥ turno 4), independientemente de keywords
- Sin límites de transcripción para debrief o suggest

Usar `LEGACY_ARENA=true` para depurar problemas de consistencia de la IA en sesiones muy largas, o para comparar gasto de tokens contra el modo optimizado.

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

## Comparativa de coste

| Modo | Coste por llamada analyze (aprox) | Coste por turno Arena (aprox) |
|------|----------------------------------|------------------------------|
| Optimizado (default) | ~$0.00037 | ~$0.00025 (windowed) |
| Legacy | ~$0.00110 | ~$0.00040+ (historial completo) |

Números aproximados con precios de gpt-4o-mini asumiendo longitudes de conversación medias.
