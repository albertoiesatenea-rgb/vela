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
{"signal":"etiqueta táctica 2-5 palabras","say_now":"jugada táctica 4-12 palabras","avoid":"advertencia 2-7 palabras o null","detail":{"reading":"por qué ocurre esto ≤20 palabras","mission":"qué conseguir ahora 1 frase","next_move":"frase o pregunta útil ampliada","support":"dato argumento o criterio concreto"},"journey":{"past":"fase anterior 2-4 palabras","now":"momento actual 3-6 palabras","next":"siguiente paso 2-4 palabras"},"call_memory":{"summary_lines":["línea táctica 1","hasta 6 líneas"]},"momentum":"green|amber|red"}

CAMPOS — cada uno dice algo distinto, nunca se repiten entre sí:
signal = TIPO de situación ("objeción de precio", "falta claridad", "interés real")
reading = POR QUÉ ocurre (contexto subyacente, no repite signal)
mission = QUÉ CONSEGUIR ahora (propósito táctico, no diagnóstico ni acción concreta)
journey.now = dónde está la conversación en su arco ("resolviendo freno principal", no repite signal)
say_now = QUÉ DICES O HACES (acción concreta, 4-12 palabras, imperativo)

ANTI-REPETICIÓN — REGLA CRÍTICA — antes de say_now determina el caso:
1 Cliente respondió CLARAMENTE → AVANZA, prohibido repetir jugada o equivalente
2 Respondió PARCIALMENTE → profundiza en lo pendiente
3 EVITÓ responder → detecta evasión, decide si presionar o rodear
4 Abrió FRENTE NUEVO → cambia eje
5 CAMBIÓ EJE COMPLETAMENTE → reorienta todo
Caso 1: micro-pasos válidos: concretar impacto, cuantificar magnitud, reenfocar al criterio real, resolver objeción, comparar con datos, proponer microcompromiso.

${OBJECTION_TAXONOMY_BLOCK.es}

${COMPARISON_RULE_BLOCK.es}

SAY_NOW: 4-12 palabras, imperativo, una acción, útil en llamada real.
✓ "concreta si teme costes anuales o derramas" ✓ "pregunta qué criterio le frena exactamente"
✗ "explora sus preocupaciones" ✗ "valida sus emociones" ✗ "profundiza más"
Objeción sobre ciudad/producto → aterriza en criterios de decisión concretos.

AVOID: 2-7 palabras solo si hay error táctico real y probable ahora. Si no → null.

SUPPORT — jerarquía:
1. Datos reales en contexto/memoria + momento oportuno → cítalos exactamente y explica cómo usarlos
2. Criterio conocido sin datos → sugiere qué dato conviene y cómo vincularlo al criterio revelado
3. Criterio sin concretar → da criterio de reenfoque táctico
Nunca inventar cifras.

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

function buildSystemPrompt(context?: string, lang?: string): string {
  const contextBlock = context?.trim()
    ? `\nCONTEXTO DE SESIÓN:\n${context.trim()}\nUsa datos concretos de este contexto en detail.support cuando sea tácticamente oportuno.`
    : "";

  const langRule = lang === "en"
    ? `\nLANGUAGE: The call is in English. ALL JSON field values MUST be in English.`
    : `\nIDIOMA: La llamada es en español. TODOS los valores JSON en español.`;

  return `${BASE_SYSTEM_PROMPT}${contextBlock}${langRule}`;
}

// ── POST /api/copilot/analyze ─────────────────────────────────────────────────
router.post("/copilot/analyze", async (req, res) => {
  const parseResult = AnalyzeConversationBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { text, context, call_memory, lang } = parseResult.data;
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
        { role: "system", content: buildSystemPrompt(context, lang) },
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

  const { call_memory, outcome, lang, full_report } = parseResult.data;
  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? undefined;
  const isEn = lang === "en";

  const memoryText = call_memory?.length
    ? call_memory.map(l => `- ${l}`).join("\n")
    : (isEn ? "(No call data available)" : "(Sin datos de llamada disponibles)");

  const outcomeText = outcome ?? (isEn ? "unclear" : "no claro");
  const wantsFullReport = !!full_report;

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

SCORING (0-10, result-weighted):
8.5-9.5: Real close or solid next step, good execution, no major errors
7.5-8.4: Clear advance, good tactical direction, room for improvement
6.0-7.4: Workable, partial progress, visible tactical weaknesses
4.0-5.9: Weak result, relevant errors, inconsistent control
0-3.9: Failed call or no real advance
KEY RULE: outcome=closed|next_step with no major errors → base score ≥8.0.
Short efficient calls are NOT penalized for brevity.

GLOBAL STATE: 1-2 words (strong/solid/advancing/workable/weak/blocked/lost/open)
STRENGTHS: 2-3 specific tactical observations. No generic praise.
IMPROVEMENTS: 2-3 specific, honest tactical observations.

${fullReportInstructions}`
    : `Eres analista experto de llamadas de venta. Evalúa la llamada basándote en la memoria táctica y el resultado declarado.

Devuelve EXACTAMENTE este JSON, sin markdown, sin texto extra:
{"score":7.4,"global_state":"fuerte","result_label":"Siguiente paso acordado","strengths":["f1","f2"],"improvements":["m1","m2"],"full_report":${wantsFullReport ? '"texto del reporte"' : "null"}}

PUNTUACIÓN (0-10, orientada a resultado):
8.5-9.5: Cierre real o siguiente paso sólido, buena ejecución, sin errores graves
7.5-8.4: Avance claro, buena dirección táctica, con mejoras posibles
6.0-7.4: Llamada trabajable, progreso parcial, debilidades tácticas evidentes
4.0-5.9: Resultado débil, errores relevantes, control irregular
0-3.9: Llamada fallida o sin avance real
REGLA CLAVE: resultado=closed|next_step sin errores graves → score base ≥8.0.
Llamadas cortas y eficaces NO se penalizan por brevedad.

ESTADO GLOBAL: 1-2 palabras (fuerte/sólida/avanzando/trabajable/floja/bloqueada/perdida/abierta)
PUNTOS FUERTES: 2-3 observaciones tácticas específicas. Sin elogios genéricos.
PUNTOS A MEJORAR: 2-3 observaciones tácticas específicas y honestas.

${fullReportInstructions}`;

  const userMessage = `${isEn ? "TACTICAL CALL MEMORY" : "MEMORIA TÁCTICA"}:\n${memoryText}\n\n${isEn ? "REPORTED OUTCOME" : "RESULTADO DECLARADO"}: ${outcomeText}\n\n${isEn ? "Analyze and return JSON:" : "Analiza y devuelve el JSON:"}`;

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
