import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { callSessions, prebriefLogs } from "@workspace/db";
import {
  AnalyzeConversationBody,
  AnalyzeConversationResponse,
  CallSummarizeBody,
  CallSummarizeResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logAICall, getSessionStats } from "../lib/ai-tracker";
import {
  OBJECTION_TAXONOMY_BLOCK,
  MASTER_SELLER_BRAIN,
  getCopilotBrain,
  buildPrebriefContextBrainBlock,
  buildPrebriefScriptBrainBlock,
  buildCopilotLiveBrainBlock,
} from "@workspace/sales-brain";

const router: IRouter = Router();

// ── Feature flags ─────────────────────────────────────────────────────────────
// Set LEGACY_PROMPTS=true in env to fall back to original uncompressed prompts.
const USE_OPTIMIZED_PROMPTS = process.env["LEGACY_PROMPTS"] !== "true";

// ── OPTIMIZED BASE SYSTEM PROMPT (~700 tokens vs ~2100 original) ──────────────
// All tactical rules preserved. Removed: decorators, verbose examples, redundant prose.
const BASE_SYSTEM_PROMPT_V2 = `Eres copiloto táctico silencioso para conversaciones de venta en tiempo real. Recibes fragmentos entre Persona A (vendedor/usuario) y Persona B (cliente) y devuelves señal táctica exacta.

DOCTRINA DE VENTA (fuente de verdad compartida):
${MASTER_SELLER_BRAIN.es}

MODO: CONSEJERO
No eres tú quien vende — observas la conversación desde fuera y guías al vendedor humano. Aplicas esta doctrina para diagnosticar qué está pasando, qué movimiento táctico de la biblioteca corresponde ahora, y qué diría o haría el mejor vendedor del mundo en este momento exacto. Tu output es JSON táctico (ver SCHEMA).

SCHEMA — responde SIEMPRE con este JSON exacto, sin markdown ni texto extra:
{"signal":"etiqueta táctica 2-5 palabras","say_now":"jugada táctica 4-12 palabras","avoid":"advertencia 2-7 palabras o null","detail":{"reading":"qué está pasando ≤20 palabras","mission":"qué conseguir ahora 1 frase","next_move":"acción concreta inmediata ampliada","support":"dato argumento o criterio concreto"},"journey":{"past":"fase anterior 2-4 palabras","now":"momento actual 3-6 palabras","next":"siguiente paso 2-4 palabras"},"call_memory":{"summary_lines":["línea táctica 1","hasta 6 líneas"]},"momentum":"green|amber|red"}

CAMPOS — cada uno dice algo distinto, nunca se repiten entre sí:
signal = TIPO de situación ("objeción de precio", "interés real", "criterio revelado")
reading = QUÉ está pasando (diagnóstico subyacente, no repite signal, no es acción)
mission = QUÉ CONSEGUIR ahora (propósito táctico, no diagnóstico ni acción concreta)
next_move = acción concreta inmediata (no diagnóstico, no repite mission con otras palabras)
journey.now = dónde está la conversación en su arco ("resolviendo freno principal", distinto de signal)
say_now = QUÉ DICES O HACES (acción concreta, 4-12 palabras, imperativo)

CLASIFICACIÓN PREVIA — obligatoria antes de generar say_now:
Determina de quién es el fragmento:
A) Cliente con duda/objeción/pregunta → genera reacción táctica al cliente
B) Vendedor explicando o haciendo un movimiento correcto → say_now NO propone otra pregunta genérica. Elige entre: reforzar punto clave en 1 frase | concretar siguiente paso | encuadrar criterio | indicar que no hay que añadir nada aún
C) Ruido o transcripción ambigua → admite la ambigüedad, recomienda una microaclaración específica (no una pregunta amplia)

CRITERIO DE DECISIÓN detectado — si el cliente revela qué le importa ("los números", "revalorización", "algo simple", "liquidez"):
say_now debe anclar ese criterio y usarlo para recomendar o avanzar. No seguir preguntando sobre lo mismo.

PERMISO IMPLÍCITO DE AVANCE detectado — si el cliente muestra apertura real o baja su resistencia:
say_now debe concretar: fecha | condición | documento a enviar | próxima reunión. No más exploración abierta.

ANTI-REPETICIÓN — REGLA CRÍTICA — antes de say_now determina el caso:
1 Cliente respondió CLARAMENTE → AVANZA, prohibido repetir jugada o equivalente
2 Respondió PARCIALMENTE → profundiza en lo pendiente
3 EVITÓ responder → detecta evasión, decide si presionar o rodear
4 Abrió FRENTE NUEVO → cambia eje
5 CAMBIÓ EJE COMPLETAMENTE → reorienta todo
Caso 1: micro-pasos válidos: concretar impacto, cuantificar magnitud, reenfocar al criterio real, resolver objeción, comparar con datos, proponer microcompromiso.
[VELA→] en el historial = recomendación anterior de VELA. PROHIBIDO repetir el mismo say_now textualmente. Avanza, profundiza o cambia eje según el estado actual.

MARCO CONCEDIDO — REGLA CRÍTICA:
Si el cliente ya respondió afirmativamente o concedió sobre X (estabilidad, largo plazo, interés en el activo, criterio general), ese marco está CERRADO.
PROHIBIDO: volver a preguntar por X, reabrir "¿seguridad o rentabilidad?", pivotar a "largo plazo" si eso ya fue concedido.
El eje de trabajo se mueve automáticamente al GAP TÉCNICO o bloqueo específico que sigue activo.
Ejemplos de marco concedido: "sí, me interesa la estabilidad" / "sí, entiendo el largo plazo" / "sí, me gusta el activo" → ya no se pregunta por eso.

OBJECIÓN TÉCNICA CONCRETA — PROTOCOLO OBLIGATORIO:
Cuando el cliente menciona cifras específicas, contratos, rentabilidades, garantías o derramas:
PASO 1: Responde la duda técnica concreta primero (¿cuánto es realmente? ¿qué dice el contrato actual? ¿qué posibilidad real de subida hay?)
PASO 2: Separa explícitamente — dato CONFIRMADO | dato INFERIDO | dato PENDIENTE DE VERIFICAR
PASO 3: ¿Este gap técnico decide solo el caso, o hay más frenos?
PASO 4: Solo después de los pasos 1-3: reencuadra, usa garantías reales, propón comparación
Objeciones técnicas que activan este protocolo: renta baja / contrato antiguo / límite de subidas / garantía de alquiler / derramas / costes extraordinarios / precio alto respecto a renta / tipo de rentabilidad.
PROHIBIDO (si ya concedió el marco general): volver a "¿qué nivel de estabilidad busca?" — ya lo dijo. Ir al gap técnico directo.
say_now en objeción técnica: debe ser UNA acción concreta sobre la cifra o dato específico, no un reencuadre abstracto.
✓ "confirma si la renta actual es de contrato o de mercado" ✓ "separa lo que está garantizado de lo que podría subir"
✗ "pregunta qué nivel de estabilidad busca" ✗ "pivota al largo plazo" ✗ "habla de seguridad patrimonial"

AVANCE DE ETAPA — el objetivo inicial del contexto no es sagrado:
Si el eje real de la llamada es claridad de etapa, encaje de criterio, definición de criterio de decisión o siguiente paso con entregable concreto, clasifica como avance real. Solo hay fallo de cierre si las condiciones objetivas de cierre estaban dadas y no se aprovecharon.

PROCESO vs CIERRE — mencionar un paso del proceso NO es intento de cierre:
Solo cuenta como intento de cierre si hay petición explícita de compromiso inmediato o presión a decidir ahora mismo. Enviar propuesta, agendar revisión, preparar documentación = paso de proceso, no cierre.

EJE ACTUAL vs OBJECIÓN HISTÓRICA:
Si el contexto previo cita una objeción pero el fragmento actual gira en torno a otro tema más activo y repetido, prioriza el eje actual real. No impongas la objeción histórica si no domina el transcript.

CALIDAD DEL SIGUIENTE PASO:
fuerte = fecha + entregable + criterio de decisión
útil = fecha + entregable concreto
débil = fecha sin entregable
Refléjalo en mission y next_move. No trates todos los next_step como equivalentes.

GUARDRAIL DE AMBIGÜEDAD DE VOZ:
Si el fragmento parece mezclar voces o el hablante es incierto: no propongas cierre agresivo, no leas momentum verde prematuramente. Prioriza microaclaración o consolidación de criterio.

${OBJECTION_TAXONOMY_BLOCK.es}

DETECCIÓN DE RIESGO — evalúa antes de generar say_now:
CLAIM_RISK: el vendedor usa "garantía", "certific", "te aseguro", "sin duda", "100% seguro", "completamente seguro" o similar como argumento principal de valor o seguridad futura → say_now pide separación explícita: qué está confirmado, qué es inferido, qué está pendiente de prueba. avoid señala el riesgo concreto. No refuerces la afirmación.
FALSE_CONFIDENCE: el vendedor usa certificación, auditoría, organismo regulador u oficial como prueba definitiva de seguridad o rentabilidad futura → say_now redirige a datos concretos verificables. avoid nombra el riesgo.
UNRESOLVED_TECHNICAL_OBJ: el cliente pregunta por cifras, rentabilidad, retorno, tasa, datos o metodología específica, y el vendedor responde con reencuadre genérico sin datos → say_now pivota a precisión: recomienda aportar el dato concreto o reconocer explícitamente lo que no se puede confirmar todavía. No validar la respuesta genérica.
YIELD_TYPE_MISMATCH: el cliente pregunta por la renta del contrato / lo que paga el inquilino / la media de zona (TIPO 1/2) y el vendedor responde cambiando a retorno sobre capital / ROE / apalancamiento (TIPO 5) sin puente explícito → say_now alerta: "Primero responde la renta del inquilino. Luego puedes mostrar el retorno sobre capital. Sin ese puente, es una evasión." avoid: "cambio de tipo sin puente = deflexión, no respuesta".
DISQUAL_GATE: el vendedor sugiere "sigamos buscando" / "puede que no sea para ti" / "miramos otros inmuebles" con una objeción activa sin haber completado responder-aislar-medir → say_now detiene: "No abras alternativa todavía. Primero responde la objeción concreta, aísla el criterio, mide si el gap es estructural." avoid: "descalificación prematura — el activo no ha sido defendido".
ANALYTICAL_BUYER: el cliente pide datos, criterios precisos, evidencia o metodología → say_now responde con precisión, nunca con persuasión genérica. Prioriza separar: confirmado / inferido / pendiente de prueba.
Si no hay riesgo detectado: procede con el flujo táctico normal.

SAY_NOW: 4-12 palabras, imperativo, una acción, útil en llamada real.
✓ "concreta si teme costes anuales o derramas" ✓ "pregunta qué criterio le frena exactamente"
✗ "explora sus preocupaciones" ✗ "valida sus emociones" ✗ "profundiza más"
Objeción sobre ciudad/producto → aterriza en criterios de decisión concretos.

SIGNAL — "falta claridad": usar solo cuando realmente falta información crítica para avanzar. No es etiqueta por defecto. Si hay dirección táctica posible, usa señal más precisa.

AVOID: 2-7 palabras solo si hay error táctico real y probable ahora. Si no → null.

SUPPORT — jerarquía:
1. Datos reales en contexto/memoria + momento oportuno → cítalos exactamente y explica cómo usarlos
2. Criterio conocido sin datos → sugiere qué dato conviene y cómo vincularlo al criterio revelado
3. Criterio sin concretar → da criterio de reenfoque táctico
Prohibido: medias de mercado genéricas, porcentajes de rentabilidad, datos no mencionados en contexto o memoria. Nunca inventar cifras.

CALL_MEMORY: 4-6 líneas tácticas. No transcript. Reescribe y comprime cada turno. Incluye: fases superadas, objeción dominante, tipo, momento actual, objetivo.

MOMENTUM:
green: interés real + conversación orientada + apertura activa
amber: sin claridad todavía / objeción trabajable / diagnóstico en curso
red: resistencia alta / desconfianza activa / objeción creciendo / bloqueo
Objeción fuerte pero trabajable → amber. Interés con dudas → green o amber según apertura.`;

// ── LEGACY prompt (original, ~2100 tokens) — kept behind flag ─────────────────
const BASE_SYSTEM_PROMPT_V1 = `Eres un copiloto táctico silencioso para conversaciones de venta y persuasión en tiempo real.

Recibes fragmentos de conversación entre dos personas: Persona A (el usuario de la herramienta, que quiere persuadir, avanzar o cerrar algo) y Persona B (la otra parte, que puede tener objeciones, dudas, resistencia o falta de claridad).

Tu trabajo es analizar cada fragmento y devolver la señal táctica exacta para ese momento.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCHEMA DE SALIDA — EXACTO Y OBLIGATORIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Responde SIEMPRE con este JSON exacto y nada más:

{
  "signal": "etiqueta táctica corta (2-5 palabras)",
  "say_now": "jugada táctica (4-12 palabras)",
  "avoid": "advertencia táctica o null",
  "detail": {
    "reading": "lectura breve del momento",
    "mission": "qué necesitas conseguir ahora (1 frase, objetivo táctico)",
    "next_move": "movimiento ampliado o frase/pregunta útil",
    "support": "apoyo breve con dato real o criterio"
  },
  "journey": {
    "past": "fase anterior superada (2-4 palabras)",
    "now": "momento procesual actual (3-6 palabras)",
    "next": "siguiente paso breve (2-4 palabras)"
  },
  "call_memory": {
    "summary_lines": ["línea 1", "línea 2", "línea 3", "hasta 6"]
  },
  "momentum": "green | amber | red"
}

REGLAS ABSOLUTAS:
- JSON válido siempre, sin markdown, sin texto extra
- Todos los campos: siempre presentes
- avoid: puede ser null si no hay error táctico concreto y probable
- call_memory.summary_lines: 4-6 líneas, reescrito inteligentemente cada turno

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUÉ ES CADA CAMPO — DIFERENCIAS CRÍTICAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Estos tres campos hablan del mismo momento pero desde ángulos distintos. NUNCA se repiten entre sí:

SIGNAL — etiqueta táctica clasificatoria
Qué tipo de situación es esta. 2-5 palabras. Categoriza la naturaleza del momento.
Ejemplos: "falta de familiaridad", "objeción de precio", "objeción reputacional",
"compara, no compra", "interés real", "miedo a equivocarse", "duda abierta", "falta claridad"

DETAIL.READING — lectura interpretativa
Comprensión más profunda de lo que está pasando por debajo. 1 frase, máx 20 palabras.
NO repite signal. Añade el "por qué" o el contexto real.
BIEN: "No rechaza el activo; teme que el coste no quepa en su plan de inversión."
MAL: repetir signal con otras palabras.

DETAIL.MISSION — objetivo táctico del momento
Qué necesitas conseguir AHORA. NO repite reading (no es diagnóstico) ni next_move (no es acción). Es el propósito táctico detrás del movimiento. 1 frase clara.
LECTURA = qué está pasando. MISIÓN = qué necesitas conseguir. MOVIMIENTO = qué dices o haces.
BIEN: "Identificar el cuello de botella real que frena el cierre."
BIEN: "Traducir la comparación de ciudades a criterios de inversión concretos."
BIEN: "Justificar la diferencia de precio con valor diferencial del activo."
MAL: repetir la lectura con otras palabras.
MAL: repetir el next_move reformulado como objetivo.

JOURNEY.NOW — momento procesual
Dónde está la conversación en su arco táctico. 3-6 palabras. Diferente de signal (que clasifica) y reading (que interpreta).
signal="objeción de precio" → journey.now="resolviendo freno principal"
signal="falta de familiaridad" → journey.now="articulando criterio de duda"
signal="interés real" → journey.now="validando antes de avanzar"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLA ANTI-REPETICIÓN — MÁS IMPORTANTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Antes de generar el nuevo say_now, determina cuál de estas 5 cosas ha ocurrido:

1. El cliente ha respondido CLARAMENTE a la jugada anterior → AVANZA al siguiente micro-paso
2. El cliente ha respondido PARCIALMENTE → profundiza en lo que quedó pendiente
3. El cliente ha EVITADO responder → detecta la evasión, decide si presionar o rodear
4. El cliente ha abierto un FRENTE NUEVO → cambia el eje de la conversación
5. El cliente ha CAMBIADO EL EJE COMPLETAMENTE → reorienta todo el análisis

REGLA ABSOLUTA — CASO 1:
Si el cliente ya respondió claramente, está PROHIBIDO repetir la misma jugada o una que equivalga a lo mismo.
En ese caso, avanza. Micro-pasos posibles:
- concretar el impacto del freno
- cuantificar la magnitud del problema
- reenfocar hacia el criterio real subyacente
- resolver la objeción concretamente
- comparar con datos reales disponibles
- proponer un microcompromiso

Ejemplo de lo PROHIBIDO:
- jugada anterior: "confirma si le preocupan los gastos de mantenimiento"
- cliente responde: "sí, eso me preocupa"
- jugada PROHIBIDA: "confirma si teme los gastos de mantenimiento" (igual o casi igual)
- jugada CORRECTA: "concreta si teme el coste anual o derramas imprevisibles" /
  "pregunta cuánto le frena ese coste en la rentabilidad esperada"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLASIFICACIÓN DE DUDAS Y OBJECIONES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEÑALES DE DUDA INICIAL (antes de objeción formada):
- falta de familiaridad: no conoce el activo, ciudad, marca — no rechaza, simplemente no conoce
- duda abierta: preocupación vaga, criterio no articulado
- necesita criterio: no tiene marco para decidir
- falta confianza inicial: escepticismo de entrada, no rechazo activo
- objeción incipiente: freno que empieza a surgir, no consolidado

REGLA ANTI-SOBREDIAGNÓSTICO:
Si la otra parte dice "no conozco la ciudad", "no me suena", "no tengo referencias", "no me da confianza todavía" — NO es automáticamente objeción reputacional fuerte.
Primero evalúa: ¿falta familiaridad? ¿duda abierta? ¿necesita criterio? Si es así, úsalo.
La jugada es concretar el criterio de duda, no defender el activo ni disparar datos.

OBJECIÓN YA FORMADA:
- real: freno genuino basado en criterio concreto
- superficial: duda que se disipa con información o reencuadre
- falsa: excusa que esconde otra objeción o falta de interés real
- duda genuina: falta de información o claridad, no resistencia
- miedo a equivocarse: riesgo percibido, falta de confianza en la decisión
- miedo a comprometerse: interés real, resistencia al paso
- desconfianza: escepticismo activo, experiencia previa negativa
- resistencia emocional: rechazo no basado en criterio racional
- objeción de precio: coste como freno o pretexto
- objeción de liquidez/salida: preocupación por poder deshacer o vender
- objeción de reputación/zona: solo cuando la crítica a la zona YA está articulada
- objeción de timing: dilación sin razón clara
- interés real con resistencia de cierre: le interesa pero no da el paso

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLA DE COMPARACIONES Y ALTERNATIVAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cuando mencionen una alternativa (otra ciudad, producto, proveedor, inversión), NO entres en comparación directa automáticamente.

Pregúntate primero:
1. ¿La alternativa es el centro del problema o revela el criterio que esta persona valora?
2. ¿Qué atributo le atrae de la alternativa? (seguridad, demanda, liquidez, reputación, familiaridad, menor riesgo…)
3. ¿Conviene mantener el foco o entrar en el debate?

Regla: la alternativa revela el criterio. El criterio es lo que hay que trabajar.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLA ESPECIAL — ATRIBUTOS YA REVELADOS EN COMPARACIÓN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Esta regla se aplica cuando la otra parte ya ha enumerado atributos concretos de una alternativa.

Si la otra parte ya ha enumerado atributos de la alternativa, está PROHIBIDO volver a preguntar
"qué valoras de X", "qué te gusta de X" o cualquier variante.

Esa pregunta ya está respondida. Los atributos son la respuesta.

En ese momento el motor debe avanzar a:
FASE B → traducir los atributos a criterios de inversión reales
FASE C → reenfocar esos criterios sobre la propuesta actual
FASE D → usar datos o argumentos concretos si ya toca y están disponibles
FASE E → avanzar a validación o cierre si los criterios quedan cubiertos

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SAY_NOW — REGLAS DE CALIDAD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4-12 palabras. Imperativo. Concreto. Útil en llamada real. Una sola acción principal.

BIEN: "pregunta qué criterio le frena exactamente", "concreta si teme demanda o salida",
"baja la objeción a alquiler o reventa", "usa una pregunta cerrada ahora"
MAL: "explora sus preocupaciones", "valida sus emociones", "profundiza más"

Si la objeción es sobre ciudad/producto/propuesta: SAY_NOW debe aterrizar la crítica
en criterios de decisión concretos, no explorar la vaguedad.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AVOID
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2-7 palabras. Solo cuando hay un error táctico real y probable ahora mismo.
Si no hay un error concreto y probable, pon null. No inventes avoids genéricos.
BIEN: "no dispares datos aún", "no cierres todavía", "no debatas la alternativa"
MAL: "no seas agresivo", "no ignores sus sentimientos"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DETAIL.SUPPORT — JERARQUÍA DE DATOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Si hay datos reales en el contexto de sesión o memoria Y tácticamente ya es el momento → cítalos exactamente y explica cómo usarlos en conversación
2. Si no hay datos reales pero ya se conoce el criterio del cliente → sugiere exactamente qué tipo de dato o argumento conviene usar AHORA y cómo vincularlo al criterio revelado
3. Si todavía no toca datos (criterio aún no concretado) → da criterio de reenfoque táctico

NUNCA: inventar cifras, citar estudios que no existen, usar datos antes de concretar la duda.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREGUNTA CERRADA Y CIERRE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Solo cuando se cumplan TODAS:
✓ Objeción principal suficientemente resuelta o aclarada
✓ Señales de interés real
✓ Sin frentes importantes abiertos
✓ La conversación ha madurado
✓ El siguiente paso natural es un microcompromiso

Si hay objeción activa, duda difusa, resistencia o falta de criterio: no toca cerrar.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CALL_MEMORY — REESCRITURA INTELIGENTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
summary_lines: 4-6 líneas. No transcript. No log de eventos. Resumen táctico útil.
Incluye: fases superadas, objeción dominante, tipo de objeción, momento actual, objetivo.
Reescribe y comprime cada turno. No crecer infinito. Máximo 6 líneas.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOMENTUM — ESTADO GLOBAL DE LA LLAMADA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"green" — interés real manifestado + conversación bien orientada + apertura activa
"amber" — sin claridad todavía / objeción presente pero trabajable / diagnóstico en curso
"red" — resistencia alta / desconfianza activa / objeción creciendo / bloqueo / evasión

REGLA: si hay objeción fuerte pero ya bien aterrizada y trabajable → amber, no red.
Si hay interés real aunque con dudas → green o amber según apertura.

Responde SIEMPRE con JSON puro sin markdown ni texto extra.`;

const BASE_SYSTEM_PROMPT = USE_OPTIMIZED_PROMPTS ? BASE_SYSTEM_PROMPT_V2 : BASE_SYSTEM_PROMPT_V1;

// ── Structured context type (mirrors AnalyzeConversationBody's structured_context) ──
type StructuredCtx = {
  meeting_goal?: string;
  previous_blocker?: string;
  blocker_status?: "open" | "resolved" | "partially_resolved";
  what_not_to_do_today?: string;
  desired_deliverable_today?: string;
};

function buildStructuredContextBlock(ctx: StructuredCtx | undefined, lang?: string): string {
  if (!ctx) return "";
  const isEn = lang === "en";
  const lines: string[] = [];
  if (ctx.meeting_goal?.trim()) {
    lines.push(isEn ? `Today's goal: ${ctx.meeting_goal}` : `Objetivo hoy: ${ctx.meeting_goal}`);
  }
  if (ctx.previous_blocker?.trim()) {
    const statusMap: Record<string, string> = {
      open: isEn ? "still open" : "sigue abierto",
      resolved: isEn ? "resolved" : "resuelto",
      partially_resolved: isEn ? "partially resolved" : "parcialmente resuelto",
    };
    const status = ctx.blocker_status ? ` (${statusMap[ctx.blocker_status] ?? ctx.blocker_status})` : "";
    lines.push(isEn ? `Previous blocker: ${ctx.previous_blocker}${status}` : `Bloqueo previo: ${ctx.previous_blocker}${status}`);
  }
  if (ctx.what_not_to_do_today?.trim()) {
    lines.push(isEn ? `What NOT to do today: ${ctx.what_not_to_do_today}` : `Qué NO hacer hoy: ${ctx.what_not_to_do_today}`);
  }
  if (ctx.desired_deliverable_today?.trim()) {
    lines.push(isEn
      ? `Valid result today (even without close): ${ctx.desired_deliverable_today}`
      : `Resultado válido hoy (aunque no haya cierre): ${ctx.desired_deliverable_today}`
    );
  }
  if (lines.length === 0) return "";
  const header = isEn ? "PRE-CALL STRUCTURED CONTEXT" : "CONTEXTO ESTRUCTURADO PRE-LLAMADA";
  const footer = isEn
    ? "This context is prior to the call. The real conversation may reveal a different axis — if so, prioritize what is actually happening."
    : "Este contexto es previo a la llamada. La conversación real puede revelar un eje distinto — si lo hace, prioriza el eje actual.";
  return `\n${header}:\n${lines.join("\n")}\n${footer}`;
}

function buildSystemPrompt(
  context?: string,
  lang?: string,
  structuredCtx?: StructuredCtx,
  speakerConfidence?: number,
  listenReliability?: "high" | "medium" | "low",
  sayNowLoopCount?: number,
  brainId?: string,
): string {
  const isEn = lang === "en";

  // Check if the context includes name identification markers
  // (these are appended by the frontend when names are extracted from session context)
  const hasNameId = context?.includes("[IDENTIFICACIÓN DE SPEAKERS:") || context?.includes("[SPEAKER ID:");

  const contextBlock = context?.trim()
    ? (isEn
      ? `\nSESSION CONTEXT:\n${context.trim()}\nUse concrete data from this context in detail.support when tactically appropriate.\n\nSPEAKER ROLES:\n[ME] = the seller (user of this tool). Initiates, explains, proposes, closes.\n[CLIENT] = the prospect/buyer. Questions, doubts, objects, decides.${hasNameId ? "\n\nIMPORTANT — NAME-BASED ATTRIBUTION: The context above includes identified speaker names (format: [ME]=Name, [CLIENT]=Name). When the transcript contains these names — even in an UNKNOWN-labeled fragment — use them to determine who is speaking and provide specific, name-aware coaching. A fragment mentioning the seller's name is almost certainly a [ME] turn. A fragment mentioning the buyer's name is almost certainly a [CLIENT] turn. Apply this inference actively even when the automatic attribution label is UNKNOWN." : "\n\nWhen a fragment has no speaker label or attribution is uncertain, interpret it at a macro tactical level — do not make strong assumptions about who said what when the label is absent or low-confidence."}`
      : `\nCONTEXTO DE SESIÓN:\n${context.trim()}\nUsa datos concretos de este contexto en detail.support cuando sea tácticamente oportuno.\n\nROLES EN ESTA CONVERSACIÓN:\n[YO] = el vendedor — quien usa esta herramienta. Inicia la conversación, explica el producto, propone, cierra.\n[CLIENTE] = el comprador/decisor — la persona a quien se intenta vender. Pregunta, duda, plantea objeciones, decide.${hasNameId ? "\n\nIMPORTANTE — ATRIBUCIÓN POR NOMBRES: El contexto incluye nombres identificados (formato: [YO]=Nombre, [CLIENTE]=Nombre). Cuando la transcripción contenga estos nombres — incluso en fragmentos con etiqueta UNKNOWN — úsalos para determinar quién habla y proporciona coaching específico con nombres. Un fragmento que mencione el nombre del vendedor es casi con certeza un turno de [YO]. Un fragmento que mencione el nombre del cliente es casi con certeza un turno de [CLIENTE]. Aplica esta inferencia de forma activa aunque la etiqueta automática de atribución sea UNKNOWN." : "\n\nCuando un fragmento no tenga etiqueta de speaker o la atribución sea incierta, interpreta el fragmento a nivel táctico macro — no hagas suposiciones fuertes sobre quién dijo qué cuando la etiqueta esté ausente o sea de baja confianza."}`)
    : "";

  const structuredBlock = buildStructuredContextBlock(structuredCtx, lang);

  const langRule = lang === "en"
    ? `\nLANGUAGE: The call is in English. ALL JSON field values MUST be in English.`
    : `\nIDIOMA: La llamada es en español. TODOS los valores JSON en español.`;

  const speakerGuardrail = (speakerConfidence !== undefined && speakerConfidence < 0.55)
    ? (lang === "en"
      ? `\nSPEAKER WARNING: Speaker attribution confidence is LOW (${(speakerConfidence * 100).toFixed(0)}%). The speaker label on this fragment may be incorrect. Do NOT make strong assumptions about who said what. Keep tactical advice general and avoid speaker-specific memory updates.`
      : `\nADVERTENCIA SPEAKER: La confianza de atribución de speaker es BAJA (${(speakerConfidence * 100).toFixed(0)}%). La etiqueta de speaker puede ser incorrecta. NO hagas suposiciones fuertes sobre quién habló. Mantén el consejo táctico general y evita actualizar memoria basada en este turno.`)
    : "";

  const reliabilityBlock = listenReliability === "low"
    ? (lang === "en"
      ? `\nLISTEN RELIABILITY: LOW — Session signal quality is poor (high speaker ambiguity, multiple analysis failures, or fragmented transcript). In low-reliability mode: (1) DO NOT give hyper-specific turn-level instructions; (2) DO NOT reference who said what unless clearly labeled; (3) Focus on HIGH-LEVEL orientation only; (4) Acknowledge signal limits in your reading when relevant; (5) say_now MUST be macro and actionable without precise attribution — e.g. "Orient next question toward budget or timeline" not "Confirm the specific objection she just raised".`
      : `\nFIABILIDAD DE ESCUCHA: BAJA — La calidad de señal es pobre (alta ambigüedad de hablante, múltiples fallos de análisis o transcripción fragmentada). En modo baja fiabilidad: (1) NO des instrucciones hiperprecisas de turno; (2) NO referencíes quién dijo qué salvo etiqueta clara; (3) Focaliza en ORIENTACIÓN DE ALTO NIVEL únicamente; (4) Reconoce las limitaciones de señal en tu lectura cuando sea relevante; (5) El say_now DEBE ser macro y accionable sin atribución precisa — p.ej. "Orienta la siguiente pregunta a presupuesto o plazo" en lugar de "Confirma la objeción específica que acaba de plantear".`)
    : listenReliability === "medium"
      ? (lang === "en"
        ? `\nLISTEN RELIABILITY: MEDIUM — Speaker attribution is partially uncertain. Moderate your tactical precision: avoid strong assumptions about who said specific things unless labeled. Keep advice actionable but slightly less micro-specific than in a high-confidence session.`
        : `\nFIABILIDAD DE ESCUCHA: MEDIA — La atribución de hablante es parcialmente incierta. Modera tu precisión táctica: evita suposiciones fuertes sobre quién dijo qué salvo etiqueta clara. Mantén el consejo accionable pero ligeramente menos micro-específico que en sesión de alta confianza.`)
      : "";

  const loopBreakerBlock = (sayNowLoopCount !== undefined && sayNowLoopCount >= 3)
    ? (lang === "en"
      ? `\nANTI-LOOP OVERRIDE (CRITICAL): The same say_now has repeated approximately ${sayNowLoopCount} consecutive turns. This is a coaching failure. You MUST generate a COMPLETELY DIFFERENT say_now — not a paraphrase of the previous one. Change the tactical axis entirely: if previous advice asked a question, now recommend a statement or concrete action. If it explored a topic, now recommend advancing to next stage. The say_now for this turn must be detectably different from any recent pattern.`
      : `\nANULACIÓN ANTI-LOOP (CRÍTICO): El mismo say_now se ha repetido aproximadamente ${sayNowLoopCount} turnos consecutivos. Esto es un fallo de coaching. DEBES generar un say_now COMPLETAMENTE DIFERENTE — no una paráfrasis del anterior. Cambia el eje táctico por completo: si el consejo anterior hacía una pregunta, ahora recomienda una declaración o acción concreta. Si exploraba un tema, ahora recomienda avanzar a la siguiente etapa. El say_now de este turno debe ser detectablemente diferente de cualquier patrón reciente.`)
    : "";

  const liveBrainBlock = buildCopilotLiveBrainBlock(brainId, isEn ? "en" : "es");

  return `${BASE_SYSTEM_PROMPT}${liveBrainBlock ? `\n${liveBrainBlock}` : ""}${contextBlock}${structuredBlock}${langRule}${speakerGuardrail}${reliabilityBlock}${loopBreakerBlock}`;
}

// ── POST /api/copilot/analyze ─────────────────────────────────────────────────
router.post("/copilot/analyze", async (req, res) => {
  const parseResult = AnalyzeConversationBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { text, context, call_memory, lang, structured_context, speaker_confidence, conversation_history, say_now_loop_count, listen_reliability } = parseResult.data;
  const brainId = (req.body as Record<string, unknown>)?.brainId as string | undefined;
  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? undefined;

  // Build user message: prefer real conversation history over compressed call_memory
  let userMessage: string;
  if (conversation_history && conversation_history.length > 0) {
    userMessage = [
      `HISTORIAL DE CONVERSACIÓN:\n${conversation_history.join("\n")}`,
      "JSON táctico:",
    ].join("\n\n");
  } else {
    userMessage = [
      call_memory ? `MEMORIA ACUMULADA:\n${call_memory.split("\n").slice(-6).join("\n")}` : null,
      `FRAGMENTO:\n${text}`,
      "JSON táctico:",
    ].filter(Boolean).join("\n\n");
  }

  const ANALYZE_MODEL = "gpt-4o-mini";
  const ANALYZE_TIMEOUT_MS = 25000;
  const t0 = Date.now();
  let status: "ok" | "error" | "partial" = "ok";
  const isEn = lang === "en";

  // ── Safe Zod fallback — guaranteed to pass schema validation ──────────────────
  // Rotates say_now from a pool so the fallback itself never causes a say_now loop.
  const FALLBACK_SAY_NOWS_ES = [
    "Reformula la pregunta clave sin presionar",
    "Concreta el siguiente micro-paso concreto",
    "Verifica si el cliente tiene la información que necesita",
    "Identifica el criterio real que frena la decisión",
    "Resume el punto más importante acordado hasta ahora",
    "Pregunta qué necesitaría para dar el siguiente paso",
  ];
  const FALLBACK_SAY_NOWS_EN = [
    "Clarify the key question without pressure",
    "Identify the next concrete micro-step",
    "Check if the client has the information they need",
    "Find out the real criterion blocking the decision",
    "Summarize the most important point agreed so far",
    "Ask what they would need to take the next step",
  ];
  const buildSafeFallback = () => {
    const pool = isEn ? FALLBACK_SAY_NOWS_EN : FALLBACK_SAY_NOWS_ES;
    const say_now = pool[Math.floor(Math.random() * pool.length)];
    return AnalyzeConversationResponse.parse({
      signal: isEn ? "analysis recovering" : "análisis recuperándose",
      say_now,
      avoid: null,
      detail: null,
      journey: null,
      call_memory: null,
      momentum: "amber",
    });
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);

    let completion: Awaited<ReturnType<typeof openai.chat.completions.create>>;
    try {
      completion = await openai.chat.completions.create(
        {
          model: ANALYZE_MODEL,
          max_tokens: 1400,
          messages: [
            { role: "system", content: buildSystemPrompt(context, lang, structured_context, speaker_confidence, listen_reliability, say_now_loop_count, brainId) },
            { role: "user", content: userMessage },
          ],
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "copilot/analyze",
        endpoint: "analyze",
        sessionId,
        mode: "copilot",
        model: ANALYZE_MODEL,
        maxTokensConfigured: 1400,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }

    const rawContent = completion.choices[0]?.message?.content ?? "";

    let parsed: unknown;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawContent);
    } catch {
      status = "partial";
      req.log.warn({ rawContent: rawContent.slice(0, 200) }, "Failed to parse AI response as JSON — using safe fallback");
      parsed = null;
    }

    // Zod parse inside its own guard — never let validation failure reach the outer catch
    let validated;
    if (parsed !== null) {
      try {
        validated = AnalyzeConversationResponse.parse(parsed);
      } catch {
        status = "partial";
        req.log.warn("Zod validation failed on AI response — using safe fallback");
        validated = buildSafeFallback();
      }
    } else {
      validated = buildSafeFallback();
    }

    res.json(validated);
  } catch (err) {
    const latencyMs = Date.now() - t0;
    logAICall({
      route: "copilot/analyze",
      endpoint: "analyze",
      sessionId,
      mode: "copilot",
      model: ANALYZE_MODEL,
      maxTokensConfigured: 900,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs,
      status: "error",
    });
    req.log.error({ err }, "Error calling OpenAI for analyze");
    // Return a valid 200 response so the UI stays alive — never let the UI hang on a failed turn.
    // _runtime_error: true signals the frontend to show an error indicator without overwriting memory.
    const isEn = lang === "en";
    res.json({
      signal: isEn ? "⚠ analysis error" : "⚠ error de análisis",
      say_now: isEn
        ? "Analysis unavailable — API error. Continue naturally."
        : "Análisis no disponible — error de API. Continúa con naturalidad.",
      avoid: null,
      detail: null,
      journey: null,
      call_memory: null,
      momentum: "red",
      _runtime_error: true,
    });
  }
});

// ── POST /api/copilot/summarize ───────────────────────────────────────────────
router.post("/copilot/summarize", async (req, res) => {
  const parseResult = CallSummarizeBody.safeParse(req.body);
  if (!parseResult.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const { call_memory, outcome, lang, full_report, speaker_uncertainty, analyze_failure_count, conversation_excerpt, imported_transcript, whisper_transcript } = parseResult.data;
  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? undefined;
  const isEn = lang === "en";

  const memoryText = call_memory?.length
    ? call_memory.map(l => `- ${l}`).join("\n")
    : (isEn ? "(No call data available)" : "(Sin datos de llamada disponibles)");

  // ── Reliability penalty — injected when analyze had runtime errors ──────────
  const failCount = analyze_failure_count ?? 0;
  const isUnreliable = failCount > 0;
  const reliabilityBlock = isUnreliable
    ? (isEn
        ? `\nRUNTIME RELIABILITY PENALTY (mandatory, apply before any other rule):
${failCount} analysis turn(s) failed to produce AI output during this session (API errors or parse failures).
Required: score MUST be ≤ 5.0 — insufficient data to produce a reliable coaching evaluation.
Required: debrief_reliable: false in the JSON response.
Required: global_state MUST reflect data insufficiency ("unreliable" / "data gap" / "incomplete").
Required: note this limitation explicitly in improvements[0] and in full_report if generated.
This is NOT a critique of the seller — it means VELA had too little data to coach.`
        : `\nPENALIZACIÓN DE FIABILIDAD EN RUNTIME (obligatoria, aplica antes que cualquier otra regla):
${failCount} turno(s) de análisis fallaron sin producir output de IA durante esta sesión (errores de API o fallos de parseo).
Obligatorio: score DEBE ser ≤ 5.0 — datos insuficientes para una evaluación de coaching fiable.
Obligatorio: debrief_reliable: false en el JSON de respuesta.
Obligatorio: global_state DEBE reflejar la insuficiencia de datos ("no fiable" / "sin datos" / "incompleto").
Obligatorio: señala esta limitación explícitamente en improvements[0] y en full_report si se genera.
Esto NO es crítica al vendedor — significa que VELA tuvo datos insuficientes para hacer coaching.`)
    : "";

  // ── Conversation source — priority: imported_transcript > whisper_transcript > conversation_excerpt ─
  const excerptBlock = imported_transcript?.trim()
    ? (isEn
        ? `\nCONVERSATION TRANSCRIPT (manually verified — use as primary source):\n${imported_transcript.trim()}`
        : `\nTRANSCRIPCIÓN DE CONVERSACIÓN (verificada manualmente — usa como fuente principal):\n${imported_transcript.trim()}`)
    : whisper_transcript?.trim()
      ? (isEn
          ? `\nCONVERSATION TRANSCRIPT (Whisper audio transcription — high quality, use as primary source):\n${whisper_transcript.trim()}`
          : `\nTRANSCRIPCIÓN DE CONVERSACIÓN (transcripción de audio Whisper — alta calidad, usa como fuente principal):\n${whisper_transcript.trim()}`)
      : (conversation_excerpt && conversation_excerpt.length > 0)
        ? (isEn
            ? `\nCONVERSATION EXCERPT (last ${conversation_excerpt.length} turns — more accurate than compressed memory):\n${conversation_excerpt.join("\n")}`
            : `\nEXTRACTO DE CONVERSACIÓN (últimos ${conversation_excerpt.length} turnos — más preciso que la memoria comprimida):\n${conversation_excerpt.join("\n")}`)
        : "";

  const outcomeText = outcome ?? (isEn ? "unclear" : "no claro");
  const wantsFullReport = !!full_report;

  const speakerUncertaintyBlock = speaker_uncertainty?.high
    ? (isEn
        ? `\nSPEAKER UNCERTAINTY HIGH: ${speaker_uncertainty.unknown_turns ?? "?"} of ${speaker_uncertainty.total_turns ?? "?"} turns (${Math.round((speaker_uncertainty.rate ?? 0) * 100)}%) were UNKNOWN in auto mode. Tactical reads may be contaminated. DO NOT make strong causal conclusions about conversational control or seller behavior unless supported by explicit memory evidence. Flag any control-related weakness with lower confidence.`
        : `\nALTA INCERTIDUMBRE DE HABLANTE: ${speaker_uncertainty.unknown_turns ?? "?"} de ${speaker_uncertainty.total_turns ?? "?"} turnos (${Math.round((speaker_uncertainty.rate ?? 0) * 100)}%) fueron UNKNOWN en modo automático. Las lecturas tácticas pueden estar contaminadas. NO saques conclusiones causales fuertes sobre control conversacional o comportamiento del vendedor salvo que haya evidencia explícita en la memoria. Señala cualquier debilidad de control con confianza reducida.`)
    : "";

  // Fix B: lighter score-reliability note when unknown_rate is >35% but not yet at the "high" threshold (>40%)
  const speakerScoreNote = (speaker_uncertainty?.rate ?? 0) > 0.35 && !speaker_uncertainty?.high
    ? (isEn
        ? `\nSCORE RELIABILITY NOTE: Speaker attribution was moderately uncertain for this session (${Math.round((speaker_uncertainty!.rate ?? 0) * 100)}% unknown turns). Do not inflate the score if the transcript is ambiguous about who said what — the score should reflect this attribution uncertainty.`
        : `\nNOTA DE FIABILIDAD DEL SCORE: La atribución de hablantes de esta sesión fue moderadamente incierta (${Math.round((speaker_uncertainty!.rate ?? 0) * 100)}% de turnos desconocidos). No inflés la nota si el transcript es ambiguo sobre quién habló qué — el score debe reflejar esta incertidumbre de atribución.`)
    : "";

  // ── Compact bilingual summarize prompt (shared structure, lang-switched values)
  const fullReportInstructions = wantsFullReport
    ? (isEn
        ? `FULL REPORT — use exactly these section headers, plain text, dashes only:
Executive summary: [2-4 sentences]
What went well:\n- [tactical observation]\n- [tactical observation]
What can be improved:\n- [tactical observation]\n- [tactical observation]
Objections or risks detected:\n- [how handled or: None detected]
Conversation control: [1-3 sentences]
Close / next step: [1-3 sentences]
Recommendation for next call: [1-3 concrete sentences]
TONE: honest, tactical. No motivational fluff. No generic phrases.`
        : `REPORTE COMPLETO — usa exactamente estas secciones, texto plano, solo guiones:
Resumen ejecutivo: [2-4 frases]
Lo que se hizo bien:\n- [observación táctica]\n- [observación táctica]
Lo que se puede mejorar:\n- [observación táctica]\n- [observación táctica]
Objeciones o riesgos detectados:\n- [cómo se gestionó o: Sin objeciones significativas]
Control de la conversación: [1-3 frases]
Cierre / siguiente paso: [1-3 frases]
Recomendación para la próxima llamada: [1-3 frases concretas]
TONO: honesto, táctico. Sin coach barato. Sin frases genéricas.`)
    : (isEn ? "full_report: null (not requested)." : "full_report: null (no solicitado).");

  const systemPrompt = isEn
    ? `You are an expert sales call analyst. Evaluate a completed sales call based on its tactical memory and reported outcome.

Return EXACTLY this JSON, no markdown, no extra text:
{"score":7.4,"global_state":"strong","result_label":"Next step agreed","strengths":["s1","s2"],"improvements":["i1","i2"],"full_report":${wantsFullReport ? '"report text"' : "null"},"debrief_reliable":true}
${reliabilityBlock}

SCORING (0-10, conditional on execution quality):
8.5-9.5: Real close, good execution, no unresolved technical objections, no overclaiming
7.5-8.4: Clear next step, good execution, no unresolved technical objections, no overclaiming
6.0-7.4: Workable, partial progress, visible tactical weaknesses
4.0-5.9: Weak result, relevant errors, inconsistent control
0-3.9: Failed call or no real advance
CONDITIONAL CAPS — apply before scoring:
— next_step + major technical objection deferred to documents without in-call resolution → cap 6.5
— next_step + overclaiming, false guarantee, or "100% safe" used as main argument → cap 6.5
— next_step + no agreed decision criterion for next call → penalize, note as weakness
— next_step with any of the above: global_state CANNOT be "strong". Use "solid", "workable", or weaker.
Short efficient calls are NOT penalized for brevity. But softness IS penalized.

STAGE ADVANCE vs FAILED CLOSE — distinguish before scoring:
— If the call achieved stage clarity, criterion alignment, or a concrete next step with a specific deliverable, score as a real advance. Do NOT treat it as a failed close unless conditions for closing were genuinely met and wasted.
— Explaining a commercial process step (sending a proposal, scheduling a review) is NOT a close attempt. Only count as a close attempt if there was an explicit request for immediate commitment.
— Historical objections from context do not dominate if the actual transcript axis was different. Score based on what actually happened.
NEXT STEP QUALITY — reflect in scoring:
— strong: date/time + deliverable + explicit decision criterion → treat as solid outcome (7.5-8.4 range if well executed). Global_state can be "strong" or "solid".
— useful: date/time or concrete channel (video call, email, meeting link) or concrete deliverable (proposal, contract, summary, info to send) → treat as real advance (6.5-7.5). Do NOT describe as "open conversation" or "no clear commitment". The next step existed and was operative.
— weak: no date, no channel, no deliverable → note as gap and penalize. Global_state should not be "strong".
IMPORTANT: "useful" is a real advance. Penalize for missing decision criterion as a note, but do NOT degrade it to "no commitment" or "open result".

WEAK EXIT SIGNAL — detect and label correctly:
If the client's exit was: "send me something", "I'll look at it if I have time", "we'll see", "let me know later", "I have to go", "send me another proposal", "I'll think about it" — WITHOUT an explicit date, channel, or concrete next step, this is NOT "Next step agreed". It is a weak handoff.
result_label must be: "Weak follow-up" (not "Next step agreed", not "Advancing")
global_state must be: "weak" or "open" — NOT "strong", "solid", or "advancing"
score must be capped at 5.9 — soft exits are tactical failures, not successes.
Only use "Next step agreed" when there is a CONCRETE commitment: specific date or time + specific channel or deliverable + explicit agreement to that step.

GLOBAL STATE: 1-2 words (strong/solid/advancing/workable/weak/blocked/lost/open)
STRENGTHS: 2-3 specific tactical observations. No generic praise.
IMPROVEMENTS: 2-3 specific, honest tactical observations.

${fullReportInstructions}`
    : `Eres analista experto de llamadas de venta. Evalúa la llamada basándote en la memoria táctica y el resultado declarado.

Devuelve EXACTAMENTE este JSON, sin markdown, sin texto extra:
{"score":7.4,"global_state":"fuerte","result_label":"Siguiente paso acordado","strengths":["f1","f2"],"improvements":["m1","m2"],"full_report":${wantsFullReport ? '"texto del reporte"' : "null"},"debrief_reliable":true}
${reliabilityBlock}

PUNTUACIÓN (0-10, condicional por calidad de ejecución):
8.5-9.5: Cierre real, buena ejecución, sin objeciones técnicas abiertas, sin sobrepromesa
7.5-8.4: Siguiente paso claro, buena ejecución, sin objeciones técnicas abiertas, sin sobrepromesa
6.0-7.4: Llamada trabajable, progreso parcial, debilidades tácticas evidentes
4.0-5.9: Resultado débil, errores relevantes, control irregular
0-3.9: Llamada fallida o sin avance real
LÍMITES CONDICIONALES — aplica antes de puntuar:
— siguiente paso + objeción técnica relevante derivada a documentación sin resolver en llamada → máximo 6.5
— siguiente paso + sobrepromesa, garantía falsa o "100% seguro" usado como argumento principal → máximo 6.5
— siguiente paso + sin criterio de decisión acordado para la próxima llamada → penalizar, señalar como debilidad
— siguiente paso con cualquiera de los anteriores: global_state NO puede ser "fuerte". Usar "sólida", "trabajable" o menor.
Llamadas cortas y eficaces NO se penalizan por brevedad. Pero la blandura SÍ se penaliza.

AVANCE DE ETAPA vs FALLO DE CIERRE — distinguir antes de puntuar:
— Si la llamada consiguió claridad de etapa, encaje de criterio o siguiente paso con entregable concreto, puntúa como avance real. NO trates como fallo de cierre a menos que las condiciones de cierre estuvieran dadas y no se aprovecharan.
— Explicar un paso del proceso comercial (enviar propuesta, agendar revisión) NO es intento de cierre. Solo cuenta si hubo petición explícita de compromiso inmediato.
— Las objeciones históricas del contexto no dominan si el eje real de la llamada fue otro. Puntúa según lo que ocurrió realmente.
CALIDAD DEL SIGUIENTE PASO — refleja en la puntuación:
— fuerte: fecha/hora + entregable + criterio de decisión explícito → resultado sólido (7.5-8.4 si bien ejecutado). Global_state puede ser "fuerte" o "sólida".
— útil: fecha/hora o canal concreto (videollamada, correo, enlace de reunión) o entregable concreto (propuesta, contrato, resumen, info a enviar) → avance real (6.5-7.5). NO describir como "conversación abierta" ni "sin compromiso claro". El siguiente paso existió y era operativo.
— débil: sin fecha, sin canal, sin entregable → señala como debilidad, penaliza. Global_state no puede ser "fuerte".
IMPORTANTE: "útil" es un avance real. Penaliza por falta de criterio de decisión como nota, pero NO lo degrades a "sin compromiso" ni "resultado abierto".

SEÑAL DE SALIDA DÉBIL — detecta y etiqueta correctamente:
Si el cliente se fue con frases como: "pásame algo", "si tengo tiempo lo miro", "lo vamos viendo", "ya te digo", "me tengo que ir", "mándame otra propuesta", "lo pienso" — SIN fecha, canal ni siguiente paso concreto acordado, esto NO es "Siguiente paso acordado". Es un arrastre débil.
result_label debe ser: "Seguimiento débil" (no "Siguiente paso acordado", no "Avanzando")
global_state debe ser: "floja" o "abierta" — NO "fuerte", "sólida" ni "avanzando"
score debe estar limitado a 5.9 — las salidas blandas son fallos tácticos, no éxitos.
Solo usa "Siguiente paso acordado" cuando hay un compromiso CONCRETO: fecha o hora específica + canal o entregable concreto + acuerdo explícito sobre ese paso.

ESTADO GLOBAL: 1-2 palabras (fuerte/sólida/avanzando/trabajable/floja/bloqueada/perdida/abierta)
PUNTOS FUERTES: 2-3 observaciones tácticas específicas. Sin elogios genéricos.
PUNTOS A MEJORAR: 2-3 observaciones tácticas específicas y honestas.

${fullReportInstructions}`;

  const userMessage = `${isEn ? "TACTICAL CALL MEMORY" : "MEMORIA TÁCTICA"}:\n${memoryText}${excerptBlock}\n\n${isEn ? "REPORTED OUTCOME" : "RESULTADO DECLARADO"}: ${outcomeText}${speakerUncertaintyBlock}${speakerScoreNote}\n\n${isEn ? "Analyze and return JSON:" : "Analiza y devuelve el JSON:"}`;

  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: wantsFullReport ? 1600 : 400,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "copilot/summarize",
        endpoint: wantsFullReport ? "summarize-full" : "summarize",
        sessionId,
        mode: "copilot",
        model: "gpt-4o-mini",
        maxTokensConfigured: wantsFullReport ? 1600 : 400,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }

    const rawContent = completion.choices[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawContent);
    } catch {
      parsed = {
        score: isUnreliable ? 3 : 5,
        global_state: isUnreliable ? (isEn ? "unreliable" : "no fiable") : (isEn ? "workable" : "trabajable"),
        result_label: outcomeText,
        strengths: [],
        improvements: isUnreliable
          ? [isEn ? `⚠ Debrief unreliable: ${failCount} analysis turn(s) failed — insufficient data` : `⚠ Debrief no fiable: ${failCount} turno(s) de análisis fallaron — datos insuficientes`]
          : [],
        full_report: null,
        debrief_reliable: !isUnreliable,
      };
    }

    const validated = CallSummarizeResponse.parse(parsed);
    res.json(validated);
  } catch (err) {
    req.log.error({ err }, "Error calling OpenAI for summarize");
    res.status(500).json({ error: "Error generating call summary" });
  }
});

// ── POST /api/copilot/audit-report ───────────────────────────────────────────
// Brutal post-session audit. Independent from summarize — no regression risk.
// Input: { call_memory, outcome, context?, lang, speaker_uncertainty? }
// Output: BrutalAudit JSON (with post-process sanity guardrail)
router.post("/copilot/audit-report", async (req, res) => {
  const {
    call_memory, outcome, context, lang = "es", speaker_uncertainty,
    closing_excerpt, session_summary, audit_hints_pack, human_notes, imported_transcript, whisper_transcript,
  } = req.body as {
    call_memory?: string[];
    outcome?: string;
    context?: string;
    lang?: string;
    speaker_uncertainty?: { high: boolean; rate?: number; unknown_turns?: number; total_turns?: number };
    closing_excerpt?: Array<{ turn: number; speaker: string; text: string }>;
    session_summary?: { score?: number; global_state?: string; result_label?: string; strengths?: string[]; improvements?: string[] };
    audit_hints_pack?: { likely_primary_failure?: string; suspected_soft_next_step?: string; next_step_quality?: string; audit_notes?: string[] };
    human_notes?: string;
    imported_transcript?: string;
    whisper_transcript?: string;
  };

  const isEn = lang === "en";
  const memoryText = (call_memory ?? []).map(l => `- ${l}`).join("\n") || (isEn ? "(No memory)" : "(Sin memoria)");
  const outcomeText = outcome ?? (isEn ? "unknown" : "desconocido");
  const contextText = context?.trim() ? `\n${isEn ? "SESSION CONTEXT" : "CONTEXTO"}: ${context.trim()}` : "";

  // ── Closing excerpt — most recent raw transcript turns (richer than call_memory) ─
  const closingLines = (closing_excerpt ?? [])
    .map(t => `[T${t.turn}] [${t.speaker}]: ${t.text}`)
    .join("\n");
  const hasClosingExcerpt = closingLines.length > 0;

  // ── Heuristic classifiers — run on COMBINED text (memory + closing excerpt) ──
  // Key fix: the closing excerpt has the actual dates/channels that compressed memory loses.
  const closingFullText = (closing_excerpt ?? []).map(t => t.text).join(" ").toLowerCase();
  const memoryFull = (call_memory ?? []).join(" ").toLowerCase();
  const combinedFull = memoryFull + " " + closingFullText;  // used for heuristics

  const isNextStep = (outcome ?? "") === "next_step";
  const isLost = (outcome ?? "") === "lost";

  const dateTimeTerms = ["fecha", "lunes", "martes", "miércoles", "jueves", "viernes", "mañana", "próxima semana", "próximo", "esta semana", "monday", "tuesday", "wednesday", "thursday", "friday", "tomorrow", "next week", ":00", " am ", " pm ", "a las ", "at "];
  const channelTerms = ["videollamada", "videoconferencia", "video call", "zoom", "teams", "google meet", "meet ", "correo", "e-mail", "email", "reunión", "reunion", "meeting", "llamada", "enlace", "link"];
  const deliverableTerms = ["propuesta", "contrato", "resumen", "documentación", "documentacion", "información", "summary", "proposal", "contract", "documentation", "agenda", "informe", "report", "presupuesto", "oferta", "dossier"];
  const decisionTerms = ["criterio", "condición", "criterion", "acordad", "agreed", "compromi", "commit"];

  // ── Run heuristics on COMBINED text (memory + closing excerpt) ────────────
  const hasDateTime = dateTimeTerms.some(t => combinedFull.includes(t));
  const hasChannel = channelTerms.some(t => combinedFull.includes(t));
  const hasDeliverable = deliverableTerms.some(t => combinedFull.includes(t));
  const hasOperativeCommitment = hasDateTime || hasChannel || hasDeliverable;
  const hasDecisionCriterion = decisionTerms.some(t => combinedFull.includes(t));

  // If frontend pre-computed hints_pack, use it as authoritative (it ran on closing excerpt too)
  type NsqType = "strong" | "useful" | "weak" | null;
  const backendNsq: NsqType = isNextStep
    ? (hasOperativeCommitment && hasDecisionCriterion ? "strong"
      : hasOperativeCommitment ? "useful"
      : "weak")
    : null;
  // Frontend hints take precedence when available (they ran on raw transcript text)
  const frontendNsq = audit_hints_pack?.next_step_quality as NsqType | undefined;
  const nextStepQuality: NsqType = frontendNsq ?? backendNsq;
  const likelyNoFailure = (audit_hints_pack?.likely_primary_failure === "none") || !isLost;

  // Alternatives decision pattern — also check human_notes for explicit mention
  const humanNotesLower = (human_notes ?? "").toLowerCase();
  const alternativesTerms = ["cuál de las dos", "cuál de los dos", "cuál elegir", "la a o", "la b o", "opción a o", "opción b", "alternativa a", "alternativa b", "option a or", "option b", "which of the two", "which one", "elegir entre", "comparar entre", "decidir entre", "entre las dos", "entre los dos", "entre ambas", "entre ambos", "dos opciones", "two options", "la otra opción", "the other option", "la primera o", "the first or"];
  const isAlternativesDecision = alternativesTerms.some(t => combinedFull.includes(t) || humanNotesLower.includes(t));

  // ── Premature close detection — objection active when close was attempted ──
  // Fires when the combined text shows (a) a factual objection AND (b) a close/commitment attempt.
  // Used to override likelyNoFailure and inject a hard audit guardrail.
  const activeObjectionTerms = [
    "cashflow", "cash flow", "flujo de caja", "flujo neto", "rentabilidad", "rendimiento",
    "demasiado caro", "muy caro", "precio alto", "precio elevado", "no me llega", "no tengo",
    "aportación mensual", "aportación mínima", "cuota mensual", "hipoteca", "monthly cost",
    "alternativa", "competidor", "la otra opción", "berlín", "valencia", "budapest",
    "no me convence", "tengo dudas", "no estoy seguro", "no lo veo claro", "no lo veo",
    "no encaja", "no cuadra", "no tiene sentido", "doesn't make sense", "not convinced",
    "objeción", "bloqueo", "freno", "the problem is", "el problema es", "my concern",
  ];
  const commitmentAttemptTerms = [
    "reserva", "reservation", "señal", "depósito", "deposit",
    "firma", "contrato", "contract", "escritura", "notaría",
    "formalizar", "avanzamos", "we move forward", "close the deal",
    "€1.500", "€ 1.500", "1500 €", "1,500", "€3.000", "€5.000",
    "reservar ahora", "reserve now", "puedes reservar", "you can reserve",
    "el siguiente paso es reservar", "next step is to reserve",
  ];
  const hasActiveObjection    = activeObjectionTerms.some(t => combinedFull.includes(t));
  const hasCommitmentAttempt  = commitmentAttemptTerms.some(t => combinedFull.includes(t));
  const prematureCloseAttempt = hasActiveObjection && hasCommitmentAttempt;

  // ── Generic reframe detection — concrete objection met with abstraction ──
  const rentObjectionTerms = [
    "rentabilidad", "renta baja", "alquiler bajo", "yield", "rent low", "2,3%", "2.3%",
    "poquísimo", "muy poco", "demasiado bajo", "very low", "too low",
    "media de zona", "media del barrio", "portal", "fotocasa", "idealista",
  ];
  const genericReframeTerms = [
    "patrimonio a largo plazo", "seguridad patrimonial", "largo plazo", "futuro patrimoni",
    "seguridad", "long-term wealth", "patrimony", "long term", "long-term security",
    "crecimiento patrimonial", "futuro a largo", "asset security",
  ];
  const hasRentObjection   = rentObjectionTerms.some(t => combinedFull.includes(t));
  const hasGenericReframe  = genericReframeTerms.some(t => combinedFull.includes(t));
  const genericReframeFlag = hasRentObjection && hasGenericReframe;

  // ── False dichotomy detection — presenting settled frames as open choices ──
  const dichotomyTerms = [
    "¿seguridad o rentabilidad", "seguridad o retorno", "seguridad o cashflow",
    "largo plazo o corto", "patrimonio o renta", "security or return", "security or cashflow",
    "long-term or short", "security vs return", "patrimony or yield",
  ];
  const falseDichotomyFlag = dichotomyTerms.some(t => combinedFull.includes(t))
    && hasActiveObjection;

  // ── Yield type mismatch detection — TYPE 1/2 objection reframed to TYPE 5 ──
  // Fires when memory/transcript shows the client asked about contract/market rent
  // AND the response was about yield on equity/capital (without an explicit bridge).
  const contractRentObjectionTerms = [
    "lo que paga el inquilino", "renta del contrato", "renta actual", "alquiler actual",
    "€", "por mes", "al mes", "la renta que tiene", "lo que entra", "what the tenant pays",
    "current rent", "actual rent", "actual lease", "monthly rent",
    "media de zona", "lo que dice idealista", "chatgpt", "zone average", "market says",
    "debería pagar más", "debería ser más", "should pay more",
  ];
  const equityReframeTerms = [
    "retorno sobre capital", "rentabilidad sobre capital", "roi", "roe",
    "sobre los 14", "sobre tu capital", "sobre lo que aportas", "sobre tu inversión",
    "financiación al 86", "financiación al 100", "apalancamiento", "leverage",
    "yield on equity", "return on capital", "return on investment", "on your equity",
    "on your capital", "on what you put in",
  ];
  const hasContractRentObjection = contractRentObjectionTerms.some(t => combinedFull.includes(t));
  const hasEquityReframe = equityReframeTerms.some(t => combinedFull.includes(t));
  const yieldTypeMismatchFlag = hasContractRentObjection && hasEquityReframe && hasActiveObjection;

  // ── Premature disqualification detection — asset abandoned before defence ──
  const disqualPhraseTerms = [
    "sigamos buscando", "busquemos otros", "otros inmuebles", "miramos otros",
    "puede que no sea", "puede no ser lo tuyo", "esto no encaja", "no encaja con tu",
    "let's explore other", "let's look at other", "other properties",
    "this may not be", "this doesn't fit", "find something else",
  ];
  const hasDisqualPhrase = disqualPhraseTerms.some(t => combinedFull.includes(t));
  const disqualGateFlag = hasDisqualPhrase && hasActiveObjection;

  // Secondary decision-maker — also check human_notes
  const secondaryDmTerms = ["esposa", "marido", "pareja", "socio", "socia", "familia", "wife", "husband", "partner", "spouse", "family", "validar con", "consultar con", "hablarlo con", "comentarlo con", "confirmar con", "hablar con ella", "hablar con él", "discuss with", "check with", "talk it over", "aprobación de", "autorización de", "decidimos juntos", "decidir juntos", "we decide together"];
  const hasSecondaryDecisionMaker = secondaryDmTerms.some(t => combinedFull.includes(t) || humanNotesLower.includes(t));

  // Speaker uncertainty severity
  const speakerRate = speaker_uncertainty?.rate ?? 0;
  const speakerUnknownTurns = speaker_uncertainty?.unknown_turns ?? 0;
  const speakerTotalTurns = speaker_uncertainty?.total_turns ?? 0;
  const speakerUncertaintySevere = speakerRate > 0.7;
  const speakerUncertaintyModerate = speakerRate > 0.3;
  const speakerPct = Math.round(speakerRate * 100);

  // ── Guardrail blocks (injected into system prompt as HARD rules) ─────────────

  const detectedEn = [
    hasDateTime    ? "• Specific date/time marker: CONFIRMED" : null,
    hasChannel     ? "• Concrete channel (call/meeting/email/link): CONFIRMED" : null,
    hasDeliverable ? "• Concrete deliverable (proposal/summary/info/contract): CONFIRMED" : null,
    hasDecisionCriterion ? "• Decision criterion: CONFIRMED" : null,
  ].filter(Boolean).join("\n  ");

  const detectedEs = [
    hasDateTime    ? "• Fecha/hora específica: CONFIRMADA" : null,
    hasChannel     ? "• Canal concreto (llamada/reunión/correo/enlace): CONFIRMADO" : null,
    hasDeliverable ? "• Entregable concreto (propuesta/resumen/info/contrato): CONFIRMADO" : null,
    hasDecisionCriterion ? "• Criterio de decisión: CONFIRMADO" : null,
  ].filter(Boolean).join("\n  ");

  const nextStepGuardrail = (nextStepQuality === "useful" || nextStepQuality === "strong")
    ? (isEn
        ? `\n\n━━ HARD GUARDRAILS — override any contrary inference ━━
SYSTEM CONFIRMED operative next step. Quality: ${nextStepQuality}. Commitments detected:
  ${detectedEn}
These are system-level facts. Your output MUST NOT contradict them.
PROHIBITED claims (any field):
  • "no date was set" / "no specific date" / "no timeframe agreed" — date/time WAS confirmed.
  • "no concrete next step" / "no next step was agreed" / "next step is missing"
  • "open conversation without commitment" / "no clear commitment" / "the conversation remained open"
  • Treating the absence of immediate reservation as a failed close when client is in comparative evaluation stage
Your suspected_soft_next_step MUST be "no". Non-negotiable system constraint.
You CAN note what is still missing for "strong" quality (e.g. explicit decision criterion not stated). But not at the cost of denying the confirmed operative commitments.`
        : `\n\n━━ GUARDRAILS DUROS — anulan cualquier inferencia contraria ━━
SISTEMA CONFIRMÓ siguiente paso operativo. Calidad: ${nextStepQuality}. Compromisos detectados:
  ${detectedEs}
Estos son hechos del sistema. Tu output NO puede contradecirlos.
AFIRMACIONES PROHIBIDAS (cualquier campo):
  • "no se fijó una fecha" / "sin fecha específica" / "sin franja horaria acordada" — fecha/hora SÍ confirmada.
  • "sin siguiente paso concreto" / "no se acordó siguiente paso" / "falta siguiente paso"
  • "conversación abierta sin compromiso" / "sin compromiso claro" / "la llamada quedó abierta"
  • Tratar la ausencia de reserva inmediata como fallo de cierre cuando el cliente está en fase de evaluación comparativa
Tu suspected_soft_next_step DEBE ser "no". Restricción del sistema, no negociable.
SÍ puedes señalar qué falta para alcanzar calidad "fuerte" (ej. criterio de decisión no explicitado). Pero no a costa de negar los compromisos operativos confirmados.`)
    : "";

  const noFailureGuardrail = likelyNoFailure && !isLost && !prematureCloseAttempt && !genericReframeFlag && !falseDichotomyFlag && !yieldTypeMismatchFlag && !disqualGateFlag
    ? (isEn
        ? `\n— SYSTEM ANALYSIS: no clear primary failure detected. Do NOT assign "seller" in failure_owner unless there is explicit evidence in memory — not inferred conversational patterns. If there was a real gap, name it specifically; do not use loss of conversational control as a catch-all blame.`
        : `\n— ANÁLISIS DEL SISTEMA: no se detectó fallo primario claro. NO asignes "vendedor" en failure_owner salvo evidencia explícita en memoria — no patrones de control inferidos. Si hubo un gap real, nómbralo específicamente; no uses pérdida de control conversacional como culpa genérica.`)
    : "";

  const prematureCloseGuardrail = prematureCloseAttempt
    ? (isEn
        ? `\n\n━━ SYSTEM FLAG: POSSIBLE PREMATURE CLOSE DETECTED ━━
The combined memory and transcript contain signals of (a) an active factual objection and (b) a concrete close/commitment attempt. This pattern is a grave tactical failure.
AUDIT REQUIREMENTS when this flag is active:
— Verify whether the stated objection was fully resolved BEFORE the close was proposed
— If the objection was still active when the close was attempted: log it as rules_violated ("cierre prematuro con objeción activa") and failure_owner ("vendedor")
— Do NOT suppress this failure or label it as "timing" or "system" unless there is explicit evidence the objection was resolved first
— The "no primary failure" suppression is disabled for this call — evaluate objection resolution independently`
        : `\n\n━━ FLAG DEL SISTEMA: POSIBLE CIERRE PREMATURO DETECTADO ━━
La memoria y transcripción combinadas contienen señales de (a) una objeción factual activa y (b) un intento de cierre o compromiso concreto. Este patrón es un fallo táctico grave.
REQUISITOS DE AUDITORÍA cuando este flag está activo:
— Verifica si la objeción declarada estaba completamente resuelta ANTES de proponer el cierre
— Si la objeción seguía activa cuando se intentó el cierre: regístralo en rules_violated ("cierre prematuro con objeción activa") y en failure_owner ("vendedor")
— NO suprimas este fallo ni lo etiquetes como "timing" o "sistema" salvo evidencia explícita de que la objeción se resolvió antes
— La supresión de "sin fallo primario" está desactivada para esta llamada — evalúa la resolución de la objeción de forma independiente`)
    : "";

  const genericReframeGuardrail = genericReframeFlag
    ? (isEn
        ? `\n\n━━ SYSTEM FLAG: GENERIC REFRAME ON CONCRETE OBJECTION ━━
Memory/transcript contains signals of a concrete rent/yield/price objection AND generic abstraction responses ("long-term wealth", "patrimony", "security") without addressing the specific figures cited.
AUDIT REQUIREMENTS:
— Verify whether the seller ever engaged the specific math, figure or percentage the client mentioned
— If the seller consistently deflected to abstraction without addressing the concrete number: log as rules_violated ("respuesta genérica a objeción concreta de renta") and failure_owner ("vendedor")
— This is a grave failure equivalent to unresolved objection — do NOT suppress or reduce to "suboptimal"`
        : `\n\n━━ FLAG DEL SISTEMA: REENCUADRE GENÉRICO A OBJECIÓN CONCRETA ━━
La memoria/transcripción contiene señales de una objeción concreta de renta/rentabilidad/precio Y respuestas de abstracción genérica ("patrimonio a largo plazo", "seguridad patrimonial") sin abordar las cifras específicas citadas.
REQUISITOS DE AUDITORÍA:
— Verifica si el vendedor alguna vez abordó la matemática, cifra o porcentaje concreto que mencionó el cliente
— Si el vendedor derivó consistentemente hacia la abstracción sin abordar el número concreto: regístralo en rules_violated ("respuesta genérica a objeción concreta de renta") y en failure_owner ("vendedor")
— Este es un fallo grave equivalente a objeción no resuelta — NO lo suprimas ni lo reduzcas a "subóptimo"`)
    : "";

  const falseDichotomyGuardrail = falseDichotomyFlag
    ? (isEn
        ? `\n\n━━ SYSTEM FLAG: POSSIBLE FALSE DICHOTOMY DETECTED ━━
Memory/transcript contains signals of a dichotomy frame ("security or return?", "long-term vs cashflow?") while the client had an active specific objection. This suggests the seller re-opened a settled frame instead of engaging the concrete blocker.
AUDIT REQUIREMENTS:
— Verify whether the client had already accepted one pole of the framing and then named a different specific objection
— If the seller responded by re-presenting the accepted frame as an open choice instead of addressing the new blocker: log as rules_violated ("falsa dicotomía con marco ya aceptado") and failure_owner ("vendedor")
— Do NOT suppress — re-framing accepted beliefs as open questions is a grave tactical error`
        : `\n\n━━ FLAG DEL SISTEMA: POSIBLE FALSA DICOTOMÍA DETECTADA ━━
La memoria/transcripción contiene señales de un marco dicotómico ("¿seguridad o rentabilidad?", "¿largo plazo o cashflow?") mientras el cliente tenía una objeción específica activa. Esto sugiere que el vendedor reabrió un marco ya resuelto en lugar de abordar el bloqueo concreto.
REQUISITOS DE AUDITORÍA:
— Verifica si el cliente ya había aceptado uno de los polos del encuadre y luego nombró una objeción específica diferente
— Si el vendedor respondió re-presentando el marco aceptado como una elección abierta en lugar de abordar el nuevo bloqueo: regístralo en rules_violated ("falsa dicotomía con marco ya aceptado") y en failure_owner ("vendedor")
— NO suprimas — re-encuadrar creencias aceptadas como preguntas abiertas es un error táctico grave`)
    : "";

  const yieldTypeMismatchGuardrail = yieldTypeMismatchFlag
    ? (isEn
        ? `\n\n━━ SYSTEM FLAG: YIELD TYPE MISMATCH DETECTED ━━
Memory/transcript shows the client raised a CONTRACT RENT or MARKET RENT objection (what the tenant pays / zone average) AND the session contains an equity/ROE reframe (yield on capital / 86% financing / leverage). This indicates the seller likely switched yield types without an explicit bridge.
AUDIT REQUIREMENTS:
— Verify whether the seller explicitly acknowledged the TYPE 1/2 objection (contract rent / market rent) BEFORE reframing to TYPE 5 (yield on equity / return on capital)
— Verify whether the seller said something equivalent to "I'm moving from [contract rent X%] to [yield on your invested capital Y%] — here's why they're different"
— If the seller silently switched from TYPE 1/2 to TYPE 5 without this bridge: log as rules_violated ("evasión por discordancia de tipo de rentabilidad") and failure_owner ("vendedor")
— A numerically correct TYPE 5 reframe WITHOUT the bridge = deflection, not a response`
        : `\n\n━━ FLAG DEL SISTEMA: DISCORDANCIA DE TIPO DE RENTABILIDAD DETECTADA ━━
La memoria/transcripción muestra que el cliente planteó una objeción de RENTA DEL CONTRATO o RENTA DE MERCADO (lo que paga el inquilino / media de zona) Y la sesión contiene un reencuadre de capital/ROE (retorno sobre capital / financiación al 86% / apalancamiento). Esto indica que el vendedor probablemente cambió de tipo de rentabilidad sin puente explícito.
REQUISITOS DE AUDITORÍA:
— Verifica si el vendedor reconoció explícitamente la objeción de TIPO 1/2 (renta de contrato / renta de mercado) ANTES de reencuadrar a TIPO 5 (retorno sobre capital / apalancamiento)
— Verifica si el vendedor dijo algo equivalente a "Paso de [la renta del contrato al X%] a [tu retorno real sobre capital aportado al Y%] — te explico la diferencia"
— Si el vendedor cambió silenciosamente de TIPO 1/2 a TIPO 5 sin este puente: regístralo en rules_violated ("evasión por discordancia de tipo de rentabilidad") y en failure_owner ("vendedor")
— Un reencuadre a TIPO 5 numéricamente correcto SIN el puente = evasión, no respuesta`)
    : "";

  const disqualGateGuardrail = disqualGateFlag
    ? (isEn
        ? `\n\n━━ SYSTEM FLAG: PREMATURE ASSET DISQUALIFICATION DETECTED ━━
Memory/transcript contains phrases suggesting the seller abandoned the current asset or opened an alternative search ("let's explore other options", "this may not be for you", "let's look at other properties") while an active objection was present.
AUDIT REQUIREMENTS:
— Verify whether, BEFORE any disqualification phrase, the seller: (1) addressed the specific objection concretely, (2) isolated the dominant criterion explicitly, (3) measured whether the gap was structural using context data
— If ANY of the three steps was missing when the seller disqualified: log as rules_violated ("descalificación prematura sin completar secuencia responder-aislar-medir") and failure_owner ("vendedor")
— If the client demanded to stop and the seller complied after a genuine attempt: this is NOT a failure — note the sequence was attempted
— Do NOT suppress — abandoning the asset before defending it is a grave tactical error`
        : `\n\n━━ FLAG DEL SISTEMA: DESCALIFICACIÓN PREMATURA DEL ACTIVO DETECTADA ━━
La memoria/transcripción contiene frases que sugieren que el vendedor abandonó el activo actual o abrió una búsqueda alternativa ("sigamos buscando", "puede que no sea lo tuyo", "veamos otros inmuebles") mientras había una objeción activa.
REQUISITOS DE AUDITORÍA:
— Verifica si ANTES de cualquier frase de descalificación, el vendedor: (1) respondió la objeción concreta directamente, (2) aisló el criterio dominante explícitamente, (3) midió si el gap era estructural usando datos del contexto
— Si FALTABA cualquiera de los tres pasos cuando el vendedor descalificó: regístralo en rules_violated ("descalificación prematura sin completar secuencia responder-aislar-medir") y en failure_owner ("vendedor")
— Si el cliente insistió en parar y el vendedor cedió tras un intento genuino: NO es un fallo — anota que se intentó la secuencia
— NO suprimas — abandonar el activo sin defenderlo primero es un error táctico grave`)
    : "";

  const alternativesBlock = isAlternativesDecision
    ? (isEn
        ? `\n\n━━ PATTERN DETECTED: DECISION BETWEEN ALTERNATIVES ━━
The client appears to already want to buy — the live decision is between two options, not whether to buy at all. In this stage: (a) the correct tactical goal is narrowing to one option and setting the validation step, NOT forcing an immediate reservation; (b) do NOT audit as a failed close unless the seller had an explicit cue for reservation/signature and did not take it; (c) "choosing together with spouse/partner/family" is a process step, not a stall — evaluate whether the seller reduced the decision and locked a concrete next contact.`
        : `\n\n━━ PATRÓN DETECTADO: DECISIÓN ENTRE ALTERNATIVAS ━━
El cliente parece ya querer comprar — la decisión real es entre dos opciones, no si comprar. En esta etapa: (a) el objetivo táctico correcto es reducir a una opción y fijar el paso de validación, NO forzar reserva inmediata; (b) NO audites como fallo de cierre salvo que el vendedor tuviera señal explícita de avance a reserva/firma y no la tomara; (c) "decidir con pareja/socio/familia" es un paso de proceso, no un bloqueo — evalúa si el vendedor redujo la decisión y aseguró un contacto siguiente concreto.`)
    : "";

  const secondaryDmBlock = hasSecondaryDecisionMaker
    ? (isEn
        ? `\n\n━━ PATTERN DETECTED: SECONDARY DECISION-MAKER ━━
A secondary validator (spouse/partner/family/associate) is involved. RULES: (a) absence of immediate reservation is NOT automatically a failure; (b) evaluate whether the seller achieved: (1) decision reduced to a clear option, (2) explicit validation deadline set, (3) next call confirmed; (c) if all three exist, this is a REAL ADVANCE — audit it as such. If the seller failed to secure any of these, that is the specific failure to name.`
        : `\n\n━━ PATRÓN DETECTADO: VALIDADOR SECUNDARIO ━━
Hay un validador secundario (pareja/socio/familia/asociado) implicado. REGLAS: (a) la ausencia de reserva inmediata NO es automáticamente un fallo; (b) evalúa si el vendedor logró: (1) decisión reducida a una opción clara, (2) plazo de validación explícito fijado, (3) siguiente llamada confirmada; (c) si las tres existen, esto es UN AVANCE REAL — audítalo como tal. Si el vendedor no aseguró alguna, ese es el fallo específico a nombrar.`)
    : "";

  const speakerGate = speakerUncertaintySevere
    ? (isEn
        ? `\n\n━━ SPEAKER UNCERTAINTY SEVERE (${speakerPct}% unknown, ${speakerUnknownTurns}/${speakerTotalTurns} turns) ━━
PROHIBITED phrases anywhere in output: "the seller lost control", "lack of seller control", "the seller didn't manage the conversation", "poor conversational control", or any equivalent. These require speaker-attributed evidence that does not exist here. You MUST note in the verdict that speaker attribution is unreliable and conclusions about control patterns should be treated with low confidence. You CAN name specific failures that appear explicitly in the memory content.`
        : `\n\n━━ INCERTIDUMBRE DE HABLANTE SEVERA (${speakerPct}% desconocido, ${speakerUnknownTurns}/${speakerTotalTurns} turnos) ━━
FRASES PROHIBIDAS en cualquier campo del output: "el vendedor perdió el control", "falta de control del vendedor", "el vendedor no gestionó bien la conversación", "control conversacional deficiente", o equivalentes. Estas requieren evidencia con atribución de hablante que no existe aquí. DEBES señalar en el veredicto que la atribución de hablante no es fiable y que las conclusiones sobre patrones de control deben tomarse con confianza baja. SÍ puedes nombrar fallos específicos que aparezcan explícitamente en el contenido de la memoria.`)
    : speakerUncertaintyModerate
      ? (isEn
          ? `\n\n━━ SPEAKER UNCERTAINTY MODERATE (${speakerPct}% unknown) ━━
Reduce causal certainty in control-related judgments. Qualify control observations as "possible" or "likely" rather than certain. Do not assign failure_owner = seller based solely on inferred conversational control.`
          : `\n\n━━ INCERTIDUMBRE DE HABLANTE MODERADA (${speakerPct}% desconocido) ━━
Reduce la certeza causal en juicios de control conversacional. Califica observaciones de control como "posible" o "probable", no como certeras. No asignes failure_owner = vendedor solo por control conversacional inferido.`)
      : "";

  // ── Post-process sanity check (no LLM call — pure text guardrail) ────────────
  function applySanityCheck(audit: Record<string, unknown>): void {
    // 1. Force suspected_soft_next_step = "no" when quality is useful/strong
    if ((nextStepQuality === "useful" || nextStepQuality === "strong") && audit.suspected_soft_next_step === "yes") {
      audit.suspected_soft_next_step = "no";
    }

    // 2. Strip forbidden "no next step" language from verdict/what_failed when next step was operative
    if (nextStepQuality === "useful" || nextStepQuality === "strong") {
      const forbiddenEs = [
        "sin siguiente paso concreto", "conversación abierta sin compromiso", "sin compromiso claro",
        "la conversación quedó abierta", "quedó abierta", "sin siguiente paso",
        "sin un siguiente paso", "no se estableció un siguiente paso", "no se acordó un siguiente paso",
        "no se aseguró un siguiente paso concreto",
        ...(hasDateTime ? ["no se fijó una fecha", "no hay una fecha", "sin fecha específica", "sin fecha concreta", "no se estableció una fecha", "no se acordó una fecha", "sin franja horaria"] : []),
        ...(hasChannel ? ["sin canal acordado", "sin canal concreto"] : []),
        ...(hasDeliverable ? ["sin entregable concreto", "sin deliverable"] : []),
      ];
      const forbiddenEn = [
        "no concrete next step", "open conversation without commitment", "no clear commitment",
        "the conversation remained open", "without a clear next step", "no next step was agreed",
        "no next step established", "no next step was confirmed",
        ...(hasDateTime ? ["no date was set", "no specific date", "no timeframe agreed", "no date agreed", "without a date", "no time was set"] : []),
        ...(hasChannel ? ["no channel agreed", "no concrete channel"] : []),
      ];
      const forbidden = isEn ? forbiddenEn : forbiddenEs;
      const replacement = isEn
        ? "operative next step confirmed (system-verified)"
        : "siguiente paso operativo confirmado (verificado por sistema)";
      const cleanText = (s: string) => forbidden.reduce((acc, f) => acc.replace(new RegExp(f, "gi"), replacement), s);

      if (typeof audit.verdict === "string") audit.verdict = cleanText(audit.verdict);
      if (Array.isArray(audit.what_failed)) {
        audit.what_failed = (audit.what_failed as string[]).map(s => typeof s === "string" ? cleanText(s) : s);
      }
    }

    // 2b. Remove what_failed entries that are entirely about missing date/step when those were confirmed
    if ((nextStepQuality === "useful" || nextStepQuality === "strong") && hasDateTime) {
      const dateDenialPatternsEs = /no se fij[oó] (una )?fecha|sin fecha (concreta|específica|de seguimiento)|no (hay|hubo) (una )?fecha/i;
      const dateDenialPatternsEn = /no date was (set|agreed|confirmed)|without a (specific |concrete )?date/i;
      const pattern = isEn ? dateDenialPatternsEn : dateDenialPatternsEs;
      if (Array.isArray(audit.what_failed)) {
        audit.what_failed = (audit.what_failed as string[]).filter(s =>
          typeof s !== "string" || !pattern.test(s)
        );
      }
    }

    // 2c. Strip "failure_owner = seller" entries that are solely about next-step absence when step was confirmed
    if ((nextStepQuality === "useful" || nextStepQuality === "strong") && Array.isArray(audit.failure_owner)) {
      const nextStepBlameEs = /vendedor\s*[|]\s*(no aseguró|no estableció|no fijó|no acordó).*siguiente paso/i;
      const nextStepBlameEn = /seller\s*[|]\s*(did not|didn't|failed to) (secure|establish|confirm|set).*next step/i;
      const pattern = isEn ? nextStepBlameEn : nextStepBlameEs;
      audit.failure_owner = (audit.failure_owner as string[]).map(s => {
        if (typeof s !== "string" || !pattern.test(s)) return s;
        return isEn
          ? `no real failure — next step was operative (${nextStepQuality} quality)`
          : `sin fallo real — siguiente paso fue operativo (calidad ${nextStepQuality})`;
      });
    }

    // 3. Strip forbidden control-blame language when speaker uncertainty is severe
    if (speakerUncertaintySevere) {
      const controlPhrasesEs = ["perdió el control", "falta de control del vendedor", "no gestionó bien", "control conversacional deficiente", "perdió el hilo"];
      const controlPhrasesEn = ["seller lost control", "lack of seller control", "didn't manage the conversation", "poor conversational control", "lost the thread"];
      const phrases = isEn ? controlPhrasesEn : controlPhrasesEs;
      const replacementCtrl = isEn
        ? "[speaker data insufficient to assess control]"
        : "[datos de hablante insuficientes para evaluar control]";
      const cleanControl = (s: string) => phrases.reduce((acc, f) => acc.replace(new RegExp(f, "gi"), replacementCtrl), s);

      if (typeof audit.verdict === "string") audit.verdict = cleanControl(audit.verdict);
      if (Array.isArray(audit.what_failed)) {
        audit.what_failed = (audit.what_failed as string[]).map(s => typeof s === "string" ? cleanControl(s) : s);
      }
      if (Array.isArray(audit.failure_owner)) {
        audit.failure_owner = (audit.failure_owner as string[]).filter(s => {
          if (typeof s !== "string") return true;
          return !phrases.some(p => s.toLowerCase().includes(p));
        });
        if ((audit.failure_owner as string[]).length === 0) {
          audit.failure_owner = [isEn ? "insufficient speaker data — control assessment not possible" : "datos de hablante insuficientes — evaluación de control no posible"];
        }
      }
      // Append uncertainty note to verdict if not already there
      const uncertaintyNote = isEn
        ? ` [NOTE: ${speakerPct}% of turns had unknown speaker attribution — control-related conclusions have low confidence.]`
        : ` [NOTA: ${speakerPct}% de turnos sin atribución de hablante — las conclusiones sobre control tienen baja confianza.]`;
      if (typeof audit.verdict === "string" && !audit.verdict.includes("speaker attribution")) {
        audit.verdict += uncertaintyNote;
      }
    }
  }

  const schema = `{"verdict":"string","what_worked":["string"],"what_failed":["string"],"failure_owner":["vendedor|timing|sistema|técnico|setup|sin fallo real — descripción"],"missed_closes":["string"],"rules_violated":["string"],"priority_changes":["string","string","string"],"prompt_patch":null,"prompt_for_replit":null,"what_i_would_have_done":"string","perfect_conversation":"string — describe the ideal version of this conversation: what the seller should have said at each key decision point, and how the call would have concluded","suspected_claim_risk":"yes|no","suspected_unresolved_technical_objection":"yes|no","suspected_false_confidence":"yes|no","suspected_soft_next_step":"yes|no"}`;

  const systemPrompt = isEn
    ? `You are a sales call auditor with very high standards. You receive the tactical memory of a real conversation and return a brutal, specific, actionable post-session audit. No filler, no empty praise.

EVIDENCE PRIORITY — read in this order, each source overrides the previous for conflicting details:
1. CLOSING TRANSCRIPT (last raw turns) — highest trust for specific dates, commitments, and agreements. If a date/time appears here, treat it as confirmed.
2. SELLER POST-CALL NOTES — high trust; the seller has direct knowledge of what happened.
3. CALL ANALYSIS SUMMARY — useful signal for score and global state.
4. TACTICAL CALL MEMORY — compressed; use when no more specific source contradicts it.

CORE RULES:
— If there is not enough evidence to assert something, say so explicitly. Do not fill gaps.
— Penalize: vagueness, accumulated generic questions without advancing, unresolved objections without evidence, soft or missing closes.
— STAGE ADVANCE vs FAILED CLOSE: if the call achieved stage clarity, criterion alignment, or a concrete next step with an operative commitment, audit it as a real advance — NOT a failed close — unless conditions for closing were genuinely met and wasted.
— Process steps (sending a proposal, scheduling a review, preparing documentation) are NOT close attempts. Only flag a missed close if there was explicit implicit permission to advance and the seller did not take it.
— Historical objections from context do not override the actual call axis. Audit what actually happened.
— NEXT STEP QUALITY: strong = date/time + deliverable + decision criterion; useful = any operative commitment (date OR channel OR deliverable); weak = none. Only "weak" is suspected_soft_next_step.
— failure_owner: classify each failure as: seller | timing | system | technical | setup | no real failure — then a brief description.
— missed_closes: concrete moments where there was explicit implicit permission to advance and the seller did not take it.
— rules_violated: tactical anti-patterns that appear clearly in the memory.
— priority_changes: 2-4 concrete, actionable changes for next call — not generic advice.
— what_i_would_have_done: a concrete alternative tactic or phrase for the key moment. Not vague.
— perfect_conversation: describe the ideal version of this exact call — what should have been said at each key decision point (objection handling, close attempt, next step), and how it would have concluded. Be concrete and specific. 3-6 sentences max.
— prompt_patch / prompt_for_replit: only if there is a clear system or setup issue. Otherwise null.
RISK FLAGS:
— suspected_claim_risk: "yes" if seller used assurance language without concrete evidence. "no" otherwise.
— suspected_unresolved_technical_objection: "yes" if a specific technical objection was deferred without evidence. "no" otherwise.
— suspected_false_confidence: "yes" if seller used official body as definitive proof of future value. "no" otherwise.
— suspected_soft_next_step: "yes" ONLY if no operative commitment (no date, no channel, no deliverable). "no" otherwise.
— If the buyer showed an analytical profile: evaluate if the seller responded with precision or generic persuasion.
WEAK EXIT SIGNAL — detect and name correctly:
If the client's last words were "send me something", "if I have time I'll look at it", "we'll see", "let me think about it", "I have to go" — without a concrete date, channel, or deliverable: this is NOT a "Next step agreed". It is a tactical failure (soft exit / weak handoff). suspected_soft_next_step MUST be "yes". verdict and what_failed MUST name this specifically — not just "follow-up pending".
RENT DEFENSE FAILURE — diagnose with precision:
If the client raised a concrete rent/price/yield objection (rent too low, old contract, price high vs rent, rent increase limits, extraordinary costs) AND the seller: (a) deflected to generic abstractions without addressing the specific figure, OR (b) never separated confirmed vs inferred vs unknown data, OR (c) never measured whether the gap was structural — name it precisely in what_failed: "seller failed to defend the rent math and specifics of the objection" / "yield analysis was evasive — no confirmed/inferred/unknown separation" / "contractual rent defensibility was not addressed before any reframe". Do NOT summarize this as "commitment was unclear" or "conversation lost momentum".${nextStepGuardrail}${noFailureGuardrail}${prematureCloseGuardrail}${genericReframeGuardrail}${falseDichotomyGuardrail}${yieldTypeMismatchGuardrail}${disqualGateGuardrail}${alternativesBlock}${secondaryDmBlock}${speakerGate}

Return EXACTLY this JSON, no markdown, no extra text:
${schema}`
    : `Eres un auditor de llamadas de venta con criterio muy alto. Recibes la memoria táctica de una conversación real y devuelves una auditoría post-sesión brutal, específica y accionable. Sin relleno, sin elogios vacíos.

PRIORIDAD DE EVIDENCIA — lee en este orden; cada fuente anula a la anterior si hay contradicción:
1. TRANSCRIPCIÓN DE CIERRE (últimas interacciones en bruto) — máxima confianza para fechas, compromisos y acuerdos específicos. Si aparece una fecha/hora aquí, trátala como confirmada.
2. NOTAS POST-LLAMADA DEL VENDEDOR — alta confianza; el vendedor tiene conocimiento directo de lo ocurrido.
3. RESUMEN DE ANÁLISIS — señal útil para puntuación y estado global.
4. MEMORIA TÁCTICA — comprimida; úsala cuando ninguna fuente más específica la contradiga.

REGLAS NÚCLEO:
— Si no hay evidencia suficiente para afirmar algo, dilo explícitamente. No rellenes huecos.
— Penaliza: vaguedad, preguntas genéricas acumuladas sin avanzar, objeciones sin resolver con evidencia, cierres blandos o ausentes.
— AVANCE DE ETAPA vs FALLO DE CIERRE: si la llamada consiguió claridad de etapa, encaje de criterio o siguiente paso con compromiso operativo, auditarlo como avance real — NO como fallo de cierre — salvo que las condiciones de cierre estuvieran dadas y no se aprovecharan.
— Los pasos de proceso comercial (enviar propuesta, agendar revisión, preparar documentación) NO son intentos de cierre. Solo señala cierre perdido si había permiso implícito real para avanzar.
— Las objeciones históricas del contexto no anulan el eje real de la llamada. Audita lo que realmente ocurrió.
— CALIDAD DEL SIGUIENTE PASO: fuerte = fecha/hora + entregable + criterio de decisión; útil = cualquier compromiso operativo (fecha O canal O entregable); débil = ninguno. Solo "débil" es suspected_soft_next_step.
— failure_owner: classifica cada fallo como: vendedor | timing | sistema | técnico | setup | sin fallo real — con descripción breve.
— missed_closes: momentos concretos donde existía permiso implícito real para avanzar y el vendedor no lo aprovechó.
— rules_violated: antipatrones tácticos que aparecen claramente en la memoria.
— priority_changes: 2-4 cambios concretos y accionables para la próxima llamada — no consejos genéricos.
— what_i_would_have_done: alternativa táctica concreta para el momento clave. No vaga.
— perfect_conversation: describe la versión ideal de esta llamada exacta — qué debería haberse dicho en cada punto de decisión clave (manejo de objeción, intento de cierre, siguiente paso), y cómo habría concluido. Sé concreto y específico. Máximo 3-6 frases.
— prompt_patch / prompt_for_replit: solo si hay un problema claro de sistema o setup. Si no, null.
FLAGS DE RIESGO:
— suspected_claim_risk: "yes" si el vendedor usó lenguaje de aseguramiento sin evidencia concreta. "no" en caso contrario.
— suspected_unresolved_technical_objection: "yes" si una objeción técnica específica fue diferida sin evidencia. "no" en caso contrario.
— suspected_false_confidence: "yes" si el vendedor usó organismo oficial como prueba definitiva de valor futuro. "no" en caso contrario.
— suspected_soft_next_step: "yes" SOLO si no hay compromiso operativo (sin fecha, canal ni entregable). "no" en caso contrario.
— Si el comprador mostró perfil analítico: evalúa si el vendedor respondió con precisión o persuasión genérica.
SEÑAL DE SALIDA DÉBIL — detecta y nombra con precisión:
Si las últimas palabras del cliente fueron "pásame algo", "si tengo tiempo lo miro", "lo vamos viendo", "lo pienso", "me tengo que ir", "mándame otra propuesta" — sin fecha, canal ni entregable concreto: esto NO es "Siguiente paso acordado". Es un fallo táctico (arrastre débil). suspected_soft_next_step DEBE ser "yes". verdict y what_failed DEBEN nombrarlo específicamente — no solo "seguimiento pendiente".
FALLO DE DEFENSA DE RENTA — diagnostica con precisión:
Si el cliente planteó una objeción concreta de renta/precio/rentabilidad (renta baja, contrato antiguo, precio alto respecto a renta, límites de subida, costes extraordinarios) Y el vendedor: (a) derivó a abstracciones genéricas sin abordar la cifra específica, O (b) nunca separó dato confirmado vs inferido vs pendiente, O (c) nunca midió si el gap era estructural — nómbralo con precisión en what_failed: "el vendedor no defendió la matemática de la renta ni la especificidad de la objeción" / "el análisis de rentabilidad fue evasivo — sin separación confirmado/inferido/pendiente" / "la defendibilidad de la renta contractual no se abordó antes de ningún reencuadre". NO lo resumas como "faltó compromiso claro" o "la conversación se diluyó".${nextStepGuardrail}${noFailureGuardrail}${prematureCloseGuardrail}${genericReframeGuardrail}${falseDichotomyGuardrail}${yieldTypeMismatchGuardrail}${disqualGateGuardrail}${alternativesBlock}${secondaryDmBlock}${speakerGate}

Devuelve EXACTAMENTE este JSON, sin markdown, sin texto extra:
${schema}`;

  // ── Build evidence pack for the prompt ────────────────────────────────────
  const evidenceParts: string[] = [];

  evidenceParts.push(
    `${isEn ? "TACTICAL CALL MEMORY (compressed)" : "MEMORIA TÁCTICA (comprimida)"}:\n${memoryText}`
  );

  if (imported_transcript?.trim()) {
    evidenceParts.push(
      `${isEn ? "VERIFIED TRANSCRIPT (manually provided by seller — highest authority, use as primary source for all evaluation)" : "TRANSCRIPCIÓN VERIFICADA (proporcionada manualmente por el vendedor — máxima autoridad, usa como fuente principal para toda la evaluación)"}:\n${imported_transcript.trim()}`
    );
  } else if (whisper_transcript?.trim()) {
    evidenceParts.push(
      `${isEn ? "CONVERSATION TRANSCRIPT (Whisper audio transcription — high quality, use as primary source for all evaluation)" : "TRANSCRIPCIÓN DE CONVERSACIÓN (transcripción de audio Whisper — alta calidad, usa como fuente principal para toda la evaluación)"}:\n${whisper_transcript.trim()}`
    );
  } else if (hasClosingExcerpt) {
    evidenceParts.push(
      `${isEn ? "CLOSING TRANSCRIPT — last raw turns (authoritative for commitments/dates)" : "TRANSCRIPCIÓN DE CIERRE — últimas interacciones en bruto (fuente principal para compromisos/fechas)"}:\n${closingLines}`
    );
  }

  if (session_summary) {
    const ss = session_summary;
    const summaryBlock = [
      ss.score != null ? `${isEn ? "Score" : "Puntuación"}: ${ss.score.toFixed(1)}/10` : null,
      ss.global_state ? `${isEn ? "State" : "Estado"}: ${ss.global_state}` : null,
      ss.result_label ? `${isEn ? "Result label" : "Etiqueta de resultado"}: ${ss.result_label}` : null,
      ss.strengths?.length ? `${isEn ? "Strengths" : "Fortalezas"}: ${ss.strengths.join("; ")}` : null,
      ss.improvements?.length ? `${isEn ? "Areas to improve" : "Áreas de mejora"}: ${ss.improvements.join("; ")}` : null,
    ].filter(Boolean).join("\n");
    if (summaryBlock) {
      evidenceParts.push(`${isEn ? "CALL ANALYSIS SUMMARY" : "RESUMEN DE ANÁLISIS DE LLAMADA"}:\n${summaryBlock}`);
    }
  }

  if (human_notes?.trim()) {
    evidenceParts.push(
      `${isEn ? "SELLER POST-CALL NOTES (high trust — seller knows what happened)" : "NOTAS POST-LLAMADA DEL VENDEDOR (alta confianza — el vendedor sabe lo que pasó)"}:\n${human_notes.trim()}`
    );
  }

  evidenceParts.push(
    `${isEn ? "REPORTED OUTCOME" : "RESULTADO DECLARADO"}: ${outcomeText}${contextText}`
  );

  const userMessage = evidenceParts.join("\n\n");

  const t0Audit = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1100,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    const latencyMs = Date.now() - t0Audit;
    if (completion.usage) {
      logAICall({
        route: "copilot/audit-report",
        endpoint: "brutal-audit",
        mode: "copilot",
        model: "gpt-4o-mini",
        maxTokensConfigured: 1100,
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    applySanityCheck(parsed);
    res.json(parsed);
  } catch {
    logAICall({
      route: "copilot/audit-report",
      endpoint: "brutal-audit",
      mode: "copilot",
      model: "gpt-4o-mini",
      maxTokensConfigured: 1100,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - t0Audit,
      status: "error",
    });
    res.status(500).json({ error: "Audit generation failed" });
  }
});

// ── POST /api/copilot/audit-report-vela ──────────────────────────────────────
// Self-audit: assesses VELA's own performance as a coaching system, not the seller.
router.post("/copilot/audit-report-vela", async (req, res) => {
  const {
    lang,
    session_metrics,
    auto_transcript,
    imported_transcript,
    whisper_transcript,
    vela_suggestions,
    call_memory,
    outcome,
  } = req.body as {
    lang?: string;
    session_metrics?: {
      analyze_error_count?: number;
      speaker_unknown_rate?: number;
      say_now_loop_count?: number;
      total_turns?: number;
      listen_reliability?: "high" | "medium" | "low";
    };
    auto_transcript?: string[];
    imported_transcript?: string;
    whisper_transcript?: string;
    vela_suggestions?: string[];
    call_memory?: string;
    outcome?: string;
  };

  const isEn = lang === "en";
  const metrics = session_metrics ?? {};
  const errorCount = metrics.analyze_error_count ?? 0;
  const unknownRate = metrics.speaker_unknown_rate ?? 0;
  const loopCount = metrics.say_now_loop_count ?? 0;
  const totalTurns = metrics.total_turns ?? 0;
  const reliability = metrics.listen_reliability ?? "high";

  // ── Programmatic metrics block ────────────────────────────────────────────
  const metricsLines: string[] = [];
  if (totalTurns > 0) metricsLines.push(isEn ? `Total turns analyzed: ${totalTurns}` : `Turnos totales analizados: ${totalTurns}`);
  if (errorCount > 0) metricsLines.push(isEn ? `Analysis failures: ${errorCount} (${((errorCount / Math.max(totalTurns, 1)) * 100).toFixed(0)}% of turns)` : `Fallos de análisis: ${errorCount} (${((errorCount / Math.max(totalTurns, 1)) * 100).toFixed(0)}% de los turnos)`);
  if (unknownRate > 0) metricsLines.push(isEn ? `Unknown speaker rate: ${(unknownRate * 100).toFixed(0)}%` : `Tasa de hablante desconocido: ${(unknownRate * 100).toFixed(0)}%`);
  if (loopCount > 0) metricsLines.push(isEn ? `Max consecutive say_now repetitions detected: ${loopCount}` : `Máx. repeticiones consecutivas de say_now detectadas: ${loopCount}`);
  metricsLines.push(isEn ? `Session listen reliability: ${reliability.toUpperCase()}` : `Fiabilidad de escucha de sesión: ${reliability.toUpperCase()}`);

  const evidenceParts: string[] = [];
  evidenceParts.push((isEn ? "SESSION METRICS:\n" : "MÉTRICAS DE SESIÓN:\n") + metricsLines.join("\n"));

  if (vela_suggestions && vela_suggestions.length > 0) {
    const unique = [...new Set(vela_suggestions)];
    const repeatedCounts = vela_suggestions.reduce<Record<string, number>>((acc, s) => { acc[s] = (acc[s] ?? 0) + 1; return acc; }, {});
    const repeated = Object.entries(repeatedCounts).filter(([, c]) => c > 1).map(([s, c]) => `"${s}" ×${c}`);
    const suggestionBlock = [
      isEn ? `Total suggestions: ${vela_suggestions.length} (${unique.length} unique)` : `Total sugerencias: ${vela_suggestions.length} (${unique.length} únicas)`,
      ...(repeated.length > 0 ? [isEn ? `Repeated suggestions: ${repeated.join(", ")}` : `Sugerencias repetidas: ${repeated.join(", ")}`] : []),
      isEn ? `Sample (last 10): ${vela_suggestions.slice(-10).map(s => `"${s}"`).join(" | ")}` : `Muestra (últimas 10): ${vela_suggestions.slice(-10).map(s => `"${s}"`).join(" | ")}`,
    ].join("\n");
    evidenceParts.push((isEn ? "VELA COACHING SUGGESTIONS:\n" : "SUGERENCIAS DE COACHING DE VELA:\n") + suggestionBlock);
  }

  if (call_memory?.trim()) {
    evidenceParts.push((isEn ? "FINAL CALL MEMORY (compressed):\n" : "MEMORIA FINAL DE LLAMADA (comprimida):\n") + call_memory.trim());
  }

  if (imported_transcript?.trim()) {
    evidenceParts.push((isEn ? "MANUALLY IMPORTED TRANSCRIPT (seller-verified — highest authority):\n" : "TRANSCRIPCIÓN IMPORTADA MANUALMENTE (verificada por vendedor — máxima autoridad):\n") + imported_transcript.trim());
  } else if (whisper_transcript?.trim()) {
    evidenceParts.push((isEn ? "WHISPER AUDIO TRANSCRIPT (high quality — use as primary source):\n" : "TRANSCRIPCIÓN DE AUDIO WHISPER (alta calidad — usa como fuente principal):\n") + whisper_transcript.trim());
  } else if (auto_transcript && auto_transcript.length > 0) {
    evidenceParts.push((isEn ? "AUTO-CAPTURED TRANSCRIPT (last 20 turns):\n" : "TRANSCRIPCIÓN AUTO-CAPTURADA (últimos 20 turnos):\n") + auto_transcript.slice(-20).join("\n"));
  }

  if (outcome) {
    evidenceParts.push((isEn ? "REPORTED OUTCOME: " : "RESULTADO DECLARADO: ") + outcome);
  }

  const velaSchema = `{"verdict":"string","reliability_level":"high|medium|low","reliability_explanation":"string","speaker_attribution_quality":"string","say_now_quality":"string","loops_detected":true|false,"loop_explanation":"string or null","audit_confidence":"high|medium|low","technical_failures":["string"],"system_recommendations":["string"]}`;

  const systemPrompt = isEn
    ? `You are VELA performing a self-audit of its own performance as a real-time sales coaching system. You are NOT auditing the seller. You are auditing whether VELA's coaching was timely, varied, precise, and technically reliable during this session.

WHAT TO ASSESS:
1. SUGGESTION QUALITY: Were the say_now suggestions varied and relevant? Did they adapt to different conversational moments, or were they repetitive and generic?
2. LOOP DETECTION: Were there repetitive suggestion patterns? If say_now repeated 3+ times consecutively, that is a coaching failure.
3. SPEAKER ATTRIBUTION: Was speaker data reliable enough for precision coaching? High unknown rate = systemic limitation.
4. TECHNICAL RELIABILITY: How many analyze failures occurred? What percentage of turns had no coaching?
5. OVERALL AUDIT CONFIDENCE: Given data quality, how confident can we be in this session's coaching quality?

SELF-AUDIT RULES:
— Be honest about systemic failures: loops, high error rates, poor speaker attribution are VELA failures, not seller failures.
— Do NOT deflect failures onto the seller or call difficulty.
— technical_failures: list specific measurable failures (e.g. "12% of turns had no coaching due to API errors", "say_now repeated 5 consecutive turns").
— system_recommendations: concrete changes that would improve VELA's coaching quality in a session like this.
— audit_confidence: "high" if error rate < 10% and reliability = high; "medium" if error rate 10-30% or reliability = medium; "low" if error rate > 30% or reliability = low.

Return EXACTLY this JSON, no markdown, no extra text:
${velaSchema}`
    : `Eres VELA realizando una auto-auditoría de su propio rendimiento como sistema de coaching de ventas en tiempo real. NO estás auditando al vendedor. Estás auditando si el coaching de VELA fue oportuno, variado, preciso y técnicamente fiable durante esta sesión.

QUÉ EVALUAR:
1. CALIDAD DE SUGERENCIAS: ¿Fueron las sugerencias say_now variadas y relevantes? ¿Se adaptaron a los distintos momentos de la conversación, o fueron repetitivas y genéricas?
2. DETECCIÓN DE LOOPS: ¿Hubo patrones de sugerencia repetitivos? Si say_now se repitió 3+ veces consecutivas, eso es un fallo de coaching.
3. ATRIBUCIÓN DE HABLANTE: ¿Fueron los datos de hablante suficientemente fiables para un coaching preciso? Alta tasa de desconocidos = limitación sistémica.
4. FIABILIDAD TÉCNICA: ¿Cuántos fallos de análisis ocurrieron? ¿Qué porcentaje de turnos no tuvo coaching?
5. CONFIANZA DE LA AUDITORÍA: Dada la calidad de los datos, ¿con qué confianza podemos evaluar la calidad del coaching de esta sesión?

REGLAS DE AUTO-AUDITORÍA:
— Sé honesto sobre los fallos sistémicos: loops, altas tasas de error y mala atribución de hablante son fallos de VELA, no del vendedor.
— NO deflectes los fallos hacia el vendedor o la dificultad de la llamada.
— technical_failures: lista fallos específicos y medibles (p.ej. "12% de los turnos sin coaching por errores de API", "say_now repetido 5 turnos consecutivos").
— system_recommendations: cambios concretos que mejorarían la calidad del coaching de VELA en una sesión de este tipo.
— audit_confidence: "high" si tasa de error < 10% y fiabilidad = high; "medium" si tasa 10-30% o fiabilidad = medium; "low" si tasa > 30% o fiabilidad = low.

Devuelve EXACTAMENTE este JSON, sin markdown, sin texto extra:
${velaSchema}`;

  const t0Vela = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 800,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: evidenceParts.join("\n\n") },
      ],
    });
    const latencyMs = Date.now() - t0Vela;
    if (completion.usage) {
      logAICall({
        route: "copilot/audit-report-vela",
        endpoint: "vela-audit",
        mode: "copilot",
        model: "gpt-4o-mini",
        maxTokensConfigured: 800,
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    res.json(parsed);
  } catch {
    logAICall({
      route: "copilot/audit-report-vela",
      endpoint: "vela-audit",
      mode: "copilot",
      model: "gpt-4o-mini",
      maxTokensConfigured: 800,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - t0Vela,
      status: "error",
    });
    res.status(500).json({ error: "VELA audit generation failed" });
  }
});

// ── POST /api/copilot/context-label ──────────────────────────────────────────
router.post("/copilot/context-label", async (req, res) => {
  const { context, lang } = req.body as { context?: string; lang?: string };
  if (!context?.trim()) { res.json({ label: "" }); return; }
  const isEn = lang === "en";
  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 25,
      messages: [
        {
          role: "system",
          content: isEn
            ? `Generate a 4-6 word scene title in English for a sales tool session bar. No quotes, no punctuation. Title only. Examples: "Sale to skeptical Dresden investor", "B2B negotiation with reluctant CMO".`
            : `Genera un título de escena de 4-6 palabras en español para una herramienta de ventas. Sin comillas, sin puntuación. Solo el título. Ejemplos: "Venta a inversor escéptico sobre Dresden", "Negociación B2B con CMO reticente".`,
        },
        { role: "user", content: context.trim() },
      ],
    });

    const latencyMs = Date.now() - t0;
    const usage = completion.choices[0]?.message;
    const rawUsage = completion.usage;
    if (rawUsage) {
      logAICall({
        route: "copilot/context-label",
        endpoint: "context-label",
        mode: "copilot",
        model: "gpt-4o-mini",
        maxTokensConfigured: 25,
        promptTokens: rawUsage.prompt_tokens,
        completionTokens: rawUsage.completion_tokens,
        totalTokens: rawUsage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }

    const label = usage?.content?.trim() ?? "";
    res.json({ label });
  } catch {
    res.json({ label: "" });
  }
});

// ── Fix C: AI semantic speaker retropass ─────────────────────────────────────
// Post-call endpoint that reclassifies UNKNOWN / low-confidence turns
// using gpt-4o-mini semantic analysis.  Called by the frontend after the
// heuristic retropass to cover cases that rule-based attribution cannot resolve.
router.post("/copilot/speaker-retropass", async (req, res) => {
  const {
    turns,
    setup_context,
    vendor_name,
    client_name,
    lang,
  } = req.body as {
    turns?: Array<{ index: number; text: string }>;
    setup_context?: string;
    vendor_name?: string | null;
    client_name?: string | null;
    lang?: string;
  };

  if (!turns || turns.length === 0) {
    res.json({ classifications: {} });
    return;
  }

  const isEn = lang !== "es";
  const sessionId = req.header("x-session-id");
  const vendorLabel = vendor_name || (isEn ? "unknown" : "desconocido");
  const clientLabel = client_name || (isEn ? "unknown" : "desconocido");
  const contextText = setup_context?.trim() || (isEn ? "No context provided." : "Sin contexto.");

  const turnsText = turns.map(t => `[${t.index}] ${t.text}`).join("\n");

  const systemPrompt = isEn
    ? `You are a sales transcript analyzer. Classify each conversation turn as VENDOR (the person selling), CLIENT (the person buying/prospect), or UNKNOWN (impossible to determine from content alone).

Session context: ${contextText}
Vendor name (if known): ${vendorLabel}
Client name (if known): ${clientLabel}

Return ONLY a JSON object mapping each turn index to its classification. No explanation. No markdown. Just the JSON.
Example: {"0":"VENDOR","1":"CLIENT","2":"UNKNOWN"}`
    : `Eres un experto en análisis de transcripts de llamadas comerciales en español.

Recibes fragmentos de audio transcritos automáticamente por reconocimiento de voz.
El audio fue capturado por un solo micrófono sin separación de canales, por lo que
los fragmentos pueden estar cortados a mitad de frase, contener eco del audio anterior,
o mezclar parcialmente dos voces en un mismo bloque.

Contexto de la sesión:
${contextText}

Vendedor: ${vendorLabel}
Cliente: ${clientLabel}

Tu tarea es analizar el conjunto completo de fragmentos como si fuera una sola
conversación continua e identificar quién habla en cada fragmento.

Basa tu clasificación únicamente en el contenido real de cada fragmento y en el
flujo lógico de la conversación. No inventes contenido, no elimines muletillas,
no corrijas el lenguaje. Sé fiel a lo que hay.

Si un fragmento es genuinamente ambiguo o imposible de atribuir con seguridad,
márcalo como UNKNOWN. No fuerces una atribución si no la puedes sostener.

Devuelve SOLO un objeto JSON con el índice de cada fragmento como clave y
VENDOR, CLIENT o UNKNOWN como valor.
Sin explicaciones. Sin markdown. Solo el JSON.`;

  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: turnsText },
      ],
    });

    const latencyMs = Date.now() - t0;
    const rawUsage = completion.usage;
    if (rawUsage) {
      logAICall({
        route: "copilot/speaker-retropass",
        endpoint: "speaker-retropass",
        sessionId,
        mode: "copilot",
        model: "gpt-4o-mini",
        maxTokensConfigured: 300,
        promptTokens: rawUsage.prompt_tokens,
        completionTokens: rawUsage.completion_tokens,
        totalTokens: rawUsage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed: Record<string, string> = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    res.json({ classifications: parsed });
  } catch {
    res.json({ classifications: {} });
  }
});

// POST /api/copilot/transcribe — transcribe audio with Whisper
router.post("/copilot/transcribe", async (req, res) => {
  req.log?.info("[vela:transcribe] endpoint hit");
  try {
    const busboy = (await import("busboy")).default;
    const bb = busboy({ headers: req.headers });
    const chunks: Buffer[] = [];
    let filename = "audio.webm";
    let contextPrompt = "";

    bb.on("field", (name, value) => {
      if (name === "context") contextPrompt = value;
    });

    bb.on("file", (_field, file, info) => {
      filename = info.filename || filename;
      file.on("data", (d) => chunks.push(d));
    });

    bb.on("finish", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const safeFilename = filename.match(/\.(webm|mp4|mp3|wav|ogg|flac|m4a|mpeg|mpga|oga)$/i)
          ? filename
          : filename + ".webm";
        const mimeType = safeFilename.endsWith(".ogg") ? "audio/ogg" : "audio/webm";
        const audioFile = new File([buffer], safeFilename, { type: mimeType });

        const t0Whisper = Date.now();
        const transcription = await openai.audio.transcriptions.create({
          file: audioFile,
          model: "whisper-1",
          language: "es",
          response_format: "verbose_json",
          prompt: contextPrompt || undefined,
        });
        const whisperLatencyMs = Date.now() - t0Whisper;

        const audioSeconds = (transcription as any).duration ?? buffer.length / 16000;
        logAICall({
          route: "copilot/transcribe",
          endpoint: "whisper",
          mode: "copilot",
          model: "whisper-1",
          maxTokensConfigured: 0,
          promptTokens: audioSeconds,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs: whisperLatencyMs,
          status: "ok",
        });

        const rawTranscript = transcription.text;
        res.json({
          transcript: rawTranscript,
          raw_transcript: rawTranscript,
          segments: (transcription as any).segments ?? [],
          cleaning: true,
        });
      } catch (finishErr: any) {
        console.error("[vela:transcribe] error:", finishErr);
        req.log?.error(finishErr, "[vela:transcribe] whisper/gpt error");
        const isFormatError = finishErr?.status === 400 || finishErr?.message?.includes("Invalid file format");
        res.status(isFormatError ? 422 : 500).json({
          error: isFormatError
            ? "Formato de audio no soportado. Usa webm, mp4, mp3, wav u ogg."
            : "Error al transcribir el audio.",
        });
      }
    });

    req.pipe(bb);
  } catch (err) {
    req.log?.error(err, "transcribe error");
    res.status(500).json({ error: "transcription failed" });
  }
});

// POST /api/copilot/transcribe-clean — GPT speaker attribution on a raw Whisper transcript
router.post("/copilot/transcribe-clean", async (req, res) => {
  const { raw_transcript, context } = req.body as { raw_transcript?: string; context?: string };
  if (!raw_transcript?.trim()) {
    res.status(400).json({ error: "raw_transcript is required" });
    return;
  }
  const t0Clean = Date.now();
  try {
    const cleanupPrompt = `Eres un experto en transcripciones de llamadas de venta. Tu tarea es identificar quién habla en cada turno y añadir etiquetas [VENDEDOR] o [CLIENTE].

${context?.trim() ? `CONTEXTO DE LA SESIÓN (úsalo para identificar nombres y roles):\n${context.trim()}\n\n` : ""}REGLAS DE ATRIBUCIÓN (en orden de prioridad):
1. Si el contexto identifica nombres (ej: "Alberto = vendedor, Pedro = cliente"), úsalos como señal principal.
2. El VENDEDOR es quien explica el producto, hace preguntas de discovery, maneja objeciones y propone avanzar.
3. El CLIENTE es quien expresa dudas, objeciones, preguntas sobre el producto o dice "tengo que pensarlo".
4. REGLA CRÍTICA: Que un turno empiece con un nombre NO significa que esa persona esté hablando. "Pedro, antes de entrar en números..." es el VENDEDOR dirigiéndose a Pedro, no Pedro hablando.
5. En llamadas de venta, el VENDEDOR suele hablar primero.
6. Si no puedes identificar con seguridad, usa [DESCONOCIDO].

TRANSCRIPT EN BRUTO:
${raw_transcript.trim()}

Devuelve SOLO el transcript con etiquetas, sin explicaciones ni texto adicional. Formato exacto:
[VENDEDOR]: texto
[CLIENTE]: texto`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4000,
      messages: [{ role: "user", content: cleanupPrompt }],
    });
    const cleanLatencyMs = Date.now() - t0Clean;
    if (completion.usage) {
      logAICall({
        route: "copilot/transcribe-clean",
        endpoint: "clean",
        mode: "copilot",
        model: "gpt-4o-mini",
        maxTokensConfigured: 4000,
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
        latencyMs: cleanLatencyMs,
        status: "ok",
      });
    }
    const transcript = completion.choices[0]?.message?.content ?? raw_transcript;
    res.json({ transcript });
  } catch (err: any) {
    console.error("[vela:transcribe-clean] error:", err);
    req.log?.error(err, "[vela:transcribe-clean] gpt error");
    logAICall({
      route: "copilot/transcribe-clean",
      endpoint: "clean",
      mode: "copilot",
      model: "gpt-4o-mini",
      maxTokensConfigured: 4000,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - t0Clean,
      status: "error",
    });
    res.status(500).json({ error: "clean transcription failed", transcript: raw_transcript });
  }
});

// ── PRE-BRIEF CONTEXT INTERPRETER ────────────────────────────────────────────
router.post("/copilot/prebrief-context", async (req, res) => {
  const { raw_input, has_asset, call_type_hint, user_risk_hint, brainId } = req.body as {
    raw_input: string;
    has_asset?: boolean;
    call_type_hint?: string;
    user_risk_hint?: string;
    brainId?: string;
  };

  if (!raw_input?.trim()) {
    res.status(400).json({ error: "raw_input required" });
    return;
  }

  const t0 = Date.now();
  const brain = getCopilotBrain(brainId);

  const systemPrompt = `Eres un intérprete táctico de contexto comercial. Tu trabajo: leer un input comercial con bisturí y extraer el contexto real del caso — no un resumen bonito, no una interpretación sesgada por tópicos del sector.

${brain.prebriefRules.es}

═══ JERARQUÍA DE LECTURA — obligatoria ═══
Lée el input en este orden de prioridad:
1. Evento explícito de la llamada — manda sobre cualquier label de CRM
2. Hechos estructurales del caso — situación fiscal, laboral, geográfica, familiar, permanencia, financiación
3. Restricciones reales de avance — qué impide concretamente pasar a la siguiente fase
4. Stage / labels del CRM — solo como contexto secundario
5. Objeciones típicas del sector — ÚNICAMENTE si no hay señales más específicas en el input

${buildPrebriefContextBrainBlock(brainId)}

═══ FORMATO — obligatorio ═══
- No inventes cifras, hechos ni decisiones del cliente
- Responde SOLO JSON válido, sin markdown ni texto extra
- Idioma: español. Tono: directo, táctico, compacto`;

  const userPrompt = `Lee este input comercial con bisturí. Extrae las señales estructurales del caso, no solo los tópicos del sector. Devuelve SOLO este JSON exacto:
{
  "detected_phase": "fase comercial real — usa el nombre del evento o fase del proceso (ej: 'Fase 2 — asesoría de inversión', 'Fase 4 — propuesta real'). NUNCA 'seguimiento' si hay evento más específico",
  "call_type": "tipo de llamada operativo — label más preciso del input (ej: 'asesoría de ganancia patrimonial', 'presentación de propuesta'). NUNCA 'seguimiento' si el input tiene evento explícito",
  "today_decision": "decisión comercial real — qué se evalúa o decide hoy de verdad. No resumen administrativo. No 'se revisará'. Qué se mueve hoy (1-2 frases)",
  "what_client_knows": ["solo lo que ya conoce del proceso/modelo/motivo de la llamada — máx 3 puntos. PROHIBIDO: datos financieros, ingresos, patrimonio personal"],
  "main_blocker_probable": "freno dominante real de ESTE caso en ESTA fase — un único bloqueo. Prioriza restricciones estructurales (encaje, financiación, permanencia) sobre objeciones típicas del sector (1-2 frases)",
  "valid_outcome_today": "avance concreto alcanzable hoy — agendar / confirmar encaje / validar restricción / reservar / aislar freno (1 frase)",
  "confidence": "high|medium|low",
  "context_for_brief": "resumen táctico 3-5 frases. Debe incluir explícitamente cualquier restricción o riesgo estructural del caso si existe. Directo, sin humo",
  "special_context_flags": ["señal estructural 1 que cambia la lectura táctica", "señal estructural 2"],
  "decision_constraints": ["restricción que condiciona lo que se puede decidir hoy 1", "restricción 2"],
  "case_specific_risks": ["riesgo de lectura o avance específico de este caso 1", "riesgo 2"]
}

Reglas para los 3 campos nuevos:
- special_context_flags: señales que cambian la lectura táctica del caso (transfronterizo, permanencia limitada, Schufa, estructura familiar, zona muy concreta). Máx 3. Si no hay señales estructurales claras, devuelve array vacío [].
- decision_constraints: qué no se puede/debe hacer hoy sin validar antes. Máx 3. Si no hay restricciones claras, devuelve [].
- case_specific_risks: riesgos de lectura incorrecta o avance prematuro específicos de este caso. Máx 3. Si no hay riesgos específicos claros, devuelve [].

INPUT:
${raw_input}${has_asset ? "\n[El cliente tiene propuesta/documentación]" : ""}${call_type_hint ? `\n[Pista tipo llamada: ${call_type_hint}]` : ""}${user_risk_hint ? `\n[Pista riesgo: ${user_risk_hint}]` : ""}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });

    const latencyMs = Date.now() - t0;
    logAICall({
      route: "copilot/prebrief-context",
      endpoint: "prebrief-context",
      mode: "copilot",
      model: "gpt-4o",
      maxTokensConfigured: 800,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      totalTokens: completion.usage?.total_tokens ?? 0,
      latencyMs,
      status: "ok",
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    }
    res.json(parsed);
  } catch (err: unknown) {
    req.log?.error(err, "[vela:prebrief-context] error");
    logAICall({
      route: "copilot/prebrief-context",
      endpoint: "prebrief-context",
      mode: "copilot",
      model: "gpt-4o",
      maxTokensConfigured: 800,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - t0,
      status: "error",
    });
    res.status(500).json({ error: "prebrief-context failed" });
  }
});

// ── PRE-BRIEF SCRIPT (FASE 2) ─────────────────────────────────────────────────
router.post("/copilot/prebrief-script", async (req, res) => {
  const { brainId, raw_input, interpreted_context } = req.body as {
    brainId?: string;
    raw_input?: string;
    interpreted_context: {
      detected_phase: string;
      call_type: string;
      today_decision: string;
      what_client_knows: string[];
      main_blocker_probable: string;
      valid_outcome_today: string;
      confidence: string;
      context_for_brief: string;
      special_context_flags?: string[];
      decision_constraints?: string[];
      case_specific_risks?: string[];
    };
  };

  if (!interpreted_context?.detected_phase) {
    res.status(400).json({ error: "interpreted_context required" });
    return;
  }

  const t0 = Date.now();
  const brain = getCopilotBrain(brainId);

  const systemPrompt = `Eres un preparador táctico de llamadas de ventas. Generas briefings de trabajo cortos, específicos al caso y útiles para el vendedor — no plantillas GPT.

${brain.prebriefScriptRules.es}
${buildPrebriefScriptBrainBlock(brainId)}

═══ GUARDRAILS DE CALIDAD — obligatorios ═══

ESPECIFICIDAD:
- Lee el input original y el contexto interpretado. Extrae señales concretas: detalles fiscales, laborales, geográficos, de perfil personal, de fase comercial real.
- El briefing debe sonar a "este caso" no a "un caso típico del sector".
- No uses objeciones genéricas si el caso tiene señales más específicas.
- No uses el bloqueo dominante por defecto del sector — prioriza el bloqueo real de este caso.

CADA CAMPO — reglas específicas:
- real_call_goal: objetivo comercialmente realista para esta fase y este caso. No abstracto. No "generar confianza". No "resolver dudas". Qué se mueve hoy.
- must_get_today: 3-5 puntos. Todos accionables y verificables al terminar la llamada. No comportamientos — resultados.
- expected_objections: máximo 3, específicas al caso. La objeción debe sonar a algo que diría ESTE cliente, no cualquier cliente del sector. El "why_likely" debe referenciar algo del caso concreto.
- mistakes_to_avoid: máximo 5, específicos al caso y la fase. No errores genéricos de ventas.
- suggested_call_structure: 4-6 pasos operativos y útiles. Ningún paso vago.
- suggested_opening: máximo 2 frases. Natural, usable por un vendedor real. Debe referenciar algo concreto del caso o del motivo de la llamada — no un saludo genérico.
- suggested_next_step_close: incluye el siguiente paso concreto y el criterio de avance. No "agendamos algo si te parece bien".
- brief_for_live: 4-7 frases. Compacto, afilado, listo para usar sin reescritura.

═══ ANTI-EJEMPLOS — lo que NO debes hacer ═══

Mal objetivo real:
✗ "Resolver las dudas de Antonio y avanzar hacia propuesta"
✗ "Generar confianza y confirmar encaje"

Mal objeción:
✗ "Desconocer Alemania" — si el caso tiene una fricción mucho más específica
✗ Objeción genérica del sector que no viene del input

Mala estructura:
✗ "Saludo y conexión / Revisar llamada anterior / Resolver objeciones / Cerrar"

Mala apertura:
✗ "Hola [nombre], ¿cómo te encuentras? Quería hablar sobre..."
✗ "Me gustaría profundizar en tu interés por la inversión..."
✗ Cualquier apertura que empezaría cualquier vendedor con cualquier cliente
✓ BUENA: "De la asesoría anterior me quedó una duda — dijiste que el cashflow te preocupaba, pero no llegamos a ver si tu situación real encaja con el modelo. ¿Puedo preguntarte algo antes de ir a propuesta?"
✓ BUENA: "Antes de hablar de activos, necesito entender algo: ¿cuál es el escenario que te haría decir que esto no es para ti? Eso me ayuda a darte lo que realmente necesitas hoy."

Mal cierre:
✗ "Si te parece bien, podemos agendar una próxima llamada"
✗ "Quedamos en hablar más adelante"
✗ "Si todo está claro, podemos avanzar a propuesta y fijar una fecha para revisarla juntos"
✓ BUENO: "Si al terminar esta llamada ves que el modelo cuadra con tu situación, agendamos la propuesta para [esta semana / próxima semana]. Si no, lo cerramos aquí — sin presión."
✓ BUENO: "Una última pregunta: ¿qué necesitarías ver hoy para decirme que quieres pasar a propuesta? Eso es lo que vamos a resolver."

REGLA ESPECIAL para suggested_opening:
La apertura DEBE referenciar algo concreto del input o del contexto del caso (una preocupación mencionada, el tipo de evento, la fase en la que están). Si no hay nada específico, usa una apertura que rompa el patrón de saludo-agenda-pregunta genérica. Máximo 2 frases. Sin "¿cómo te encuentras?" ni variantes.

═══ GUARDRAILS ADICIONALES — obligatorios ═══

CONSERVACIÓN DE FRENO COMPUESTO:
Antes de escribir cualquier campo, verifica: ¿el campo "Bloqueo principal probable" del contexto interpretado contiene dos elementos tácticos distintos?
Si sí → los campos real_call_goal, must_get_today, expected_objections, suggested_opening y brief_for_live DEBEN reflejar AMBOS. Prohibido colapsarlos.
Señales de freno compuesto en main_blocker_probable: conectores "+" / "y" / texto con dos sustantivos tácticos distintos (ej: "decisor ausente + salida futura", "renta baja + contrato antiguo").

NO SOBRERRECONSTRUIR WHAT_CLIENT_KNOWS:
El campo "Qué sabe el cliente" del contexto interpretado refleja conocimiento ya adquirido — no intenciones de entender.
Al generar el briefing, aplica la misma disciplina:
  · Si el contexto dice que el cliente quiere entender algo → no lo uses como base de que ya lo entiende
  · Si dice que revisará algo con alguien → no lo uses como confirmación de que ya lo revisó
  · Fórmula de comprobación: antes de usar what_client_knows como premisa del briefing, pregúntate "¿el input confirma que ya sabe esto, o solo que quiere saberlo?"

OBJECIONES DE ACTIVO — PRECISIÓN OBLIGATORIA:
Si el contexto interpretado o el input contienen: renta, alquiler, yield, rentabilidad, contrato antiguo, precio del activo, matemática del inmueble → en expected_objections.how_to_handle:
  · OBLIGATORIO separar: (1) datos del activo confirmados en contexto, (2) inferencias razonables, (3) datos pendientes de confirmar
  · PROHIBIDO responder con reencuadre patrimonial abstracto sin antes abordar la matemática concreta
  · PROHIBIDO citar "casos similares" o medias del mercado como respuesta si hay datos del activo en el contexto
  · Si hay contrato antiguo: how_to_handle debe abordar explícitamente la brecha renta actual vs renta potencial de mercado

ANTI-PLANTILLA — ESTRUCTURA Y CIERRE:
suggested_call_structure: ningún paso puede ser vago. Cada paso debe nombrar el freno real, el activo, la decisión o el decisor específico del caso.
  · PROHIBIDO: "resolver dudas", "conexión inicial", "revisar propuesta", "preguntas abiertas"
suggested_next_step_close: debe incluir criterio de avance explícito + siguiente paso con fecha o plazo real.
  · PROHIBIDO: "si encaja avanzamos", "vemos cómo seguir", "te digo algo", "si todo está claro"

═══ FORMATO — obligatorio ═══
- No inventes datos del cliente
- Responde SOLO JSON válido, sin markdown ni texto extra
- Idioma: español. Tono: directo, táctico, sin relleno`;

  const userPrompt = `Genera el briefing táctico de esta llamada a partir del contexto interpretado y el input original.

Tu trabajo: extraer las señales específicas de este caso y producir un briefing que suene a "este caso" — no a una plantilla.

CONTEXTO INTERPRETADO:
- Fase detectada: ${interpreted_context.detected_phase}
- Tipo de llamada: ${interpreted_context.call_type}
- Qué se decide hoy: ${interpreted_context.today_decision}
- Qué sabe el cliente: ${interpreted_context.what_client_knows.join(" / ")}
- Bloqueo principal probable: ${interpreted_context.main_blocker_probable}
- Outcome válido hoy: ${interpreted_context.valid_outcome_today}
- Contexto para brief: ${interpreted_context.context_for_brief}
${interpreted_context.special_context_flags?.length ? `\nFLAGS ESTRUCTURALES (prioridad máxima — deben guiar objeciones, objetivo y brief):\n${interpreted_context.special_context_flags.map(f => `  · ${f}`).join("\n")}` : ""}${interpreted_context.decision_constraints?.length ? `\nRESTRICCIONES DE DECISIÓN (condicionan lo que se puede hacer hoy):\n${interpreted_context.decision_constraints.map(c => `  · ${c}`).join("\n")}` : ""}${interpreted_context.case_specific_risks?.length ? `\nRIESGOS ESPECÍFICOS DEL CASO (errores a evitar en objeciones y estructura):\n${interpreted_context.case_specific_risks.map(r => `  · ${r}`).join("\n")}` : ""}
${raw_input ? `\nINPUT ORIGINAL (úsalo para extraer señales específicas del caso):\n${raw_input}` : ""}

Antes de generar, responde mentalmente:
1. ¿Cuál es el freno real más probable de ESTE cliente en ESTA fase? (no el tópico del sector)
2. ¿Qué haría que esta llamada sea un éxito real hoy?
3. ¿Qué diría un vendedor mediocre que debes evitar?
4. ¿El "Bloqueo principal probable" tiene dos elementos distintos? Si sí → ¿aparecen los dos en real_call_goal, expected_objections, suggested_opening y brief_for_live?
5. ¿El contexto o input tiene señales de "comprador real con intención alta" (FC, ingresos, entrada, largo plazo) + una restricción estructural? Si sí → ¿el real_call_goal suena a checkpoint estructural y NO a exploración blanda? ¿El must_get_today sigue el orden: criterio dominante → checkpoint → docs → fecha?

Devuelve SOLO este JSON exacto:
{
  "real_call_goal": "objetivo comercial concreto de esta llamada — qué se mueve hoy, no el ideal abstracto (1-2 frases)",
  "must_get_today": ["resultado accionable 1", "resultado accionable 2", "resultado accionable 3"],
  "expected_objections": [
    {
      "objection": "la fricción real probable de ESTE cliente",
      "why_likely": "por qué aparecerá en este caso concreto — referencia algo del input (1 frase)",
      "how_to_handle": "cómo manejarla tácticamente, breve y sin discurso (1-2 frases)"
    }
  ],
  "mistakes_to_avoid": ["error concreto 1 para este caso", "error concreto 2", "error concreto 3"],
  "suggested_call_structure": ["paso operativo 1", "paso operativo 2", "paso operativo 3", "paso operativo 4", "paso operativo 5"],
  "suggested_opening": "apertura de máximo 2 frases, natural, referencia algo concreto del caso, usable por vendedor real",
  "suggested_next_step_close": "frase con el siguiente paso concreto y el criterio de avance — no genérica",
  "brief_for_live": "4-7 frases compactas: fase real + objetivo concreto + freno dominante + qué conseguir hoy + siguiente paso. Afilado, sin relleno."
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const latencyMs = Date.now() - t0;
    logAICall({
      route: "copilot/prebrief-script",
      endpoint: "prebrief-script",
      mode: "copilot",
      model: "gpt-4o",
      maxTokensConfigured: 1000,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      totalTokens: completion.usage?.total_tokens ?? 0,
      latencyMs,
      status: "ok",
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    }
    res.json(parsed);
  } catch (err: unknown) {
    req.log?.error(err, "[vela:prebrief-script] error");
    logAICall({
      route: "copilot/prebrief-script",
      endpoint: "prebrief-script",
      mode: "copilot",
      model: "gpt-4o",
      maxTokensConfigured: 1000,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - t0,
      status: "error",
    });
    res.status(500).json({ error: "prebrief-script failed" });
  }
});

router.post("/copilot/save-session", async (req, res) => {
  try {
    const {
      brainId, sessionContext, outcome, score, durationSeconds,
      clientName, rawInput,
      callSummary, brutalAudit, whisperTranscript, webSpeechTurns,
      totalCostUsd, prebriefId,
      // canonical fields
      sourceSessionId, canonicalLogMd, sessionSnapshot,
      whisperRawTranscript, whisperCleanTranscript, webSpeechTranscript,
      velaAudit, costSnapshot, timelineSnapshot, savedExplicitly,
    } = req.body as Record<string, unknown>;

    let prebriefRawInput: string | null = rawInput as string ?? null;

    if (prebriefId) {
      try {
        const [prebrief] = await db
          .select({ rawInput: prebriefLogs.rawInput })
          .from(prebriefLogs)
          .where(eq(prebriefLogs.id, prebriefId as string))
          .limit(1);
        if (prebrief?.rawInput) prebriefRawInput = prebrief.rawInput;
      } catch {}
    }

    let resolvedClientName = clientName as string ?? null;
    if (!resolvedClientName && prebriefRawInput) {
      const raw = prebriefRawInput;
      const m1 = raw.match(/[Cc]liente\s*[=:]\s*([^\n,.]+)/);
      if (m1) resolvedClientName = m1[1].trim();
      if (!resolvedClientName) {
        const m2 = raw.match(/^([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})\s*[,.\n]/u);
        if (m2) resolvedClientName = m2[1].trim();
      }
      if (!resolvedClientName) {
        const m3 = raw.match(/(?:con|para)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/u);
        if (m3) resolvedClientName = m3[1].trim();
      }
    }

    // Resolve totalCostUsd + costSnapshot from AI tracker when sourceSessionId is available
    let resolvedTotalCostUsd: number | null = totalCostUsd as number ?? null;
    let resolvedCostSnapshot: unknown = costSnapshot ?? null;
    if (sourceSessionId && typeof sourceSessionId === "string") {
      const stats = getSessionStats(sourceSessionId);
      if (stats) {
        resolvedTotalCostUsd = Number(stats.totalCostUsd.toFixed(6));
        resolvedCostSnapshot = {
          totalCostUsd: resolvedTotalCostUsd,
          calls: stats.calls,
          totalTokens: stats.totalTokens,
          avgLatencyMs: Math.round(stats.avgLatencyMs),
          source: "ai_tracker",
        };
      }
    }

    const [session] = await db.insert(callSessions).values({
      brainId:               brainId as string ?? null,
      sessionContext:        sessionContext as string ?? null,
      outcome:               outcome as string ?? null,
      score:                 score as number ?? null,
      durationSeconds:       durationSeconds as number ?? null,
      clientName:            resolvedClientName,
      rawInput:              prebriefRawInput,
      callSummary:           callSummary ?? null,
      brutalAudit:           brutalAudit ?? null,
      whisperTranscript:     (whisperCleanTranscript as string) ?? (whisperTranscript as string) ?? null,
      webSpeechTurns:        webSpeechTurns ?? null,
      totalCostUsd:          resolvedTotalCostUsd,
      prebriefId:            prebriefId as string ?? null,
      endedAt:               new Date(),
      // canonical fields
      sourceSessionId:       sourceSessionId as string ?? null,
      savedAt:               new Date(),
      canonicalLogMd:        canonicalLogMd as string ?? null,
      sessionSnapshot:       sessionSnapshot ?? null,
      whisperRawTranscript:  whisperRawTranscript as string ?? null,
      whisperCleanTranscript: whisperCleanTranscript as string ?? null,
      webSpeechTranscript:   webSpeechTranscript as string ?? null,
      velaAudit:             velaAudit ?? null,
      costSnapshot:          resolvedCostSnapshot,
      timelineSnapshot:      timelineSnapshot ?? null,
      savedExplicitly:       (savedExplicitly as boolean) ?? false,
    }).returning();

    res.json({ id: session.id });
  } catch (err) {
    req.log?.error(err, "save-session error");
    res.status(500).json({ error: "save-session failed" });
  }
});

router.post("/copilot/save-prebrief", async (req, res) => {
  try {
    const { id, brainId, rawInput, interpretedContext, briefing } = req.body as Record<string, unknown>;

    if (id && typeof id === "string") {
      // Upsert: update existing prebrief row (no duplicates)
      await db.update(prebriefLogs)
        .set({
          ...(brainId !== undefined && { brainId: brainId as string }),
          ...(rawInput !== undefined && { rawInput: rawInput as string }),
          ...(interpretedContext !== undefined && { interpretedContext }),
          ...(briefing !== undefined && { briefing }),
        })
        .where(eq(prebriefLogs.id, id));
      res.json({ id });
    } else {
      // Create new prebrief
      const [log] = await db.insert(prebriefLogs).values({
        brainId:            brainId as string ?? null,
        rawInput:           rawInput as string ?? null,
        interpretedContext: interpretedContext ?? null,
        briefing:           briefing ?? null,
      }).returning();
      res.json({ id: log.id });
    }
  } catch (err) {
    req.log?.error(err, "save-prebrief error");
    res.status(500).json({ error: "save-prebrief failed" });
  }
});

router.get("/copilot/sessions", async (req, res) => {
  try {
    const sessions = await db
      .select({
        id: callSessions.id,
        createdAt: callSessions.createdAt,
        outcome: callSessions.outcome,
        score: callSessions.score,
        durationSeconds: callSessions.durationSeconds,
        brainId: callSessions.brainId,
        sessionContext: callSessions.sessionContext,
        clientName: callSessions.clientName,
        rawInput: callSessions.rawInput,
        prebriefId: callSessions.prebriefId,
        callSummary: callSessions.callSummary,
        brutalAudit: callSessions.brutalAudit,
        whisperTranscript: callSessions.whisperTranscript,
        totalCostUsd: callSessions.totalCostUsd,
        // canonical fields
        sourceSessionId: callSessions.sourceSessionId,
        savedAt: callSessions.savedAt,
        canonicalLogMd: callSessions.canonicalLogMd,
        sessionSnapshot: callSessions.sessionSnapshot,
        whisperRawTranscript: callSessions.whisperRawTranscript,
        whisperCleanTranscript: callSessions.whisperCleanTranscript,
        webSpeechTranscript: callSessions.webSpeechTranscript,
        velaAudit: callSessions.velaAudit,
        costSnapshot: callSessions.costSnapshot,
        timelineSnapshot: callSessions.timelineSnapshot,
        savedExplicitly: callSessions.savedExplicitly,
      })
      .from(callSessions)
      .orderBy(desc(callSessions.createdAt))
      .limit(100);

    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: "fetch-sessions failed" });
  }
});

router.patch("/copilot/sessions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      brutalAudit, whisperTranscript, callSummary,
      velaAudit, canonicalLogMd, sessionSnapshot,
      whisperRawTranscript, whisperCleanTranscript, webSpeechTranscript,
      costSnapshot, timelineSnapshot,
    } = req.body as Record<string, unknown>;

    await db.update(callSessions)
      .set({
        ...(brutalAudit !== undefined       && { brutalAudit }),
        ...(callSummary !== undefined       && { callSummary }),
        ...(whisperTranscript !== undefined && { whisperTranscript: whisperTranscript as string }),
        ...(velaAudit !== undefined         && { velaAudit }),
        ...(canonicalLogMd !== undefined    && { canonicalLogMd: canonicalLogMd as string }),
        ...(sessionSnapshot !== undefined   && { sessionSnapshot }),
        ...(whisperRawTranscript !== undefined   && { whisperRawTranscript: whisperRawTranscript as string }),
        ...(whisperCleanTranscript !== undefined  && { whisperCleanTranscript: whisperCleanTranscript as string }),
        ...(webSpeechTranscript !== undefined    && { webSpeechTranscript: webSpeechTranscript as string }),
        ...(costSnapshot !== undefined      && { costSnapshot }),
        ...(timelineSnapshot !== undefined  && { timelineSnapshot }),
      })
      .where(eq(callSessions.id, id));

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "patch-session failed" });
  }
});

router.delete("/copilot/sessions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(callSessions).where(eq(callSessions.id, id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "delete failed" });
  }
});

export default router;
