import { Router, type IRouter } from "express";
import {
  AnalyzeConversationBody,
  AnalyzeConversationResponse,
  CallSummarizeBody,
  CallSummarizeResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const BASE_SYSTEM_PROMPT = `Eres un copiloto táctico silencioso para conversaciones de venta y persuasión en tiempo real.

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

Señales de que los atributos ya están revelados:
- menciona características específicas: "universidad", "ciudad grande", "mucha actividad", "más conocida"
- usa adjetivos de criterio: "me da más confianza", "me parece más segura", "la conozco mejor"
- compara con criterios implícitos: "aquí hay más demanda", "tiene más renombre", "la gente la conoce"

ESTOS SON ATRIBUTOS REVELADOS: universidad, tamaño, seguridad, confianza, prestigio, demanda,
actividad económica, ambiente, perfil de inquilino, familiaridad, solidez, rentabilidad percibida.

REGLA ABSOLUTA:
Si la otra parte ya ha enumerado atributos de la alternativa, está PROHIBIDO volver a preguntar
"qué valoras de X", "qué te gusta de X" o cualquier variante.

Esa pregunta ya está respondida. Los atributos son la respuesta.

En ese momento el motor debe avanzar a:
FASE B → traducir los atributos a criterios de inversión reales
  Ejemplo: "universidad + tamaño" → criterio de demanda de alquiler y perfil de inquilino solvente
FASE C → reenfocar esos criterios sobre la propuesta actual
  Ejemplo: comprobar si el activo actual también cumple esos criterios
FASE D → usar datos o argumentos concretos si ya toca y están disponibles
  Ejemplo: si hay datos reales de demanda estudiantil, ocupación o rentabilidad, úsalos ahora
FASE E → avanzar a validación o cierre si los criterios quedan cubiertos

Ejemplos de say_now correcto cuando los atributos ya están revelados:
- "traduce universidad y tamaño a demanda real de alquiler"
- "reencuadra esos criterios sobre Dresden sin comparar ciudades"
- "pregunta si busca seguridad percibida o salida futura real"
- "contrasta ese criterio con el activo actual directamente"
- "confirma si el criterio que valora también se cumple aquí"

Ejemplos de say_now PROHIBIDO en ese momento:
- "pregunta qué valoras de Colonia" ← ya lo dijo
- "explora qué le atrae de la alternativa" ← ya lo reveló
- "descubre qué criterios usa para comparar" ← ya los dio

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

REGLA DE CALIDAD — SUPPORT debe ayudar a vender de verdad:
MAL: "Dresden también tiene universidades" (vago, no accionable)
BIEN: "Si tienes datos de la TU Dresden o matrícula universitaria, úsalos para demostrar demanda estudiantil real."
BIEN: "Universidad + tamaño = seguridad percibida y demanda. Lleva exactamente eso a Dresden sin comparar ciudades en abstracto."
BIEN: "No debatas Colonia vs Dresden; demuestra que Dresden cumple el mismo criterio que él ya valoró."
BIEN: "Si tienes el ratio de ocupación en zona universitaria de Dresden, este es el momento de usarlo."

Cuando el cliente ya ha revelado atributos de una alternativa, SUPPORT debe ser específico sobre:
- cómo vincular ESOS atributos concretos (los que el cliente ya nombró) con el activo actual
- qué dato exacto reforzaría ese argumento
- cómo convertir la comparación abstracta en criterios verificables del activo

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
Evalúa el estado táctico global de la conversación. NO solo el tono emocional.

"green" — momento favorable:
- Interés real manifestado
- Conversación bien orientada hacia un objetivo
- Objeción principal clara, trabajada o resuelta
- Apertura activa, disposición a seguir
- Momentum de avance

"amber" — momento neutro o en construcción:
- Conversación abierta pero sin claridad todavía
- Objeción presente pero trabajable
- Interés posible pero no articulado
- Falta concretar la duda o el criterio
- En proceso de diagnóstico o exploración

"red" — momento desfavorable:
- Resistencia alta o creciente
- Desconfianza activa
- Objeción mal enfocada o que crece
- Pérdida de control de la conversación
- Bloqueo, evasión o cierre emocional

REGLA: si hay objeción fuerte pero ya bien aterrizada y trabajable → amber, no red.
Si hay interés real aunque con dudas → green o amber según apertura.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FASES DE VENTA — REFERENCIA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APERTURA · DIAGNÓSTICO · PRESENTACIÓN · VALIDACIÓN DE INTERÉS · OBJECIÓN ACTIVA ·
RESOLUCIÓN · COMPARACIÓN · CIERRE PRÓXIMO · SEGUIMIENTO · BLOQUEO

La fase determina qué tipo de intervención tiene sentido.
Nunca actúes como si estuvieras en cierre cuando hay objeciones sin resolver.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EJEMPLO DE SALIDA CORRECTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fragmento: "[CLIENTE]: Es que el edificio es muy antiguo, tendrá muchos gastos."
Memoria anterior: ya confirmado interés, primera vez que aparece esta objeción.

{"signal":"objeción de mantenimiento","say_now":"concreta si teme costes anuales o derramas","avoid":"no defiendas el activo aún","detail":{"reading":"No rechaza la inversión; teme que los gastos imprevisibles destruyan la rentabilidad esperada.","next_move":"¿Lo que te preocupa es el coste de mantenimiento anual o las derramas grandes e imprevisibles?","support":"Si tienes datos de ITE o reserva de comunidad, úsalos. Si no, pregunta primero cuánto le impacta en rentabilidad esperada."},"journey":{"past":"Interés inicial confirmado","now":"resolviendo objeción de mantenimiento","next":"cuantificar el freno"},"call_memory":{"summary_lines":["Propuesta presentada","Interés inicial confirmado","Objeción nueva: gastos de mantenimiento en edificio antiguo","Tipo: miedo a costes imprevisibles","Momento: explorando magnitud del freno","Objetivo: concretar y cuantificar el impacto en rentabilidad"]},"momentum":"amber"}

Ejemplo turno siguiente — cliente responde "sí, eso me preocupa":

{"signal":"objeción confirmada","say_now":"cuantifica cuánto le frena en rentabilidad esperada","avoid":null,"detail":{"reading":"Ya confirmó el freno. El siguiente paso es dimensionarlo: ¿cuánto impacta realmente en su rentabilidad?","next_move":"¿Cuánto tendría que gastar en mantenimiento para que esta inversión dejara de tener sentido para ti?","support":"Si tienes datos de coste medio de comunidad o mantenimiento en la zona, úsalos ahora. Si no, ayúdale a calcular el umbral de rentabilidad."},"journey":{"past":"Objeción identificada","now":"cuantificando impacto del freno","next":"reenfocar o resolver"},"call_memory":{"summary_lines":["Propuesta presentada","Interés inicial confirmado","Objeción: gastos de mantenimiento en edificio antiguo","Cliente confirmó que le preocupa","Momento: cuantificando magnitud del freno","Objetivo: dimensionar impacto en rentabilidad y resolver"]},"momentum":"amber"}

Responde SIEMPRE con JSON puro sin markdown ni texto extra.`;

function buildSystemPrompt(context?: string, lang?: string): string {
  const contextBlock = context?.trim()
    ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCONTEXTO DE SESIÓN ACTIVA\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${context.trim()}\n\nUsa este contexto para orientar el análisis. Si contiene datos concretos (estadísticas, precios, rentabilidades, cifras de mercado), extráelos y úsalos en detail.support cuando sean tácitamente oportunos — nunca antes de concretar la duda.`
    : "";

  const langRule = lang === "en"
    ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nLANGUAGE — MANDATORY FINAL RULE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nThe call is in English. ALL values in every JSON field MUST be in English. No Spanish words anywhere in the output.`
    : `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nIDIOMA — REGLA FINAL OBLIGATORIA\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nLa llamada es en español. TODOS los valores en cada campo JSON deben estar en español.`;

  return `${BASE_SYSTEM_PROMPT}${contextBlock}${langRule}`;
}

router.post("/copilot/analyze", async (req, res) => {
  const parseResult = AnalyzeConversationBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { text, context, call_memory, lang } = parseResult.data;

  const userMessage = [
    call_memory ? `MEMORIA ACUMULADA ACTUAL:\n${call_memory}` : null,
    `FRAGMENTO DE CONVERSACIÓN:\n${text}`,
    "Analiza y responde con JSON táctico:",
  ].filter(Boolean).join("\n\n");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 900,
      messages: [
        { role: "system", content: buildSystemPrompt(context, lang) },
        { role: "user", content: userMessage },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content ?? "";

    let parsed: unknown;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawContent);
    } catch {
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
    req.log.error({ err }, "Error calling OpenAI");
    res.status(500).json({ error: "Error analyzing conversation" });
  }
});

// ── Call summarize — generates post-call analysis and optional full report
router.post("/copilot/summarize", async (req, res) => {
  const parseResult = CallSummarizeBody.safeParse(req.body);
  if (!parseResult.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const { call_memory, outcome, lang, full_report } = parseResult.data;
  const isEn = lang === "en";

  const memoryText = call_memory?.length
    ? call_memory.map(l => `- ${l}`).join("\n")
    : (isEn ? "(No call data available)" : "(Sin datos de llamada disponibles)");

  const outcomeText = outcome ?? (isEn ? "unclear" : "no claro");
  const wantsFullReport = !!full_report;

  const systemPrompt = isEn
    ? `You are an expert sales call analyst. Evaluate a completed sales call based on its tactical memory and the reported outcome.

Return EXACTLY this JSON, no markdown, no extra text:
{
  "score": 7.4,
  "global_state": "strong",
  "result_label": "Next step agreed",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "improvements": ["improvement 1", "improvement 2"],
  "full_report": ${wantsFullReport ? '"detailed report text here"' : "null"}
}

SCORING (0-10) — FAIR, RESULT-WEIGHTED SCALE:
The achieved outcome carries the most weight. Short, efficient calls are NOT penalized for brevity.

RANGES:
8.5–9.5: Real close or solid next step achieved, good execution, no major errors
7.5–8.4: Clear advance, good tactical direction, with some room for improvement
6.0–7.4: Workable call, partial or uneven progress, visible tactical weaknesses
4.0–5.9: Weak result, relevant errors, inconsistent control
0–3.9: Failed call or no real advance

SCORE FACTORS (in order of weight):
1. Outcome achieved: close, solid next step, real advance (highest weight)
2. Tactical execution: objection management, control, concreteness, direction quality
3. Absence of major errors: significant tactical errors lower the score
4. Efficiency: a short, direct call that achieves its goal is a strength, not a weakness

KEY RULE: if the outcome is "closed" or "next_step" and there were no major tactical errors, the BASE score must be at least 8.0. Execution determines whether it lands at 8.x or 9.x.

GLOBAL STATE: use 1-2 English words (strong / solid / advancing / workable / weak / blocked / lost / open)

STRENGTHS: 2-3 specific, concrete, tactical observations. No generic praise.
IMPROVEMENTS: 2-3 specific, concrete, honest tactical observations. No vague comments.

${wantsFullReport ? `FULL REPORT: Write the analysis using EXACTLY this format and section headers (no markdown, no bullet symbols except dashes):

Executive summary:
[2-4 sentences describing the call, context, and result]

What went well:
- [specific tactical observation]
- [specific tactical observation]
- [specific tactical observation]

What can be improved:
- [specific tactical observation]
- [specific tactical observation]

Objections or risks detected:
- [objection detected and how it was handled, or: No significant objections detected]

Conversation control:
[1-3 sentences on who controlled the conversation and tactical direction quality]

Close / next step:
[1-3 sentences on close quality or next step achieved]

Recommendation for next call:
[1-3 concrete, actionable sentences]

TONE: honest, tactical, useful. No cheap coaching. No artificial inflation.` : "FULL REPORT: null (not requested)."}

IMPORTANT: Be honest and tactical. No motivational fluff. No generic phrases. Real sales analysis.`
    : `Eres un analista experto de llamadas de venta. Evalúa una llamada completada basándote en su memoria táctica y el resultado reportado.

Devuelve EXACTAMENTE este JSON, sin markdown, sin texto extra:
{
  "score": 7.4,
  "global_state": "fuerte",
  "result_label": "Siguiente paso acordado",
  "strengths": ["fortaleza 1", "fortaleza 2", "fortaleza 3"],
  "improvements": ["mejora 1", "mejora 2"],
  "full_report": ${wantsFullReport ? '"texto del reporte detallado aquí"' : "null"}
}

PUNTUACIÓN (0-10) — ESCALA JUSTA ORIENTADA A RESULTADO:
El resultado conseguido tiene el mayor peso. Las llamadas cortas y eficaces NO se penalizan por ser breves.

RANGOS:
8.5–9.5: Cierre real o siguiente paso sólido conseguido, buena ejecución, sin errores graves
7.5–8.4: Avance claro, buena dirección táctica, con alguna mejora posible
6.0–7.4: Llamada trabajable, progreso parcial o irregular, debilidades tácticas evidentes
4.0–5.9: Resultado débil, errores relevantes, control irregular
0–3.9: Llamada fallida o sin avance real

FACTORES DEL SCORE (en orden de peso):
1. Resultado conseguido: cierre, siguiente paso sólido, avance real (peso máximo)
2. Ejecución táctica: gestión de objeciones, control, concreción, calidad de la dirección
3. Ausencia de errores graves: errores tácticos importantes bajan el score
4. Eficiencia: una llamada corta y directa que consigue su objetivo suma, no resta

REGLA CLAVE: si el resultado fue "closed" o "next_step" y no hubo errores tácticos importantes, el score BASE debe ser mínimo 8.0. La ejecución decide si es 8.x o 9.x.

ESTADO GLOBAL: usa 1-2 palabras en español (fuerte / sólida / avanzando / trabajable / floja / bloqueada / perdida / abierta)

PUNTOS FUERTES: 2-3 observaciones tácticas específicas, concretas, accionables. Sin elogios genéricos.
PUNTOS A MEJORAR: 2-3 observaciones tácticas específicas, concretas, honestas. Sin comentarios vagos.

${wantsFullReport ? `REPORTE COMPLETO: Escribe el análisis usando EXACTAMENTE este formato con estas secciones (sin markdown, sin símbolos de viñeta excepto guiones):

Resumen ejecutivo:
[2-4 frases describiendo la llamada, el contexto y el resultado]

Lo que se hizo bien:
- [observación táctica concreta]
- [observación táctica concreta]
- [observación táctica concreta]

Lo que se puede mejorar:
- [observación táctica concreta]
- [observación táctica concreta]

Objeciones o riesgos detectados:
- [objeción detectada y cómo se gestionó, o: Sin objeciones significativas detectadas]

Control de la conversación:
[1-3 frases sobre quién controló la conversación y qué nivel de dirección táctica hubo]

Cierre / siguiente paso:
[1-3 frases sobre la calidad del cierre o el siguiente paso conseguido]

Recomendación para la próxima llamada:
[1-3 frases concretas y accionables]

TONO: honesto, táctico, útil. Sin coach barato. Sin inflar artificialmente.` : "REPORTE COMPLETO: null (no solicitado)."}

IMPORTANTE: Sé honesto y táctico. Sin motivación barata. Sin frases genéricas. Análisis de venta real.`;

  const userMessage = `MEMORIA TÁCTICA DE LA LLAMADA:\n${memoryText}\n\nRESULTADO REPORTADO POR EL USUARIO: ${outcomeText}\n\nAnaliza y devuelve el JSON:`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: wantsFullReport ? 1600 : 400,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

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

// ── Context label — generates a short 4-6 word title for the session bar
router.post("/copilot/context-label", async (req, res) => {
  const { context, lang } = req.body as { context?: string; lang?: string };
  if (!context?.trim()) { res.json({ label: "" }); return; }
  const isEn = lang === "en";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 25,
      messages: [
        {
          role: "system",
          content: isEn
            ? `Generate a 4-6 word scene title in English for the session bar of a sales tool. No quotes, no trailing punctuation. Title only. Examples: "Sale to skeptical Dresden investor", "B2B negotiation with reluctant CMO", "Close with price-hesitant client", "Liquidity objection in real estate".`
            : `Genera un título de escena de 4-6 palabras en español para la barra de sesión de una herramienta de ventas. Sin comillas, sin puntuación final. Solo el título. Ejemplos: "Venta a inversor escéptico sobre Dresden", "Negociación B2B con CMO reticente", "Cierre con cliente indeciso sobre precio", "Objeción de liquidez en inmobiliario".`,
        },
        { role: "user", content: context.trim() },
      ],
    });
    const label = completion.choices[0]?.message?.content?.trim() ?? "";
    res.json({ label });
  } catch {
    res.json({ label: "" });
  }
});

export default router;
