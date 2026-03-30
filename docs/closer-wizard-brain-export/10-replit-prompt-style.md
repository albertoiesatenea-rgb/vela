# 10 — Cómo escribir prompts para Replit AI (Closer Wizard Brain)

---

## Principio rector

**Pide cambios implementables, no teoría.**
Un buen prompt produce código real, modificaciones concretas y criterios verificables.
Un prompt malo produce explicaciones, opciones y preguntas de vuelta.

---

## Reglas base

1. **Cambio pequeño y limpio** — si basta con editar una función, no pidas refactorizar el módulo entero.
2. **No romper lo que funciona** — cualquier modificación debe preservar el comportamiento existente salvo que el prompt lo contradiga explícitamente.
3. **Sin humo** — nada de "mejora la UX", "optimiza la arquitectura" ni "sigue las buenas prácticas". Describe el cambio exacto.
4. **Estado actual primero** — el prompt debe asumir que la app funciona hoy. El agente no debe reescribir desde cero.
5. **Un objetivo por prompt** — si tienes dos cambios independientes, son dos prompts.

---

## Estructura obligatoria de cada prompt

```
## OBJETIVO
Una frase. Qué debe cambiar y por qué.

## CONTEXTO
Qué existe hoy. Archivos relevantes. Comportamiento actual.

## RESTRICCIONES
Qué NO debe tocarse. Qué comportamiento debe conservarse.

## ENTREGABLES
Qué archivos se modifican y qué debe verse diferente al terminar.

## CRITERIOS DE ACEPTACIÓN
Lista de condiciones verificables. El agente puede marcar cada una como ✓ o ✗.
```

---

## Plantilla de prompt completo

```
## OBJETIVO
[Una línea: qué cambia exactamente]

## CONTEXTO
- Archivo principal: [ruta]
- Comportamiento actual: [descripción breve]
- Datos relevantes: [interfaces, props, rutas API, etc.]

## RESTRICCIONES
- No modificar: [lista de archivos o funciones intocables]
- Conservar: [comportamiento existente que debe mantenerse]
- No instalar dependencias nuevas salvo que sea estrictamente necesario

## ENTREGABLES
- [ ] Archivo modificado: [ruta]
- [ ] Cambio visible: [descripción de qué se ve diferente]

## CRITERIOS DE ACEPTACIÓN
- [ ] [condición verificable 1]
- [ ] [condición verificable 2]
- [ ] La app compila sin errores
- [ ] No hay regresión en [funcionalidad adyacente]
```

---

## Cómo pedir refactors seguros

**Mal:**
> Refactoriza el módulo de arena para que sea más mantenible.

**Bien:**
```
## OBJETIVO
Extraer la función `shouldCheckTerminal` de arena.ts a un archivo separado
`lib/terminal-detector.ts` para facilitar su testing independiente.

## CONTEXTO
- Función actual en: artifacts/api-server/src/routes/arena.ts, líneas ~94–101
- La función recibe (turns, lang) y devuelve boolean
- No tiene dependencias externas

## RESTRICCIONES
- El comportamiento de la función NO cambia
- arena.ts importa desde el nuevo archivo; nada más cambia en arena.ts
- No tocar nada en el frontend

## ENTREGABLES
- [ ] artifacts/api-server/src/lib/terminal-detector.ts (función extraída)
- [ ] artifacts/api-server/src/routes/arena.ts (import actualizado)

## CRITERIOS DE ACEPTACIÓN
- [ ] arena.ts importa shouldCheckTerminal desde ../lib/terminal-detector
- [ ] La lógica de la función es byte-a-byte idéntica a la original
- [ ] El servidor arranca sin errores
```

---

## Cómo pedir optimizaciones sin degradación

**Mal:**
> Optimiza el rendimiento del copiloto.

**Bien:**
```
## OBJETIVO
Reducir el tamaño del prompt enviado a /api/copilot/analyze cuando callMemory
está vacío, eliminando el bloque de memoria del system prompt en ese caso.

## CONTEXTO
- Archivo: artifacts/api-server/src/routes/copilot.ts
- El system prompt incluye siempre un bloque "Memoria actual:" aunque esté vacío
- callMemory vacío → el bloque ocupa ~20 tokens innecesarios

## RESTRICCIONES
- Cuando callMemory tiene ítems, el bloque se incluye igual que ahora
- El output JSON del modelo no cambia
- No tocar el prompt V1 (LEGACY_PROMPTS=true)

## ENTREGABLES
- [ ] artifacts/api-server/src/routes/copilot.ts modificado

## CRITERIOS DE ACEPTACIÓN
- [ ] Con callMemory=[], el system prompt no incluye el bloque de memoria
- [ ] Con callMemory=["ítem"], el sistema funciona igual que antes
- [ ] Los tests manuales de /api/copilot/analyze devuelven JSON válido en ambos casos
```

---

## Cómo pedir limpieza de código sin destrucción

**Mal:**
> Limpia y mejora el código del debug panel.

**Bien:**
```
## OBJETIVO
Eliminar los console.log de debug que quedaron en debug-panel.tsx.

## CONTEXTO
- Archivo: artifacts/silent-closer/src/components/debug-panel.tsx
- Hay varios console.log(...) que se usaron durante desarrollo
- No aportan valor en producción

## RESTRICCIONES
- Solo eliminar console.log — no cambiar ninguna lógica
- No reformatear el archivo entero
- No tocar comentarios ni tipos

## ENTREGABLES
- [ ] artifacts/silent-closer/src/components/debug-panel.tsx sin console.log

## CRITERIOS DE ACEPTACIÓN
- [ ] grep "console.log" en debug-panel.tsx devuelve 0 resultados
- [ ] El panel sigue funcionando igual (pin, alertas, tabs, polling)
```

---

## Señales de un prompt malo

| Señal | Problema |
|-------|---------|
| "Mejora la experiencia de usuario" | Sin criterio verificable |
| "Sigue las mejores prácticas" | Ambiguo, subjetivo |
| "Refactoriza todo X" | Scope demasiado grande |
| Sin mencionar archivos concretos | El agente tiene que adivinar el contexto |
| Sin criterios de aceptación | No se puede saber si terminó bien |
| "Hazlo más rápido / más limpio / mejor" | No es implementable sin una métrica concreta |

---

## Señales de un prompt bueno

- Menciona el archivo y la función exacta a cambiar
- Define qué NO debe cambiar
- Los criterios de aceptación son verificables con grep, un test o cargando la app
- El objetivo cabe en una frase
- No hay adjetivos de calidad sin métrica (rápido, limpio, mejor, robusto)
