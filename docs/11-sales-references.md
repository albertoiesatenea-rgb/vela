# 11 — Sales References

_Generado: 2026-04-09 · Closer Wizard internal docs_

---

## Fuente de verdad

Todo el material de referencia comercial está centralizado en:

```
lib/sales-brain/src/index.ts
```

Este archivo es la única fuente de verdad para taxonomías, perfiles, journey, criterios de cierre y anti-patrones. No se duplica información de dominio en los routes ni en el frontend.

---

## Journey comercial (6 etapas)

Modelo lineal compartido entre Copilot y Arena. Copilot lo usa para el campo `journey.now`; Arena lo usa para CoachLite.

| ID | Label ES | Label EN | Descripción (ES) |
|---|---|---|---|
| `context` | contexto | context | Entender la situación, perfil y objetivos del cliente antes de diagnosticar. |
| `problem` | problema | problem | Identificar el dolor, necesidad o objetivo real que motiva la conversación. |
| `blocker` | bloqueo | blocker | Detectar y trabajar la objeción o freno principal que impide avanzar. |
| `fit` | encaje | fit | Conectar la solución con el criterio real del cliente. Validar encaje antes de cerrar. |
| `advance` | avance | advance | Conseguir un microcompromiso o siguiente paso concreto. |
| `close` | cierre | close | Compromiso final o "sí" explícito del cliente. |

**Regla de cierre** (`CLOSING_CRITERIA_BLOCK`): solo cerrar si se cumplen TODAS:
- Objeción principal suficientemente resuelta o aclarada
- Señales de interés real manifiestas
- Sin frentes importantes abiertos
- Conversación madura
- El siguiente paso natural es un microcompromiso

Con objeción activa, duda difusa, resistencia o falta de criterio: NO cerrar.

---

## Perfiles de cliente (Arena — rol cliente)

La IA juega al cliente con esta personalidad. Importa tanto cómo responde como cómo el vendedor debe reaccionar.

| Perfil | Descripción operativa |
|---|---|
| `analytical` | Necesita datos, precisión, proceso y evidencia antes de decidir. Rechaza vaguedades y argumentos emocionales. |
| `emotional` | Decide por confianza, conexión y sensación personal. Le influyen historias reales y la empatía del vendedor. |
| `skeptical` | Desconfía por defecto. Solo le convencen pruebas concretas y consistencia entre lo que se dice y lo que se demuestra. |
| `cautious` | Teme equivocarse. Busca seguridad, validación externa y pasos reversibles. La presión le aleja. |
| `dominant` | Quiere control, velocidad y autoridad. Interrumpe, marca el ritmo, castiga la indecisión. |
| `indecisive` | Le cuesta comprometerse. Da vueltas, cambia de opinión. Necesita guía clara. |
| `negotiator` | Presiona en precio, compara alternativas, pide concesiones. |

**Criterios de debrief por perfil** (`DEBRIEF_CLIENT_PROFILE`): cada perfil tiene una descripción orientada al evaluador que especifica qué penalizar si el vendedor no respondió correctamente al tipo de comprador.

---

## Perfiles de vendedor (Arena — rol vendedor, IA)

La IA simula un vendedor con esta personalidad cuando el usuario juega como cliente.

| Perfil | Descripción |
|---|---|
| `communicative` | Construye relación con anécdotas y ejemplos. A veces se extiende demasiado. |
| `authoritative` | Directo, asertivo, controla la conversación, rebate objeciones con firmeza. |
| `technical` | Habla de características y datos con detalle. Preciso pero poco emocional. |
| `passive` | Escucha mucho, no presiona, espera que el cliente llegue a sus conclusiones. |
| `aggressive` | Presiona para cerrar, crea urgencia, no acepta "no" fácilmente. |
| `consultive` | Hace muchas preguntas, entiende necesidades primero y adapta la solución. |

---

## Niveles de dificultad (Arena)

| Nivel | Descripción |
|---|---|
| `easy` | Pocas objeciones, abierto a escuchar. |
| `normal` | Algunas objeciones válidas, necesita buenos argumentos. |
| `hard` | Muchas objeciones, compara con competencia, difícil de convencer. |
| `brutal` | Escéptico, cuestiona todo, objeciones fuertes, solo cede ante argumentos muy sólidos. |

---

## Taxonomía de objeciones (`OBJECTION_TAXONOMY`)

### Señales de duda inicial (antes de objeción formada)

| Código | Label ES | Descripción |
|---|---|---|
| `falta_familiaridad` | falta familiaridad | No conoce el activo/marca. No rechaza, simplemente no conoce. NUNCA es objeción reputacional automática. |
| `duda_abierta` | duda abierta | Preocupación vaga, criterio no articulado todavía. |
| `necesita_criterio` | necesita criterio | No tiene marco para decidir. El trabajo es construirlo, no argumentar. |
| `falta_confianza` | falta confianza inicial | Escepticismo de entrada, no rechazo activo. Requiere construir credibilidad antes de argumentar. |
| `objecion_incipiente` | objeción incipiente | Freno que empieza a surgir, no consolidado. Intervenir antes de que cristalice. |

### Objeciones formadas

| Código | Label ES | Descripción |
|---|---|---|
| `real` | objeción real | Freno genuino basado en criterio concreto. Hay que resolverla, no rodearla. |
| `superficial` | objeción superficial | Duda que se disipa con información o reencuadre. No requiere negociación. |
| `falsa` | objeción falsa | Excusa que esconde otra objeción o falta de interés real. |
| `precio` | objeción de precio | El coste es el freno o el pretexto. Anclar valor antes de hablar de precio. |
| `liquidez` | objeción de liquidez | Preocupación por poder deshacer la posición o acceder al capital. Distinta de precio. |
| `timing` | objeción de timing | Dilación sin razón clara. Evaluar si hay razón real o si es evitación. |
| `miedo_equivocarse` | miedo a equivocarse | Riesgo percibido alto, falta de confianza en la decisión, no en el producto. |
| `desconfianza` | desconfianza activa | Escepticismo activo, posible experiencia previa negativa. Reconstruir desde datos concretos. |
| `resistencia_emocional` | resistencia emocional | Rechazo no basado en criterio racional. Cambiar de eje antes de argumentar. |
| `reputacion` | objeción reputacional | Solo cuando la crítica al proveedor/zona está articulada explícitamente. No inferir. |
| `cierre_con_resistencia` | interés real, frena cierre | Le interesa pero no da el paso. El freno es el compromiso, no el producto. |

**Regla crítica:** "no conozco / no me suena" sin rechazar = `falta_familiaridad`. Nunca `reputacion` automáticamente.

---

## Anti-patrones tácticos (`SALES_ANTIPATTERNS_BLOCK`)

Lo que está prohibido en cualquier conversación de ventas modelada por el sistema:

- Usar como argumento principal algo que el cliente ya aceptó.
- Abrir con "entiendo tu preocupación", "es una pregunta muy válida", "totalmente comprensible" o equivalentes.
- Preguntas genéricas de relleno que no diagnostican nada concreto.
- Insistir con beneficios laterales cuando el cliente tiene un bloqueo central sin resolver.
- Usar "explorar", "optimizar", "maximizar" o "potencial" sin concretar qué cambiaría, en qué cantidad y si es realista.
- Proponer cambios que ya se dijeron imposibles o que el contexto excluye.
- Retomar un marco que el cliente rechazó explícitamente (largo plazo, revalorización, ventaja fiscal, etc.) aunque sea con otras palabras.
- Repetir en el siguiente turno una conclusión ya dicha claramente en el anterior.
- Cerrar o proponer siguiente paso antes de resolver la objeción principal.

---

## Heurísticas de decisión comercial (`SALES_HEURISTICS`)

10 reglas SI→ENTONCES. Se inyectan vía `buildHeuristicsBlock(lang)`.

| Condición | Acción |
|---|---|
| La objeción se repite 2+ veces con la misma estructura | Deja de argumentar. Ve al umbral: ¿qué tendría que cambiar para que tuviera sentido? |
| El cliente acepta la tesis pero rechaza el coste recurrente | El bloqueo es tolerancia de caja, no de valor. Trabaja el umbral de aportación. |
| Aparece pareja, asesor, comité o tercero | Riesgo de no-decisión. Implica al tercero pronto o cierra un microcompromiso antes de que se enfríe. |
| El cliente ya compró el argumento de largo plazo | No volver a venderlo. Cambiar al siguiente freno. |
| No hay encaje real | Descalifica con autoridad. La honestidad sobre el no-encaje genera más confianza. |
| El cliente menciona una alternativa | La alternativa revela el criterio. Identificar qué valora antes de entrar en comparación directa. |
| El cliente define un umbral concreto (precio máximo, condición) | Ese umbral es el eje de la conversación. No ignorarlo ni diluirlo. |
| "No conozco la zona / no me suena" sin rechazo activo | Es falta de familiaridad. No defender el activo aún. Concretar el criterio de duda primero. |
| El cliente evita responder directamente a una pregunta clave | Detectar la evasión. Decidir si presionar (objeción oculta) o rodear (falta de criterio). |
| El cliente está cerca del cierre pero pide más tiempo sin razón concreta | El freno es el compromiso, no la información. Proponer un microcompromiso reversible. |

**Regla de comparaciones** (`COMPARISON_RULE_BLOCK`): si mencionan una alternativa → identificar primero el CRITERIO que valoran. Si ya enumeraron atributos de la alternativa → PROHIBIDO preguntar qué valoran de X. Esos atributos son la respuesta.

---

## Presets de Arena (`PRESET_SYSTEM_DESC`)

Marcos de venta inyectados en el system prompt de Arena según el preset seleccionado.

| Preset | Sector | Características clave |
|---|---|---|
| `immvest` | Inversión inmobiliaria en Alemania | High-ticket consultivo. Financiación hasta 100% del valor. Cashflow negativo no es invalidador. Cierre: reserva 1.500€ reembolsable. |
| `saas` | Software como servicio | Demo, piloto, ROI, adopción interna, aprobación técnica/directiva. |
| `b2b` | Venta a empresa | Propuesta formal, múltiples decisores, presupuesto anual, timing interno. |
| `high_ticket` | Alto valor personal/empresarial (>5.000€) | Anclar valor antes de precio. No descuentos. Manejo del miedo a la decisión. |
| `coaching` | Formación y mentoría | Resultados demostrables, aplicabilidad concreta, desconfianza en el método. |
| `challenge` | Venta imposible/creativa | Escenario de práctica extremo. El cliente puede ceder si el argumento es genuinamente bueno. |

**Nota sobre immvest:** el preset más detallado del sistema (~20 líneas en ambos idiomas). Incluye lógica financiera específica (AfA, financiación, cashflow), objeciones comunes ya mapeadas, y criterio explícito para distinguir "turista vs comprador real".

---

## Presets de contexto generado (`adapt-context`)

Cuando el usuario cambia de rol (seller ↔ client) dentro de Arena, el endpoint `adapt-context` genera texto de contexto en primera persona apropiado al nuevo rol. Temperatura 0.2, max_tokens según preset (120 para immvest, 65 para el resto).

---

## Técnicas de venta referenciadas en el sistema (convención operativa)

No hay una lista explícita en el código con estos nombres, pero los prompts y heurísticas los implementan:

- **Frame Control / Reencuadre**: reencuadrar "coste" como "inversión", "cashflow negativo" como "aportación mensual controlada".
- **Value Anchoring**: anclar valor antes de hablar de precio. Regla explícita en high_ticket y closing criteria.
- **Micro-commitment**: avance como etapa previa al cierre. Reducir el salto percibido con pasos reversibles.
- **Threshold probing**: "¿qué tendría que cambiar para que tuviera sentido?" — cuando la objeción se repite.
- **Disqualification**: descalificar con autoridad cuando no hay encaje real.
- **Third-party management**: protocolo explícito cuando aparece pareja, asesor o comité.

---

## Zonas ambiguas

- El sistema no referencia explícitamente metodologías con marca registrada (SPIN, Challenger, MEDDIC, etc.). Las heurísticas son propias o derivadas de principios comunes sin atribución.
- Los perfiles de vendedor (`SELLER_PROFILE_DESC`) existen en el código pero no todos tienen criterios de debrief equivalentes a los de cliente. El debrief de Arena diferencia por perfil de cliente, no de vendedor.
- El outcome taxonomy (`closed` / `next_step` / `lost` / `open`) está definida conceptualmente en los prompts de analyze pero no como constante exportada de sales-brain.
