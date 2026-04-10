import { Router, type IRouter } from "express";
import {
  AnalyzeConversationBody,
  AnalyzeConversationResponse,
  CallSummarizeBody,
  CallSummarizeResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logAICall } from "../lib/ai-tracker";
import {
  OBJECTION_TAXONOMY_BLOCK,
  CLOSING_CRITERIA_BLOCK,
  SALES_ANTIPATTERNS_BLOCK,
  COMPARISON_RULE_BLOCK,
} from "@workspace/sales-brain";

const router: IRouter = Router();

// ── Feature flags ─────────────────────────────────────────────────────────────
// Set LEGACY_PROMPTS=true in env to fall back to original uncompressed prompts.
const USE_OPTIMIZED_PROMPTS = process.env["LEGACY_PROMPTS"] !== "true";

// ── OPTIMIZED BASE SYSTEM PROMPT (~700 tokens vs ~2100 original) ──────────────
// All tactical rules preserved. Removed: decorators, verbose examples, redundant prose.
const BASE_SYSTEM_PROMPT_V2 = `Eres copiloto táctico silencioso para conversaciones de venta en tiempo real. Recibes fragmentos entre Persona A (vendedor/usuario) y Persona B (cliente) y devuelves señal táctica exacta.

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

${COMPARISON_RULE_BLOCK.es}

DETECCIÓN DE RIESGO — evalúa antes de generar say_now:
CLAIM_RISK: el vendedor usa "garantía", "certific", "te aseguro", "sin duda", "100% seguro", "completamente seguro" o similar como argumento principal de valor o seguridad futura → say_now pide separación explícita: qué está confirmado, qué es inferido, qué está pendiente de prueba. avoid señala el riesgo concreto. No refuerces la afirmación.
FALSE_CONFIDENCE: el vendedor usa certificación, auditoría, organismo regulador u oficial como prueba definitiva de seguridad o rentabilidad futura → say_now redirige a datos concretos verificables. avoid nombra el riesgo.
UNRESOLVED_TECHNICAL_OBJ: el cliente pregunta por cifras, rentabilidad, retorno, tasa, datos o metodología específica, y el vendedor responde con reencuadre genérico sin datos → say_now pivota a precisión: recomienda aportar el dato concreto o reconocer explícitamente lo que no se puede confirmar todavía. No validar la respuesta genérica.
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

${CLOSING_CRITERIA_BLOCK.es}

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

function buildSystemPrompt(context?: string, lang?: string, structuredCtx?: StructuredCtx): string {
  const contextBlock = context?.trim()
    ? `\nCONTEXTO DE SESIÓN:\n${context.trim()}\nUsa datos concretos de este contexto en detail.support cuando sea tácticamente oportuno.`
    : "";

  const structuredBlock = buildStructuredContextBlock(structuredCtx, lang);

  const langRule = lang === "en"
    ? `\nLANGUAGE: The call is in English. ALL JSON field values MUST be in English.`
    : `\nIDIOMA: La llamada es en español. TODOS los valores JSON en español.`;

  return `${BASE_SYSTEM_PROMPT}${contextBlock}${structuredBlock}${langRule}`;
}

// ── POST /api/copilot/analyze ─────────────────────────────────────────────────
router.post("/copilot/analyze", async (req, res) => {
  const parseResult = AnalyzeConversationBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { text, context, call_memory, lang, structured_context } = parseResult.data;
  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? undefined;

  const userMessage = [
    call_memory ? `MEMORIA ACUMULADA:\n${call_memory}` : null,
    `FRAGMENTO:\n${text}`,
    "JSON táctico:",
  ].filter(Boolean).join("\n\n");

  const t0 = Date.now();
  let status: "ok" | "error" | "partial" = "ok";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 900,
      messages: [
        { role: "system", content: buildSystemPrompt(context, lang, structured_context) },
        { role: "user", content: userMessage },
      ],
    });

    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "copilot/analyze",
        endpoint: "analyze",
        sessionId,
        mode: "copilot",
        model: "gpt-4o-mini",
        maxTokensConfigured: 900,
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
      req.log.warn({ rawContent }, "Failed to parse AI response as JSON");
      parsed = {
        signal: "falta claridad",
        say_now: "haz una pregunta aclaratoria",
        avoid: null,
        detail: { reading: "", next_move: "", support: "" },
        journey: { past: "—", now: "sin contexto", next: "concretar" },
        call_memory: { summary_lines: ["Inicio de sesión", "Sin contexto claro todavía"] },
        momentum: "amber",
      };
    }

    const validated = AnalyzeConversationResponse.parse(parsed);
    res.json(validated);
  } catch (err) {
    const latencyMs = Date.now() - t0;
    logAICall({
      route: "copilot/analyze",
      endpoint: "analyze",
      sessionId,
      mode: "copilot",
      model: "gpt-4o-mini",
      maxTokensConfigured: 900,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs,
      status: "error",
    });
    req.log.error({ err }, "Error calling OpenAI");
    res.status(500).json({ error: "Error analyzing conversation" });
  }
});

// ── POST /api/copilot/summarize ───────────────────────────────────────────────
router.post("/copilot/summarize", async (req, res) => {
  const parseResult = CallSummarizeBody.safeParse(req.body);
  if (!parseResult.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const { call_memory, outcome, lang, full_report, speaker_uncertainty } = parseResult.data;
  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? undefined;
  const isEn = lang === "en";

  const memoryText = call_memory?.length
    ? call_memory.map(l => `- ${l}`).join("\n")
    : (isEn ? "(No call data available)" : "(Sin datos de llamada disponibles)");

  const outcomeText = outcome ?? (isEn ? "unclear" : "no claro");
  const wantsFullReport = !!full_report;

  const speakerUncertaintyBlock = speaker_uncertainty?.high
    ? (isEn
        ? `\nSPEAKER UNCERTAINTY HIGH: ${speaker_uncertainty.unknown_turns ?? "?"} of ${speaker_uncertainty.total_turns ?? "?"} turns (${Math.round((speaker_uncertainty.rate ?? 0) * 100)}%) were UNKNOWN in auto mode. Tactical reads may be contaminated. DO NOT make strong causal conclusions about conversational control or seller behavior unless supported by explicit memory evidence. Flag any control-related weakness with lower confidence.`
        : `\nALTA INCERTIDUMBRE DE HABLANTE: ${speaker_uncertainty.unknown_turns ?? "?"} de ${speaker_uncertainty.total_turns ?? "?"} turnos (${Math.round((speaker_uncertainty.rate ?? 0) * 100)}%) fueron UNKNOWN en modo automático. Las lecturas tácticas pueden estar contaminadas. NO saques conclusiones causales fuertes sobre control conversacional o comportamiento del vendedor salvo que haya evidencia explícita en la memoria. Señala cualquier debilidad de control con confianza reducida.`)
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
{"score":7.4,"global_state":"strong","result_label":"Next step agreed","strengths":["s1","s2"],"improvements":["i1","i2"],"full_report":${wantsFullReport ? '"report text"' : "null"}}

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

GLOBAL STATE: 1-2 words (strong/solid/advancing/workable/weak/blocked/lost/open)
STRENGTHS: 2-3 specific tactical observations. No generic praise.
IMPROVEMENTS: 2-3 specific, honest tactical observations.

${fullReportInstructions}`
    : `Eres analista experto de llamadas de venta. Evalúa la llamada basándote en la memoria táctica y el resultado declarado.

Devuelve EXACTAMENTE este JSON, sin markdown, sin texto extra:
{"score":7.4,"global_state":"fuerte","result_label":"Siguiente paso acordado","strengths":["f1","f2"],"improvements":["m1","m2"],"full_report":${wantsFullReport ? '"texto del reporte"' : "null"}}

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

ESTADO GLOBAL: 1-2 palabras (fuerte/sólida/avanzando/trabajable/floja/bloqueada/perdida/abierta)
PUNTOS FUERTES: 2-3 observaciones tácticas específicas. Sin elogios genéricos.
PUNTOS A MEJORAR: 2-3 observaciones tácticas específicas y honestas.

${fullReportInstructions}`;

  const userMessage = `${isEn ? "TACTICAL CALL MEMORY" : "MEMORIA TÁCTICA"}:\n${memoryText}\n\n${isEn ? "REPORTED OUTCOME" : "RESULTADO DECLARADO"}: ${outcomeText}${speakerUncertaintyBlock}\n\n${isEn ? "Analyze and return JSON:" : "Analiza y devuelve el JSON:"}`;

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
        score: 5,
        global_state: isEn ? "workable" : "trabajable",
        result_label: outcomeText,
        strengths: [],
        improvements: [],
        full_report: null,
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
// Input: { call_memory, outcome, context?, lang }
// Output: BrutalAudit JSON
router.post("/copilot/audit-report", async (req, res) => {
  const { call_memory, outcome, context, lang = "es", speaker_uncertainty } = req.body as {
    call_memory?: string[];
    outcome?: string;
    context?: string;
    lang?: string;
    speaker_uncertainty?: { high: boolean; rate?: number; unknown_turns?: number; total_turns?: number };
  };

  const isEn = lang === "en";
  const memoryText = (call_memory ?? []).map(l => `- ${l}`).join("\n") || (isEn ? "(No memory)" : "(Sin memoria)");
  const outcomeText = outcome ?? (isEn ? "unknown" : "desconocido");
  const contextText = context?.trim() ? `\n${isEn ? "SESSION CONTEXT" : "CONTEXTO"}: ${context.trim()}` : "";

  const auditSpeakerUncertaintyBlock = speaker_uncertainty?.high
    ? (isEn
        ? `\nSPEAKER UNCERTAINTY HIGH: ${speaker_uncertainty.unknown_turns ?? "?"} of ${speaker_uncertainty.total_turns ?? "?"} turns (${Math.round((speaker_uncertainty.rate ?? 0) * 100)}%) were UNKNOWN in auto mode. DO NOT make causal conclusions about who controlled the conversation or about seller-specific tactical patterns unless supported by explicit evidence. The failure_owner field must NOT attribute a failure to "seller" solely based on inferred conversational control if speaker attribution is uncertain. Flag affected findings with lower confidence.`
        : `\nALTA INCERTIDUMBRE DE HABLANTE: ${speaker_uncertainty.unknown_turns ?? "?"} de ${speaker_uncertainty.total_turns ?? "?"} turnos (${Math.round((speaker_uncertainty.rate ?? 0) * 100)}%) fueron UNKNOWN en modo automático. NO hagas conclusiones causales sobre quién controló la conversación ni sobre patrones tácticos específicos del vendedor salvo que haya evidencia explícita. El campo failure_owner NO debe atribuir un fallo al "vendedor" solo por control conversacional inferido si la atribución de hablante es incierta. Señala los hallazgos afectados con confianza reducida.`)
    : "";

  const schema = `{"verdict":"string","what_worked":["string"],"what_failed":["string"],"failure_owner":["vendedor|timing|sistema|técnico|setup|sin fallo real — descripción"],"missed_closes":["string"],"rules_violated":["string"],"priority_changes":["string","string","string"],"prompt_patch":null,"prompt_for_replit":null,"what_i_would_have_done":"string","suspected_claim_risk":"yes|no","suspected_unresolved_technical_objection":"yes|no","suspected_false_confidence":"yes|no","suspected_soft_next_step":"yes|no"}`;

  const systemPrompt = isEn
    ? `You are a sales call auditor with very high standards. You receive the tactical memory of a real conversation and return a brutal, specific, actionable post-session audit. No filler, no empty praise.

CRITICAL RULES:
— If there is not enough evidence to assert something, say so explicitly. Do not fill gaps.
— Penalize: vagueness, accumulated generic questions without advancing, unresolved objections without evidence, soft or missing closes, loss of conversational control.
— If there was a next step but no real close, do not present it as a strong session.
— STAGE ADVANCE vs FAILED CLOSE: if the call achieved stage clarity, criterion alignment, or a concrete next step with a deliverable, audit it as a real advance — NOT a failed close — unless conditions for closing were genuinely met and wasted.
— Process steps (sending a proposal, scheduling a review, preparing documentation) are NOT close attempts. Only flag a missed close if there was real implicit permission to advance and the seller did not take it.
— Historical objections from context do not override the actual call axis. Audit what actually happened in the transcript.
— NEXT STEP QUALITY: strong = date + deliverable + decision criterion; useful = date + deliverable; weak = date only. Reflect this in verdict and missed_closes.
— failure_owner: classify each failure as one of: seller | timing | system | technical | setup | no real failure — then a brief description.
— missed_closes: concrete moments where there was implicit permission to advance and the seller did not take it.
— rules_violated: tactical anti-patterns that appear clearly in the transcript (e.g. "repeated the same question twice", "proposed a meeting before resolving main objection").
— priority_changes: 2-4 concrete, actionable changes for next call — not generic advice.
— what_i_would_have_done: a concrete alternative tactic or phrase for the key moment of the call. Not vague.
— prompt_patch: only if you detect a clear coaching system error (bad advice from the AI model). Otherwise null.
— prompt_for_replit: only if there's a clear tool setup issue to fix. Otherwise null.
RISK FLAGS — evaluate carefully and set each:
— suspected_claim_risk: "yes" if the seller used "guarantee", "certified", "I assure you", "100% safe", "no risk" or similar as a main argument without concrete evidence. "no" otherwise.
— suspected_unresolved_technical_objection: "yes" if the client raised a specific technical objection (numbers, ROI, methodology, data) and it was deferred to documents or answered with generic reframing instead of concrete evidence. "no" otherwise.
— suspected_false_confidence: "yes" if the seller used an official certification, regulatory body, or audit as definitive proof of future value or security. "no" otherwise.
— suspected_soft_next_step: "yes" ONLY if the session ended in a next step with NO operative commitment — no specific date or timeframe, no concrete channel (video call, email, meeting link), no concrete deliverable (proposal, contract, summary, documentation). A next step that has any of these is "useful" or "strong", not soft. "no" otherwise.
— NEXT STEP QUALITY CONTEXT: strong = date/time + deliverable + decision criterion; useful = any operative commitment (date OR channel OR deliverable); weak = none of those. Only "weak" qualifies as suspected_soft_next_step.
— If the buyer showed an analytical profile (asked for data, numbers, methodology): evaluate whether the seller responded with precision (confirmed/inferred/pending-proof) or with generic persuasion. Generic persuasion to an analytical buyer is a serious failure — name it.

Return EXACTLY this JSON, no markdown, no extra text:
${schema}`
    : `Eres un auditor de llamadas de venta con criterio muy alto. Recibes la memoria táctica de una conversación real y devuelves una auditoría post-sesión brutal, específica y accionable. Sin relleno, sin elogios vacíos.

REGLAS CRÍTICAS:
— Si no hay evidencia suficiente para afirmar algo, dilo explícitamente. No rellenes huecos.
— Penaliza: vaguedad, preguntas genéricas acumuladas sin avanzar, objeciones sin resolver con evidencia, cierres blandos o ausentes, pérdida de control conversacional.
— Si hubo siguiente paso pero no cierre real, no lo presentes como sesión fuerte.
— AVANCE DE ETAPA vs FALLO DE CIERRE: si la llamada consiguió claridad de etapa, encaje de criterio o siguiente paso con entregable concreto, auditarlo como avance real — NO como fallo de cierre — salvo que las condiciones de cierre estuvieran dadas y no se aprovecharan.
— Los pasos de proceso comercial (enviar propuesta, agendar revisión, preparar documentación) NO son intentos de cierre. Solo señala cierre perdido si había permiso implícito real para avanzar y el vendedor no lo tomó.
— Las objeciones históricas del contexto no anulan el eje real de la llamada. Audita lo que realmente ocurrió en el transcript.
— CALIDAD DEL SIGUIENTE PASO: fuerte = fecha + entregable + criterio de decisión; útil = fecha + entregable; débil = solo fecha. Refléjalo en verdict y missed_closes.
— failure_owner: classifica cada fallo como: vendedor | timing | sistema | técnico | setup | sin fallo real — con descripción breve.
— missed_closes: momentos concretos donde existía permiso implícito para avanzar y el vendedor no lo aprovechó.
— rules_violated: antipatrones tácticos que aparecen claramente en la memoria (ej: "repitió la misma pregunta dos veces", "propuso reunión antes de resolver objeción principal").
— priority_changes: 2-4 cambios concretos y accionables para la próxima llamada — no consejos genéricos.
— what_i_would_have_done: alternativa táctica concreta para el momento clave de la llamada. No vaga.
— prompt_patch: solo si detectas un error claro del sistema de coaching (consejo malo del modelo). Si no, null.
— prompt_for_replit: solo si hay un problema claro de setup de la herramienta a corregir. Si no, null.
FLAGS DE RIESGO — evalúa con criterio y devuelve cada uno:
— suspected_claim_risk: "yes" si el vendedor usó "garantía", "certific", "te aseguro", "100% seguro", "sin riesgo" o similar como argumento principal sin evidencia concreta. "no" en caso contrario.
— suspected_unresolved_technical_objection: "yes" si el cliente planteó una objeción técnica específica (números, ROI, metodología, datos) y fue derivada a documentación o respondida con reencuadre genérico en lugar de evidencia concreta. "no" en caso contrario.
— suspected_false_confidence: "yes" si el vendedor usó una certificación oficial, organismo regulador o auditoría como prueba definitiva de valor o seguridad futura. "no" en caso contrario.
— suspected_soft_next_step: "yes" SOLO si la sesión terminó en siguiente paso SIN compromiso operativo — sin fecha ni franja horaria concreta, sin canal concreto (videollamada, email, enlace de reunión), sin entregable concreto (propuesta, contrato, resumen, documentación). Un siguiente paso con cualquiera de estos es "útil" o "fuerte", no blando. "no" en caso contrario.
— CONTEXTO DE CALIDAD DEL SIGUIENTE PASO: fuerte = fecha/hora + entregable + criterio de decisión; útil = cualquier compromiso operativo (fecha O canal O entregable); débil = ninguno. Solo "débil" califica como suspected_soft_next_step.
— Si el comprador mostró perfil analítico (pidió datos, cifras, metodología, evidencia): evalúa si el vendedor respondió con precisión (confirmado/inferido/pendiente de prueba) o con persuasión genérica. La persuasión genérica ante un analítico es un fallo grave — nómbralo específicamente.

Devuelve EXACTAMENTE este JSON, sin markdown, sin texto extra:
${schema}`;

  const userMessage = `${isEn ? "TACTICAL CALL MEMORY" : "MEMORIA TÁCTICA"}:\n${memoryText}${contextText}\n\n${isEn ? "REPORTED OUTCOME" : "RESULTADO DECLARADO"}: ${outcomeText}${auditSpeakerUncertaintyBlock}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 900,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    res.json(parsed);
  } catch {
    res.status(500).json({ error: "Audit generation failed" });
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

export default router;
