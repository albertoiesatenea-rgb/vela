# 10 — Replit Prompt Style

_Generado: 2026-04-09 · Closer Wizard internal docs_

---

## Qué es este documento

Guía operativa de cómo se escriben, mantienen y parchean los prompts del sistema en este proyecto. No es teoría general de prompting. Es el estilo vigente en el código real, derivado de las decisiones tomadas al comprimir, reestructurar y testear los prompts de Copilot y Arena.

---

## Principio fundamental

> **Centralizar definiciones, no instrucciones.**

Los textos del dominio (taxonomías, perfiles, journey stages, anti-patrones, cierre criteria) viven en `lib/sales-brain/src/index.ts` y se **inyectan** en los prompts. Los prompts sí son locales a cada route. Nunca duplicar una definición en el prompt si ya existe en sales-brain.

---

## Estructura de un system prompt en este proyecto

```
[BLOQUE IDENTIDAD / ROL]          ← quién es la IA y qué hace
[BLOQUE OUTPUT FORMAT]            ← JSON schema exacto o formato de texto exacto
[BLOQUE TAXONOMÍA INYECTADA]      ← de sales-brain
[BLOQUE REGLAS OPERATIVAS]        ← reglas cortas, en listas, sin párrafos largos
[BLOQUE ANTI-PATRONES]            ← lo que está prohibido (también inyectado)
```

El orden importa. Los modelos pesan más las instrucciones al inicio y al final. El JSON schema va al principio para anclar el formato de output desde la primera línea.

---

## Estilo de escritura

### Reglas positivas — en imperativo directo

```
✓ Clasifica la objeción exactamente con uno de estos códigos: ...
✓ Devuelve SOLO el JSON. Nada antes ni después.
✓ Si hay objeción activa: campo cierre = null.
```

### Reglas prohibitorias — encabezadas con `PROHIBIDO` o `NO`

```
PROHIBIDO:
— Abrir con "entiendo tu preocupación" o equivalentes
— Cerrar antes de resolver la objeción principal
— Usar "explorar", "optimizar", "maximizar" sin concretar qué cambiaría
```

El bloque `PROHIBIDO` es el mismo que `SALES_ANTIPATTERNS_BLOCK` de sales-brain, inyectado literalmente.

### Sin párrafos explicativos

Los prompts de este proyecto no tienen introducción, contexto narrativo, ni justificación de las reglas. Solo instrucciones. Cualquier frase que empiece por "Esto es porque..." o "El propósito de esta sección es..." es ruido.

### Listas con dashes, no bullets

Se usa `—` (em dash) para listas operativas. No se usan bullets `•` ni asteriscos `*`.

### Formato JSON en el prompt: schema explícito

Todos los endpoints que devuelven JSON incluyen el schema exacto dentro del system prompt, no como ejemplo sino como declaración. El modelo no infiere la estructura: se la damos.

```ts
// Ejemplo real del copilot (V2)
`Devuelve SOLO JSON válido con este schema exacto:
{
  "signal": "<código de taxonomía>",
  "coach": "<mensaje 1 frase>",
  "cierre": "<propuesta de cierre | null>",
  ...
}`
```

---

## Compresión de prompts: criterios

Cuando se comprime un prompt de V1 a V2, el criterio es:

1. **Eliminar ejemplos** si la taxonomía ya está definida con claridad.
2. **Eliminar redundancias**: si una regla está dicha dos veces, queda una.
3. **Eliminar justificaciones**: "porque esto ayuda a..." → se borra.
4. **Mantener excepciones** aunque parezcan raras (casos borde reales).
5. **Nunca eliminar el schema de output** ni la lista de códigos válidos.

La compresión de Copilot V1 (~2100 tokens) a V2 (~700 tokens) eliminó principalmente: párrafos de contexto introductorio, ejemplos verbales extensos, y repetición de la taxonomía de objeciones que ahora viene de sales-brain.

---

## max_tokens por endpoint

Referencia actual de los límites de completion configurados:

| Endpoint | max_tokens | Temperatura | Notas |
|---|---|---|---|
| `coach-lite` | 280 | 0.3 | Coach inline en Arena |
| `opening` | 150 | 0.4 | Frase de apertura Arena |
| `shortcut` | 80 | 0.3 | Sugerencia de siguiente frase |
| `journey` | 200 | 0.2 | Estado del journey en Arena |
| `analyze` | 900 | 0.3 | Análisis post-llamada Copilot |
| `turn` (client role) | 220 | 0.7 | Respuesta del cliente AI en Arena |
| `turn` (seller role) | 300 | 0.6 | Respuesta del vendedor AI en Arena |
| `preset-context` (immvest) | 120 | 0.2 | Contexto generado para preset immvest |
| `preset-context` (otros) | 65 | 0.2 | Contexto para presets no-immvest |
| `adapt-context` | 150 | 0.2 | Adaptación de contexto entre roles |
| `audit-report` | 900 | 0.3 | Brutal audit (copilot y arena) |
| `debrief` | 300 | 0.3 | Debrief de sesión Arena |
| `suggest` | 200 | 0.4 | Sugerencia táctica mid-session |

Temperatura baja (`0.2–0.3`) para clasificación y análisis estructurado. Temperatura más alta (`0.6–0.7`) para respuestas conversacionales.

---

## Idioma en los prompts

- Todos los prompts tienen soporte bilingüe (ES/EN) vía la prop `lang` de la sesión.
- Sales-brain exporta bloques en ambos idiomas; el route elige `[lang]` al inyectar.
- Los prompts de las rutas tienen sus literales duplicados o usan condicionales en TypeScript.
- El modelo responde siempre en el idioma que le pide el prompt, no el del usuario directamente.

---

## Cómo parchear un prompt sin romper el sistema

1. **Localizar el archivo de route** que controla ese endpoint (`copilot.ts` o `arena.ts`).
2. **Identificar si la regla a cambiar está en el prompt local o en sales-brain**.  
   - Si está en sales-brain: cambiarla ahí beneficia a todos los consumidores.  
   - Si es específica de un endpoint: cambiarla solo en el route.
3. **Verificar con `LEGACY_PROMPTS=true`** si se está editando el prompt de Copilot, para tener el comportamiento V1 como referencia.
4. **No subir `max_tokens`** sin razón validada: cada aumento de 100 tokens en endpoints de alta frecuencia (turns, coach-lite) tiene impacto de coste directo.
5. **Registrar el cambio en el CHANGELOG** de `sales-brain/src/index.ts` si se modifica una definición de dominio.

---

## Estilo de notas de contexto en Arena (windowing)

Cuando la historia se trunca por windowing, Arena inyecta una nota en el system prompt:

```
[Conversation has N turns total. Showing last 12 for efficiency. Stay consistent with your assigned personality and context.]
```

Este patrón — nota entre corchetes, en el system prompt, en el idioma de la sesión — es la convención vigente para comunicar al modelo información sobre el contexto truncado.

---

## Zonas ambiguas / convención, no código

- No hay un linter de prompts ni tests automatizados de contenido de prompts.
- Los cambios de prompts solo se validan manualmente en dev.
- `prompt_patch` y `prompt_for_replit` en el brutal audit son sugerencias generadas por la IA para el desarrollador, no se aplican automáticamente.
- No existe un sistema de versionado de prompts más allá del flag `LEGACY_PROMPTS` para Copilot.
