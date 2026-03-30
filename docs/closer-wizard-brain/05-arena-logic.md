# Closer Wizard — Arena Logic

Arena es un simulador de conversación de ventas donde el usuario practica vendiendo (o siendo vendido) contra una IA.

---

## Lifecycle de sesión

```
POST /api/arena/start
  └─ Crea ArenaSession en memoria del servidor
  └─ IA genera mensaje de apertura (max_tokens=150)
  └─ Devuelve { arenaSessionId, openingMessage }

Usuario envía mensaje → POST /api/arena/turn  (se repite)
  └─ Añade turno del usuario a session.turns
  └─ IA genera respuesta (max_tokens=300, historial con windowing)
  └─ Detección de estado terminal condicional (max_tokens=5)
  └─ Devuelve { aiMessage, terminalSignal }

Sesión termina (detectado o manual) → POST /api/arena/finish
  └─ Genera debrief si role=seller
  └─ Llama closeSession() en ai-tracker (mantiene stats 10 min)
  └─ Devuelve { turns, summary }
  └─ Sesión en memoria eliminada tras 5 min timeout
```

---

## Roles

| Rol del usuario | IA juega de |
|----------------|------------|
| `seller` | Cliente/prospecto — configurado con personalidad y dificultad |
| `client` | Vendedor/consultor — configurado con personalidad de vendedor |

En seller mode la IA juega de prospecto realista y la detección terminal está activa. En client mode la IA juega de consultor y la detección terminal está desactivada.

---

## Personalidades de cliente (`clientProfile`)

| Clave | Descripción |
|-------|-------------|
| `analytical` | Necesitas datos, precisión, proceso y evidencia antes de decidir. Haces preguntas técnicas. Rechazas vaguedades. |
| `emotional` | Decides por confianza, conexión y sensación personal. Te influyen historias reales y la empatía del vendedor. |
| `skeptical` | Desconfías por defecto. Cuestionas promesas y claims inflados. Solo te convencen pruebas concretas y consistencia. |
| `cautious` | Temes equivocarte. Buscas seguridad, validación externa y pasos reversibles. La presión te aleja. |
| `dominant` | Quieres control, velocidad y autoridad. Interrumpes, marcas el ritmo y castigas la debilidad. |
| `indecisive` | Te cuesta comprometerte. Das vueltas, cambias de opinión y necesitas guía clara para decidir. |
| `negotiator` | Presionas en precio, comparas alternativas, pides concesiones y usas la negociación como palanca principal. |

**Compatibilidad hacia atrás (backend):** Los valores legacy `insecure` y `hard_negotiator` son normalizados automáticamente a `cautious` y `negotiator` respectivamente en `/api/arena/start`.

---

## Personalidades de vendedor (`sellerProfile`)

| Clave | Descripción |
|-------|-------------|
| `communicative` | Construyes relación con anécdotas y ejemplos. A veces te extiendes demasiado. |
| `authoritative` | Directo, asertivo, controlas la conversación, rebates objeciones con firmeza. |
| `technical` | Hablas de características y datos con detalle. Preciso pero a veces poco emocional. |
| `passive` | Escuchas mucho, no presionas, esperas que el cliente llegue a sus conclusiones. |
| `aggressive` | Presionas para cerrar, creas urgencia, no aceptas "no" fácilmente. |
| `consultive` | Haces muchas preguntas, entiendes necesidades primero y adaptas tu solución. |

---

## Niveles de dificultad (`difficulty`)

| Clave | Comportamiento |
|-------|---------------|
| `easy` | Pocas objeciones, abierto a escuchar. |
| `normal` | Algunas objeciones válidas, necesitas buenos argumentos. |
| `hard` | Muchas objeciones, comparas con competencia, difícil de convencer. |
| `brutal` | Escéptico, cuestionas todo, objeciones fuertes, solo cedes ante argumentos muy sólidos. |

---

## History Windowing

Cuando `LEGACY_ARENA=false` (default):

- Solo los **últimos 12 turnos** de la conversación se envían a la IA por cada respuesta de turno.
- El system prompt incluye una nota explicando la longitud total de la conversación para mantener consistencia.
- El historial completo siempre se guarda en `session.turns` para la transcripción final y el debrief.
- `DEBRIEF_MAX_TURNS = 15` — el debrief solo analiza los últimos 15 turnos en sesiones largas.
- `SUGGEST_MAX_TURNS = 10` — suggest solo usa los últimos 10 turnos.

Cuando `LEGACY_ARENA=true`:
- Se envía el historial completo en cada turno. Sin windowing. Sin detección terminal condicional.

---

## Detección de estado terminal

La detección terminal es el mecanismo que identifica automáticamente cuándo una conversación de ventas ha llegado a un desenlace definitivo.

### Cuándo se ejecuta

La detección solo corre en **seller mode**. Un check se dispara si CUALQUIERA de:

1. `turns.length >= 4` Y se encuentra una **keyword** en el último mensaje de la IA
2. `turns.length >= 6` Y `turns.length % 3 === 0` (safety net cada 3 turnos tras el turno 6)

Esta es la función `shouldCheckTerminal()`. Si ninguna condición se cumple, la detección se omite completamente (ahorra una llamada API).

### Keywords que disparan detección (Español)

```
trato hecho, cerramos, firmamos, me lo quedo, me apunto, lo compro,
cuándo firmo, cuándo firma, voy a pagar, pago con, con tarjeta, bizum,
mándame el contrato, mándame la propuesta, cuando quieras empezamos,
no me interesa en absoluto, definitivamente no, no voy a comprar,
no quiero saber más, hasta aquí, no seguimos, adiós, hasta luego
```

### Keywords que disparan detección (Inglés)

```
deal, let's close, i'll take it, i'll buy, send me the contract,
when do i sign, i'll pay with, by card, send the proposal,
not interested at all, definitely not, won't buy, stop here, goodbye, bye
```

**Excluidos intencionalmente:** Frases amplias como "de acuerdo", "siguiente paso", "cuándo podemos" NO disparan detección porque aparecen frecuentemente en conversación normal.

### Prompt de detección

Envía los últimos 6 turnos al modelo y pide exactamente una palabra: `none | closed | next_step | lost | broken`.

**Definiciones de outcome (estrictas):**
- `none` — conversación abierta o ambigua (default ante la duda)
- `closed` — cliente se comprometió explícitamente a comprar (dijo que compra, preguntó cuándo firma, preguntó cómo pagar)
- `next_step` — cliente comprometió una acción **concreta**: confirmó fecha de reunión, pidió contrato/propuesta, preguntó por formas de pago — "lo pensaré" NO cuenta
- `lost` — cliente rechazó definitivamente, sin vuelta atrás
- `broken` — ruptura total, cliente cortó la conversación

### Fallback

Si la llamada API falla o devuelve un valor inesperado, el resultado es `"none"`.

---

## Feature de Suggest

El botón ✨ en seller mode llama a `POST /api/arena/suggest`. La sugerencia devuelta:

1. Se muestra al usuario brevemente
2. Se envía automáticamente como turno del usuario (llama a `POST /api/arena/turn`)

Esto significa que suggest cuenta como dos llamadas API — una para la sugerencia y otra para la respuesta de la IA a ella.

---

## Debrief

Generado al final de sesión para sesiones de seller con al menos un turno del usuario.

Recibe `clientProfile` de la sesión y lo usa para evaluación sensible al perfil.

### Rúbrica de puntuación

1. **Peso doble**: outcome Y calidad de ejecución se pesan por igual.
2. **Techo duro**: score ≤ 7 si el comprador repite una demanda central (datos, evidencia, método, precio concreto) dos o más veces y el vendedor no la resuelve con concreción en esa conversación — aunque el outcome sea `next_step`.
3. **Penalizaciones** (−1 a −2 c/u):
   - Vendedor propone reunión/llamada/cierre antes de resolver la objeción principal.
   - Siguiente paso queda ambiguo, abierto o sin acción/fecha concreta.
   - Vendedor repite la misma estructura de respuesta sin adaptarse al comprador.
4. **Sensibilidad al perfil**: el prompt incluye el criterio específico del `clientProfile` para que el evaluador juzgue si el vendedor respondió correctamente a ese tipo de comprador.

### Referencias de score

| Situación | Score |
|-----------|-------|
| Closed vs cliente difícil | mín 8 |
| Next_step + buena ejecución | hasta 8 |
| Next_step + ejecución débil | 5–6 |
| Lost / broken | máx 5 |
| Comprador repite demanda central sin resolver | máx 7 (techo duro) |

- Critique: exactamente 3 frases cortas accionables en imperativo, específicas a esta conversación.
- temperature=0.2 (más estricto y consistente que el valor anterior 0.4).

El debrief se muestra en la pantalla post-sesión de Arena y se incluye en el audit log.

---

## Limpieza de sesión

| Evento | Qué pasa |
|--------|---------|
| `POST /api/arena/finish` llamado | `closeSession()` llamado en ai-tracker |
| 5 minutos tras finish | Entrada en Map de sesiones Arena eliminada |
| 10 minutos tras `closeSession()` | Resumen de sesión en ai-tracker eliminado |
| Restart del servidor | Todas las sesiones perdidas (solo en memoria) |
