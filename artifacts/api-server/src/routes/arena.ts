import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logAICall, closeSession } from "../lib/ai-tracker";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────
type ArenaRole = "seller" | "client";
type Lang = "es" | "en";
export type ArenaOutcome = "closed" | "next_step" | "lost" | "broken" | "manual_stop" | "none";

interface ArenaTurn {
  index: number;
  timestamp: string;
  speaker: "user" | "ai";
  message: string;
}

interface ArenaSession {
  id: string;
  role: ArenaRole;
  lang: Lang;
  context: string;
  turns: ArenaTurn[];
  createdAt: string;
  closedAt?: string;
  outcome?: Exclude<ArenaOutcome, "none">;
  clientProfile?: string;
  sellerProfile?: string;
  difficulty?: string;
  forceTerminal?: boolean;
  sellerNotes: string[];
}

// ── In-memory session store ───────────────────────────────────────────────────
const sessions = new Map<string, ArenaSession>();

// ── Optimization flags ────────────────────────────────────────────────────────
// LEGACY_ARENA=true → disable windowing and conditional terminal detection
const USE_OPTIMIZED_ARENA = process.env["LEGACY_ARENA"] !== "true";

// History window: only send last N turns verbatim to the model (seller mode)
const ARENA_HISTORY_WINDOW = 12;   // 6 exchanges
// Max turns for debrief transcript (avoids bloated inputs on long sessions)
const DEBRIEF_MAX_TURNS    = 15;
// Max turns for suggest transcript
const SUGGEST_MAX_TURNS    = 10;

// ── Personality & difficulty descriptors (compact) ────────────────────────────
const CLIENT_PROFILE_DESC: Record<string, string> = {
  analytical:  "Analítico: necesitas datos, precisión, proceso y evidencia antes de decidir. Haces preguntas técnicas. Rechazas vaguedades y argumentos emocionales.",
  emotional:   "Emocional: decides por confianza, conexión y sensación personal. Te influyen historias reales y la empatía del vendedor.",
  skeptical:   "Escéptico: desconfías por defecto. Cuestionas promesas, testimonios genéricos y claims inflados. Solo te convencen pruebas concretas y consistencia entre lo que se dice y lo que se demuestra.",
  cautious:    "Cauto: temes equivocarte. Buscas seguridad, validación externa y pasos reversibles. Pospones si percibes riesgo alto. La presión te aleja.",
  dominant:    "Dominante: quieres control, velocidad y autoridad. Interrumpes, marcas el ritmo y castigas la debilidad o la indecisión.",
  indecisive:  "Indeciso: te cuesta comprometerte. Das vueltas, cambias de opinión y necesitas guía clara para decidir.",
  negotiator:  "Negociador: presionas en precio, comparas alternativas, pides concesiones y usas la negociación como palanca principal.",
};

const SELLER_PROFILE_DESC: Record<string, string> = {
  communicative: "Comunicativo: construyes relación con anécdotas y ejemplos. A veces te extiendes demasiado.",
  authoritative: "Autoritario: directo, asertivo, controlas la conversación, rebates objeciones con firmeza.",
  technical:     "Técnico: hablas de características y datos con detalle. Preciso pero a veces poco emocional.",
  passive:       "Pasivo: escuchas mucho, no presionas, esperas que el cliente llegue a sus conclusiones.",
  aggressive:    "Agresivo: presionas para cerrar, creas urgencia, no aceptas 'no' fácilmente.",
  consultive:    "Consultivo: haces muchas preguntas, entiendes necesidades primero y adaptas tu solución.",
};

const DIFFICULTY_DESC: Record<string, string> = {
  easy:   "Pocas objeciones, abierto a escuchar.",
  normal: "Algunas objeciones válidas, necesitas buenos argumentos.",
  hard:   "Muchas objeciones, comparas con competencia, difícil de convencer.",
  brutal: "Escéptico, cuestionas todo, objeciones fuertes, solo cedes ante argumentos muy sólidos.",
};

// ── Terminal state keywords (for conditional detection) ───────────────────────
// Keywords that strongly suggest a terminal state — intentionally narrow.
// Broad phrases like "de acuerdo", "siguiente paso", "cuándo podemos" are
// normal conversation and should NOT trigger terminal detection on their own.
const TERMINAL_HINTS: Record<Lang, string[]> = {
  es: [
    "trato hecho", "cerramos", "firmamos", "me lo quedo", "me apunto", "lo compro",
    "cuándo firmo", "cuándo firma", "voy a pagar", "pago con", "con tarjeta", "bizum",
    "mándame el contrato", "mándame la propuesta", "cuando quieras empezamos",
    "no me interesa en absoluto", "definitivamente no", "no voy a comprar",
    "no quiero saber más", "hasta aquí", "no seguimos",
    "adiós", "hasta luego",
  ],
  en: [
    "deal", "let's close", "i'll take it", "i'll buy", "send me the contract",
    "when do i sign", "i'll pay with", "by card", "send the proposal",
    "not interested at all", "definitely not", "won't buy", "stop here",
    "goodbye", "bye",
  ],
};

function shouldCheckTerminal(turns: ArenaTurn[], lang: Lang): boolean {
  if (turns.length < 4) return false;
  // Safety net: always check every 3 turns after turn 6
  if (turns.length >= 6 && turns.length % 3 === 0) return true;
  // Keyword detection on last AI message
  const lastMsg = turns[turns.length - 1]?.message.toLowerCase() ?? "";
  return TERMINAL_HINTS[lang].some(kw => lastMsg.includes(kw));
}

// ── CoachLite + Journey types ─────────────────────────────────────────────────
type JourneyStatus = "done" | "current" | "upcoming";
type StageId = "context" | "problem" | "blocker" | "fit" | "advance" | "close";

interface JourneyData {
  stages: Record<StageId, JourneyStatus>;
  now_help: string;
  next_help: string;
  premature_close_risk: "low" | "medium" | "high";
}

interface CoachLite {
  explanation: string;
  journey?: JourneyData;
}

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildSystemPrompt(
  role: ArenaRole,
  context: string,
  lang: Lang,
  historyLen: number,
  clientProfile?: string,
  sellerProfile?: string,
  difficulty?: string,
  sellerNotes?: string[],
): string {
  const langRule = lang === "en" ? "Respond only in English." : "Responde solo en español.";

  const windowNote = USE_OPTIMIZED_ARENA && historyLen > ARENA_HISTORY_WINDOW
    ? (lang === "en"
        ? `\n[Conversation has ${historyLen} turns total. Showing last ${ARENA_HISTORY_WINDOW} for efficiency. Stay consistent with your assigned personality and context.]`
        : `\n[Conversación de ${historyLen} turnos totales. Se muestran solo los últimos ${ARENA_HISTORY_WINDOW} por eficiencia. Mantén coherencia con tu personalidad y el contexto asignados.]`)
    : "";

  if (role === "seller") {
    const profileNote = clientProfile && CLIENT_PROFILE_DESC[clientProfile]
      ? `\nPERSONALIDAD: ${CLIENT_PROFILE_DESC[clientProfile]}`
      : "";
    const diffNote = difficulty && DIFFICULTY_DESC[difficulty]
      ? `\nDIFICULTAD: ${DIFFICULTY_DESC[difficulty]}`
      : "";

    return `Eres el cliente/prospecto en una simulación de conversación de venta.

Contexto: ${context || "Conversación de venta genérica."}${profileNote}${diffNote}${windowNote}

Tu papel es la otra parte. Mantén tu personalidad de forma consistente. Responde con 1-3 frases conversacionales naturales. Usa **negrita** para marcar objeciones clave, precios, plazos o compromisos importantes. Sin más etiquetas ni metacomentarios.
${langRule}`;
  } else {
    const profileNote = sellerProfile && SELLER_PROFILE_DESC[sellerProfile]
      ? `\nPERSONALIDAD: ${SELLER_PROFILE_DESC[sellerProfile]}`
      : "";
    const notesBlock = sellerNotes && sellerNotes.length > 0
      ? `\nRESTRICCIONES DEL VENDEDOR (aplica SIEMPRE — no negociable, sin excepciones):\n${sellerNotes.map((n, i) => `${i + 1}. ${n}`).join("\n")}`
      : "";

    return `Eres el vendedor en una simulación de venta. Actúas como un comercial experimentado: preciso, honesto y sin relleno.

Contexto: ${context || "Conversación de venta genérica."}${profileNote}${notesBlock}${windowNote}

MOVIMIENTOS DISPONIBLES — elige exactamente uno por turno:
1. Diagnosticar con una pregunta concreta (no genérica)
2. Responder directo y breve
3. Identificar el umbral: si el bloqueo es un coste o condición, pregunta exactamente qué tendría que cambiar para que la operación tenga sentido
4. Admitir con honestidad que la operación puede no encajar si el gap con el umbral no se puede cerrar de forma realista

CUANDO EL CLIENTE DEFINE UN UMBRAL (precio, coste, condición tolerable):
— Ese umbral es ahora el eje de la conversación. No lo ignores ni lo diluyas con abstracción.
— Si el cliente pregunta "¿cómo lo mejoramos?" o equivalente, responde con esta estructura mental en una o dos frases:
  (a) qué tendría que cambiar concretamente para acercarse a ese umbral,
  (b) si ese cambio es realista dado el contexto,
  (c) qué conclusión práctica sale de eso.
— Si no hay forma realista de cerrar la distancia, dilo con claridad. No sigas vendiendo una operación que no encaja.

COHERENCIA CON EL CONTEXTO:
— No propongas cambiar variables que el contexto ya define como fijas (precio, alquiler, condiciones pactadas, etc.).
— Si ya has afirmado que algo es fijo, no lo vuelvas a proponer como palanca.
— Si el contexto no permite cerrar el gap con el umbral del cliente, reconócelo.

DETECCIÓN DE OBJECIÓN REPETIDA:
Si el cliente repite la misma objeción más de una vez, no respondas con argumentos laterales que ya aceptó. Ve al umbral o reconoce el bloqueo.

MARCOS DESCARTADOS POR EL CLIENTE:
Si el cliente rechaza explícitamente un tipo de argumento (largo plazo, revalorización, ventaja fiscal, retorno futuro, u otro marco concreto), ese marco está quemado para el resto de la conversación. No lo retomes, no lo reembales con otras palabras, no lo traigas de vuelta por otro ángulo.

CUANDO LA CONCLUSIÓN YA ESTÁ DICHA:
Si ya has afirmado que la operación no encaja para este cliente, o si ya has dado una respuesta completa y suficiente:
— No mandes otro mensaje ampliando, reformulando o repitiendo lo mismo.
— Una conclusión honesta y breve es mejor que tres variaciones de la misma idea.
— Si el cliente no añade información nueva, puedes responder con una sola frase que sostenga la posición o proponga un siguiente paso concreto. No más.
— Un buen cierre es corto. La autoridad no necesita justificarse dos veces.

PROHIBIDO:
— Usar como argumento principal algo que el cliente ya aceptó
— Abrir con "entiendo tu preocupación", "es una pregunta muy válida", "totalmente comprensible" o equivalentes
— Preguntas genéricas de relleno que no diagnostican nada concreto
— Insistir con beneficios laterales cuando el cliente tiene un bloqueo central sin resolver
— Usar "explorar", "optimizar", "maximizar" o "potencial" sin concretar inmediatamente qué cambiaría, en qué cantidad y si es realista
— Proponer cambios que ya dijiste que son imposibles o que el contexto excluye
— Repetir en el siguiente turno una conclusión que ya dijiste de forma clara en el anterior

FORMATO:
— Separa con una línea en blanco la idea principal, la aclaración y la pregunta final. No las pegues en un bloque corrido.
— Si hay 2 o 3 opciones o condiciones, ponlas en lista con guión: "- **Opción:** descripción breve"
— La pregunta final siempre en su propia línea, separada del párrafo anterior.
— Frases cortas. Si la frase supera 20 palabras, córtala.
— No uses listas por sistema. Solo cuando enumeres opciones reales.

TONO: conversacional, claro, creíble. Como una persona, no como un chatbot.
Usa **negrita** para cifras, condiciones clave, conclusiones directas y cualquier término que el lector deba captar de un vistazo. Úsala con criterio — no en cada frase, pero sí donde aporte claridad.
Sin etiquetas ni metacomentarios.
${langRule}`;
  }
}

function buildOpeningPrompt(
  role: ArenaRole,
  context: string,
  lang: Lang,
  clientProfile?: string,
  sellerProfile?: string,
): string {
  const langRule = lang === "en" ? "Write in English." : "Escribe en español.";
  const profileHint = role === "seller" && clientProfile && CLIENT_PROFILE_DESC[clientProfile]
    ? ` Personalidad: ${CLIENT_PROFILE_DESC[clientProfile]}`
    : role === "client" && sellerProfile && SELLER_PROFILE_DESC[sellerProfile]
    ? ` Personalidad: ${SELLER_PROFILE_DESC[sellerProfile]}`
    : "";

  const who = role === "seller" ? "cliente/prospecto" : "vendedor experto";
  const whoEn = role === "seller" ? "client/prospect" : "expert seller";

  if (lang === "en") {
    if (role === "client") {
      // AI plays the expert seller — opening must be 1 sentence, hook-first, with a real invented name+company
      return `You are an expert seller opening a sales conversation. Context: ${context || "generic sale"}${profileHint}. Invent a specific real-sounding name and company for yourself (e.g. "I'm Sara Voss from Clearpath Advisory" — no placeholders, no brackets). Write EXACTLY ONE sentence. It must be a hook, a provocative question, or a brief concrete reference to the prospect's pain — not a product explanation. Use **bold** for the most important word or number. No labels. Text only. ${langRule}`;
    }
    return `Generate the opening message of a ${whoEn} starting a sales conversation. Context: ${context || "generic sale"}${profileHint}. Write 1 short natural sentence as that person. No labels. Text only. ${langRule}`;
  }
  if (role === "client") {
    // AI plays the expert seller — opening must be 1 sentence, hook-first, with a real invented name+company
    return `Eres un vendedor experto que abre una conversación de ventas. Contexto: ${context || "venta genérica"}${profileHint}. Invéntate un nombre y empresa reales y concretos (ej: "Soy Marcos Reina de Solvinova" — sin corchetes, sin variables). Escribe EXACTAMENTE UNA frase. Tiene que ser un gancho, una pregunta provocadora o una referencia concreta al dolor del prospecto — no una explicación del producto. Usa **negrita** para la palabra o cifra más importante. Sin etiquetas. Solo el texto. ${langRule}`;
  }
  return `Genera el primer mensaje de un ${who} que inicia una conversación de venta. Contexto: ${context || "venta genérica"}${profileHint}. Escribe 1 frase corta y natural como esa persona. Sin etiquetas. Solo el texto. ${langRule}`;
}

// ── Debrief generator ─────────────────────────────────────────────────────────
async function generateDebrief(
  turns: ArenaTurn[],
  context: string,
  lang: Lang,
  outcome: Exclude<ArenaOutcome, "none">,
  sessionId?: string,
  clientProfile?: string,
): Promise<{ score: number; critique: string[] } | null> {
  // Limit transcript to avoid bloated debrief inputs on long sessions
  const relevantTurns = USE_OPTIMIZED_ARENA && turns.length > DEBRIEF_MAX_TURNS
    ? turns.slice(-DEBRIEF_MAX_TURNS)
    : turns;

  const transcript = relevantTurns.map(t => {
    const sp = t.speaker === "user"
      ? (lang === "es" ? "VENDEDOR" : "SELLER")
      : (lang === "es" ? "CLIENTE" : "CLIENT");
    return `${sp}: ${t.message}`;
  }).join("\n");

  const outcomeLabels: Record<string, { es: string; en: string }> = {
    closed:      { es: "VENTA CERRADA (el vendedor ganó).",        en: "SALE CLOSED (seller won)." },
    next_step:   { es: "AVANCE CONSEGUIDO (paso adelante).",       en: "NEXT STEP ACHIEVED (progress made)." },
    lost:        { es: "VENTA PERDIDA (el cliente no compró).",    en: "SALE LOST (client left without buying)." },
    broken:      { es: "CONVERSACIÓN ROTA (cliente cortó).",       en: "CONVERSATION BROKEN (client cut contact)." },
    manual_stop: { es: "SESIÓN TERMINADA MANUALMENTE.",            en: "SESSION ENDED MANUALLY." },
  };
  const outcomeLine = lang === "es"
    ? `Resultado: ${outcomeLabels[outcome]?.es ?? outcome}`
    : `Result: ${outcomeLabels[outcome]?.en ?? outcome}`;

  const profileDescEs: Record<string, string> = {
    analytical:  "Analítico — exige datos, evidencia, metodología y respuestas directas. Penaliza si el vendedor no responde con concreción cuando el cliente pide pruebas o cifras.",
    emotional:   "Emocional — exige conexión personal, empatía y construcción de confianza. Penaliza argumentos fríos o transaccionales.",
    skeptical:   "Escéptico — exige pruebas concretas y consistencia entre lo que se promete y lo que se demuestra. Penaliza claims genéricos, testimonios vagos o inconsistencias.",
    cautious:    "Cauto — exige reducción de riesgo percibido, validación externa y pasos reversibles. Penaliza presión o urgencia artificial.",
    dominant:    "Dominante — exige que el vendedor mantenga el control, sea claro y firme. Penaliza si el vendedor cede la dirección de la conversación.",
    indecisive:  "Indeciso — exige guía clara, pasos simples y reducción de fricción. Penaliza si el vendedor deja opciones abiertas o ambigüedad.",
    negotiator:  "Negociador — exige que el vendedor ancle valor antes de hablar de precio. Penaliza concesiones tempranas o descuentos sin contraprestación.",
  };
  const profileDescEn: Record<string, string> = {
    analytical:  "Analytical — demands data, evidence, methodology, and direct answers. Penalize if the seller fails to respond concretely when the client requests proof or numbers.",
    emotional:   "Emotional — demands personal connection, empathy, and trust-building. Penalize cold or transactional arguments.",
    skeptical:   "Skeptical — demands concrete proof and consistency between claims and demonstrated facts. Penalize generic promises, vague testimonials, or inconsistencies.",
    cautious:    "Cautious — demands risk reduction, external validation, and reversible steps. Penalize pressure tactics or artificial urgency.",
    dominant:    "Dominant — demands the seller stays in control, clear and firm. Penalize if the seller cedes the direction of the conversation.",
    indecisive:  "Indecisive — demands clear guidance, simple steps, and reduced friction. Penalize open options or ambiguity.",
    negotiator:  "Negotiator — demands the seller anchors value before discussing price. Penalize early concessions or discounts without a trade-off.",
  };

  const profileLine = lang === "es"
    ? (clientProfile && profileDescEs[clientProfile] ? profileDescEs[clientProfile] : "No especificado.")
    : (clientProfile && profileDescEn[clientProfile] ? profileDescEn[clientProfile] : "Not specified.");

  const windowNote = turns.length > DEBRIEF_MAX_TURNS
    ? (lang === "es"
        ? `[Conversación de ${turns.length} turnos; se analizan los últimos ${relevantTurns.length}]\n`
        : `[Conversation had ${turns.length} turns; analyzing last ${relevantTurns.length}]\n`)
    : "";

  const prompt = lang === "es"
    ? `Eres coach de ventas experto. Evalúa al vendedor con rigor. No inflés la nota.

Contexto: ${context || "venta genérica"}
Perfil del comprador: ${profileLine}
${outcomeLine}
${windowNote}
Conversación:
${transcript}

RÚBRICA:
1. Pesa outcome Y calidad de ejecución por igual.
2. TECHO DURO: score ≤ 7 si el comprador repite una demanda central (datos, evidencia, método, precio concreto) dos o más veces y el vendedor no la resuelve con concreción en esa conversación, aunque el outcome sea next_step.
3. PENALIZACIONES (−1 a −2 c/u): vendedor propone reunión/llamada/cierre antes de resolver la objeción principal · siguiente paso queda ambiguo o sin acción/fecha concreta · vendedor repite la misma estructura de respuesta sin adaptarse.
4. SENSIBILIDAD AL PERFIL: aplica el criterio del perfil indicado arriba para juzgar si el vendedor respondió correctamente.
5. Referencias: closed vs cliente difícil → mín 8; lost/broken → máx 5; next_step buena ejecución → hasta 8; next_step ejecución débil → 5–6.

Responde SOLO con JSON válido:
{"score":<1-10>,"critique":["frase 1","frase 2","frase 3"]}

critique: exactamente 3 frases, imperativo, accionables, específicas a esta conversación. Sin texto fuera del JSON.`
    : `You are an expert sales coach. Evaluate the seller rigorously. Do not inflate the score.

Context: ${context || "generic sale"}
Buyer profile: ${profileLine}
${outcomeLine}
${windowNote}
Conversation:
${transcript}

RUBRIC:
1. Weight outcome AND execution quality equally.
2. HARD CAP: score ≤ 7 if the buyer repeats a core demand (data, evidence, method, specific price) two or more times and the seller never addresses it concretely in this conversation — even if outcome is next_step.
3. PENALTIES (−1 to −2 each): seller proposes meeting/call/close before resolving main objection · next step is ambiguous or lacks a concrete action/date · seller repeats the same response structure without adapting.
4. PROFILE SENSITIVITY: apply the buyer profile criterion above to judge whether the seller responded correctly.
5. Score references: closed vs tough client → min 8; lost/broken → max 5; next_step good execution → up to 8; next_step weak execution → 5–6.

Reply ONLY with valid JSON:
{"score":<1-10>,"critique":["point 1","point 2","point 3"]}

critique: exactly 3 sentences, imperative, actionable, specific to this conversation. No text outside the JSON.`;

  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/finish",
        endpoint: "debrief",
        sessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        maxTokensConfigured: 300,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as { score: number; critique: string[] };
    if (typeof parsed.score === "number" && Array.isArray(parsed.critique)) {
      return {
        score: Math.max(1, Math.min(10, Math.round(parsed.score))),
        critique: parsed.critique.slice(0, 3),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Terminal state detector ───────────────────────────────────────────────────
async function detectTerminalState(
  turns: ArenaTurn[],
  role: ArenaRole,
  lang: Lang,
  sessionId?: string,
  force?: boolean,
): Promise<Exclude<ArenaOutcome, "manual_stop">> {
  if (role === "client") return "none";

  // Skip if terminal check not warranted (saves the extra API call in most turns)
  if (!force && USE_OPTIMIZED_ARENA && !shouldCheckTerminal(turns, lang)) return "none";
  if (turns.length < (force ? 2 : 4)) return "none";

  const recent = turns.slice(-6).map(t => {
    const speaker = t.speaker === "user"
      ? (lang === "es" ? "VENDEDOR" : "SELLER")
      : (lang === "es" ? "CLIENTE" : "CLIENT");
    return `${speaker}: ${t.message}`;
  }).join("\n");

  const prompt = lang === "es"
    ? `Analiza esta conversación de venta y determina si ha llegado a un estado terminal CLARO E INEQUÍVOCO.
Responde ÚNICAMENTE con una de estas palabras:
none | closed | next_step | lost | broken

Definiciones ESTRICTAS — en caso de duda responde none:
none = conversación abierta, en proceso, o ambigua
closed = cliente cerró explícitamente (dijo que compra, cuándo firma, cómo paga)
next_step = cliente COMPROMETIÓ un paso concreto: confirmó fecha de reunión, pidió contrato/propuesta, preguntó por formas de pago, confirmó disponibilidad para llamada concreta — NO vale solo "lo pensaré" ni "me parece bien"
lost = cliente rechazó DEFINITIVAMENTE, sin vuelta atrás
broken = ruptura total, corte de conversación

Conversación:
${recent}

Responde solo con la palabra:`
    : `Analyze this sales conversation and determine if it has reached a CLEAR AND UNAMBIGUOUS terminal state.
Reply with ONLY one word:
none | closed | next_step | lost | broken

STRICT definitions — when in doubt reply none:
none = still open, in progress, or ambiguous
closed = client explicitly closed (said they'll buy, asked when to sign, asked how to pay)
next_step = client COMMITTED to a concrete action: confirmed meeting date, requested contract/proposal, asked about payment methods, confirmed specific availability — "I'll think about it" does NOT qualify
lost = client DEFINITIVELY rejected, no turning back
broken = total breakdown, client cut off

Conversation:
${recent}

One word only:`;

  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 5,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/turn",
        endpoint: "terminal-state",
        sessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        maxTokensConfigured: 5,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }
    const raw = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? "none";
    if (["closed", "next_step", "lost", "broken", "none"].includes(raw)) {
      return raw as Exclude<ArenaOutcome, "manual_stop">;
    }
    return "none";
  } catch {
    return "none";
  }
}

// ── POST /api/arena/start ─────────────────────────────────────────────────────
router.post("/arena/start", async (req, res) => {
  const { role, lang = "es", context = "", clientProfile, sellerProfile, difficulty, forceTerminal } = req.body as {
    role?: ArenaRole;
    lang?: Lang;
    context?: string;
    clientProfile?: string;
    sellerProfile?: string;
    difficulty?: string;
    forceTerminal?: boolean;
  };

  if (!role || !["seller", "client"].includes(role)) {
    res.status(400).json({ error: "role must be 'seller' or 'client'" });
    return;
  }

  const PROFILE_ALIASES: Record<string, string> = { insecure: "cautious", hard_negotiator: "negotiator" };
  const resolvedClientProfile = clientProfile ? (PROFILE_ALIASES[clientProfile] ?? clientProfile) : undefined;

  const id = crypto.randomUUID();
  const session: ArenaSession = {
    id, role, lang,
    context: context.trim(),
    turns: [],
    createdAt: new Date().toISOString(),
    clientProfile: resolvedClientProfile, sellerProfile, difficulty,
    forceTerminal: forceTerminal === true,
    sellerNotes: [],
  };

  let openingMessage = "";
  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      messages: [{ role: "user", content: buildOpeningPrompt(role, context, lang, clientProfile, sellerProfile) }],
    });
    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/start",
        endpoint: "opening",
        sessionId: id,
        mode: "arena",
        model: "gpt-4o-mini",
        maxTokensConfigured: 150,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }
    openingMessage = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    openingMessage = lang === "en" ? "Hello, I'm ready." : "Hola, estoy listo.";
  }

  session.turns.push({ index: 0, timestamp: new Date().toISOString(), speaker: "ai", message: openingMessage });
  sessions.set(id, session);
  res.json({ arenaSessionId: id, openingMessage });
});

// ── CoachLite generator ───────────────────────────────────────────────────────
function buildCoachLitePrompt(
  userMessage: string,
  aiMessage: string,
  context: string,
  lang: Lang,
): string {
  if (lang === "en") {
    return `You are a sales professor annotating a live simulation. MANDATORY FORMAT — exactly 3 lines, nothing else:

Line 1: **Tactical name** (2–4 words in bold only, no period)
Line 2: - what the seller does or detects (≤7 words, no period)
Line 3: - why it works / what goal it achieves (≤7 words, no period)

Context: ${context || "Generic sale"}
Client said: "${userMessage}"
Seller responded: "${aiMessage}"

3 lines only. No intro, no extra sentences, no praise.`;
  }
  return `Eres un profesor de ventas anotando la simulación. FORMATO OBLIGATORIO — exactamente 3 líneas, nada más:

Línea 1: **Nombre táctico** (2–4 palabras en negrita, sin punto)
Línea 2: - qué hace o detecta el vendedor (≤7 palabras, sin punto)
Línea 3: - por qué funciona o qué objetivo consigue (≤7 palabras, sin punto)

Contexto: ${context || "Venta genérica"}
Cliente dijo: "${userMessage}"
Vendedor respondió: "${aiMessage}"

3 líneas exactas. Sin introducción, sin frases extra, sin elogios.`;
}

async function generateCoachLite(
  userMessage: string,
  aiMessage: string,
  context: string,
  lang: Lang,
  sessionId: string,
): Promise<CoachLite | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 280,
      temperature: 0,
      messages: [{ role: "user", content: buildCoachLitePrompt(userMessage, aiMessage, context, lang) }],
    });
    const latencyMs = 0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/turn",
        endpoint: "coach-lite",
        sessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        maxTokensConfigured: 280,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        latencyMs,
        status: "ok",
      });
    }
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return null;
    return { explanation: raw };
  } catch {
    return null;
  }
}

// ── Journey generator (client mode only) ─────────────────────────────────────
const JOURNEY_STAGE_IDS: StageId[] = ["context", "problem", "blocker", "fit", "advance", "close"];

function buildJourneyPrompt(
  turns: ArenaTurn[],
  context: string,
  lang: Lang,
): string {
  const recent = turns.slice(-10).map(t =>
    `${t.speaker === "ai" ? "VENDEDOR" : "CLIENTE"}: ${t.message}`
  ).join("\n");

  if (lang === "en") {
    return `You are analyzing a sales conversation to determine the seller's current stage in the sales process.

Stages (in order):
- context: seller has established what they sell and the conversation frame
- problem: seller has identified a need or friction the client has
- blocker: seller has identified what is blocking the decision (cost, risk, competition, etc.)
- fit: seller has connected their solution to the specific blocker
- advance: client has shown real interest or agreed to a concrete next step
- close: client has made a firm buying decision or firm commitment

Assign to each stage: "done" (completed), "current" (where we are now), "upcoming" (not yet reached).
Exactly ONE stage must be "current". All "done" stages must precede "current".

Also provide:
- now_help: in one short sentence, what the seller is trying to achieve RIGHT NOW
- next_help: in one short sentence, what needs to happen to advance to the next stage
- premature_close_risk: "low" | "medium" | "high" — whether the seller is trying to close too early

Sale context: ${context || "Generic sale"}

Last conversation turns:
${recent}

Return ONLY valid JSON, no markdown:
{"stages":{"context":"...","problem":"...","blocker":"...","fit":"...","advance":"...","close":"..."},"now_help":"...","next_help":"...","premature_close_risk":"..."}`;
  }

  return `Analiza esta conversación de venta e indica en qué etapa del proceso está el vendedor.

Etapas (en orden):
- context: el vendedor ha establecido qué vende y el marco de la conversación
- problem: el vendedor ha identificado una necesidad o fricción del cliente
- blocker: el vendedor ha identificado qué frena la decisión (coste, riesgo, competencia, etc.)
- fit: el vendedor ha conectado su solución con el bloqueo concreto
- advance: el cliente ha mostrado interés real o acordado un paso concreto
- close: el cliente ha tomado una decisión firme de compra o compromiso claro

Asigna a cada etapa: "done" (completada), "current" (donde estamos ahora), "upcoming" (aún no alcanzada).
Exactamente UNA etapa debe ser "current". Las etapas "done" deben preceder al "current".

También:
- now_help: en 1 frase corta, qué intenta conseguir el vendedor AHORA MISMO
- next_help: en 1 frase corta, qué necesita ocurrir para avanzar a la siguiente etapa
- premature_close_risk: "low"|"medium"|"high" — si el vendedor intenta cerrar demasiado pronto

Contexto de la venta: ${context || "Venta genérica"}

Últimos turnos de conversación:
${recent}

Devuelve SOLO JSON válido, sin markdown:
{"stages":{"context":"...","problem":"...","blocker":"...","fit":"...","advance":"...","close":"..."},"now_help":"...","next_help":"...","premature_close_risk":"..."}`;
}

function isValidJourney(obj: unknown): obj is JourneyData {
  if (!obj || typeof obj !== "object") return false;
  const j = obj as Record<string, unknown>;
  if (!j["stages"] || typeof j["stages"] !== "object") return false;
  const stages = j["stages"] as Record<string, unknown>;
  if (!JOURNEY_STAGE_IDS.every(id => ["done", "current", "upcoming"].includes(stages[id] as string))) return false;
  const currentCount = JOURNEY_STAGE_IDS.filter(id => stages[id] === "current").length;
  if (currentCount !== 1) return false;
  if (typeof j["now_help"] !== "string" || typeof j["next_help"] !== "string") return false;
  if (!["low", "medium", "high"].includes(j["premature_close_risk"] as string)) return false;
  return true;
}

async function generateJourney(
  turns: ArenaTurn[],
  context: string,
  lang: Lang,
  sessionId: string,
): Promise<JourneyData | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      temperature: 0,
      messages: [{ role: "user", content: buildJourneyPrompt(turns, context, lang) }],
    });
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/turn",
        endpoint: "journey",
        sessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        maxTokensConfigured: 200,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs: 0,
        status: "ok",
      });
    }
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed: unknown = JSON.parse(raw);
    return isValidJourney(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ── Shortcut response generator (client mode comodín) ────────────────────────
function buildShortcutPrompt(
  lastAiMessage: string,
  recentTurns: ArenaTurn[],
  context: string,
  direction: "agree" | "object",
  lang: Lang,
): string {
  const recent = recentTurns.slice(-6).map(t =>
    `${t.speaker === "ai" ? "VENDEDOR" : "CLIENTE"}: ${t.message}`
  ).join("\n");

  if (lang === "en") {
    const dir = direction === "agree"
      ? `Generate a SHORT, natural CLIENT response that ADVANCES the conversation positively. If the seller asked for a specific fact (budget, timeline, quantity), invent a realistic concrete answer. If they proposed something, accept naturally. Do NOT write "ok tell me more" literally — be specific to what was just said.`
      : `Generate a SHORT, natural CLIENT objection that is SPECIFIC to what the seller just said. The objection must relate directly to their last statement or question — a real concern, not generic resistance like "that doesn't convince me".`;
    return `You are playing the CLIENT in a sales simulation.
${dir}

Sale context: ${context || "Generic sale"}
Recent conversation:
${recent}
Seller just said: "${lastAiMessage}"

Reply ONLY with the client's 1-2 sentence response. No quotes, no labels.`;
  }

  const dir = direction === "agree"
    ? `Genera una respuesta CORTA y natural del CLIENTE que avance la conversación positivamente. Si el vendedor pidió un dato concreto (presupuesto, plazo, cantidad, nombre), inventa una respuesta realista y específica. Si propuso algo, acepta con naturalidad. NO escribas "ok cuéntame más" literalmente — sé específico a lo que acaba de decir.`
    : `Genera una objeción CORTA del CLIENTE que sea ESPECÍFICA a lo que acaba de decir el vendedor. La objeción debe relacionarse directamente con su última afirmación o pregunta — una preocupación real, no resistencia genérica como "eso no me convence".`;

  return `Estás haciendo el papel del CLIENTE en una simulación de venta.
${dir}

Contexto de la venta: ${context || "Venta genérica"}
Conversación reciente:
${recent}
El vendedor acaba de decir: "${lastAiMessage}"

Responde SOLO con la frase del cliente. 1-2 frases máximo. Sin comillas, sin etiquetas.`;
}

async function generateShortcutResponse(
  lastAiMessage: string,
  recentTurns: ArenaTurn[],
  context: string,
  direction: "agree" | "object",
  lang: Lang,
  sessionId: string,
): Promise<string> {
  const fallback = lang === "en" ? "Yes, go on." : "Sí, adelante.";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 80,
      temperature: 0.7,
      messages: [{ role: "user", content: buildShortcutPrompt(lastAiMessage, recentTurns, context, direction, lang) }],
    });
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/turn",
        endpoint: "shortcut",
        sessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        maxTokensConfigured: 80,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs: 0,
        status: "ok",
      });
    }
    return completion.choices[0]?.message?.content?.trim() || fallback;
  } catch {
    return fallback;
  }
}

// ── POST /api/arena/turn ──────────────────────────────────────────────────────
router.post("/arena/turn", async (req, res) => {
  const { arenaSessionId, userMessage, shortcutDirection } = req.body as {
    arenaSessionId?: string;
    userMessage?: string;
    shortcutDirection?: "agree" | "object";
  };

  if (!arenaSessionId || (!userMessage?.trim() && !shortcutDirection)) {
    res.status(400).json({ error: "arenaSessionId and (userMessage or shortcutDirection) required" });
    return;
  }

  const session = sessions.get(arenaSessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // ── Resolve effective user message (direct text or AI-generated comodín) ──
  let effectiveUserMessage = userMessage?.trim() ?? "";
  let generatedUserMessage: string | undefined;

  if (shortcutDirection && session.role === "client") {
    const lastAiTurn = [...session.turns].reverse().find(t => t.speaker === "ai");
    const lastAiMsg = lastAiTurn?.message ?? "";
    effectiveUserMessage = await generateShortcutResponse(
      lastAiMsg, session.turns, session.context, shortcutDirection, session.lang, arenaSessionId,
    );
    generatedUserMessage = effectiveUserMessage;
  }

  session.turns.push({
    index: session.turns.length,
    timestamp: new Date().toISOString(),
    speaker: "user",
    message: effectiveUserMessage,
  });

  // ── History windowing: use full history or last N turns ───────────────────
  const historyLen = session.turns.length;
  const windowedTurns = USE_OPTIMIZED_ARENA && historyLen > ARENA_HISTORY_WINDOW
    ? session.turns.slice(-ARENA_HISTORY_WINDOW)
    : session.turns;

  const gptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    {
      role: "system",
      content: buildSystemPrompt(
        session.role, session.context, session.lang,
        historyLen,
        session.clientProfile, session.sellerProfile, session.difficulty,
        session.sellerNotes,
      ),
    },
  ];

  for (const turn of windowedTurns) {
    gptMessages.push({
      role: turn.speaker === "user" ? "user" : "assistant",
      content: turn.message,
    });
  }

  let aiMessage = "";
  const t0 = Date.now();
  try {
    // Client mode: AI is seller — cap at 220 (allows real context when needed, blocks walls of text)
    const turnMaxTokens = session.role === "client" ? 220 : 300;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: turnMaxTokens,
      messages: gptMessages,
    });
    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/turn",
        endpoint: "turn",
        sessionId: arenaSessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        maxTokensConfigured: turnMaxTokens,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }
    aiMessage = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    aiMessage = session.lang === "en" ? "(No response)" : "(Sin respuesta)";
  }

  session.turns.push({
    index: session.turns.length,
    timestamp: new Date().toISOString(),
    speaker: "ai",
    message: aiMessage,
  });

  // ── Run terminal detection + coachLite + journey in parallel ─────────────
  const [terminalSignal, coachLiteBase, journeyData] = await Promise.all([
    detectTerminalState(session.turns, session.role, session.lang, arenaSessionId, session.forceTerminal),
    session.role === "client"
      ? generateCoachLite(effectiveUserMessage, aiMessage, session.context, session.lang, arenaSessionId)
      : Promise.resolve(null),
    session.role === "client"
      ? generateJourney(session.turns, session.context, session.lang, arenaSessionId)
      : Promise.resolve(null),
  ]);

  // Merge journey into coachLite payload
  const coachLite: CoachLite | null = (coachLiteBase || journeyData)
    ? { explanation: coachLiteBase?.explanation ?? "", ...(journeyData ? { journey: journeyData } : {}) }
    : null;

  res.json({
    aiMessage,
    terminalSignal,
    ...(coachLite ? { coachLite } : {}),
    ...(generatedUserMessage !== undefined ? { generatedUserMessage } : {}),
  });
});

// ── POST /api/arena/finish ────────────────────────────────────────────────────
router.post("/arena/finish", async (req, res) => {
  const { arenaSessionId, outcome } = req.body as {
    arenaSessionId?: string;
    outcome?: Exclude<ArenaOutcome, "none">;
  };

  if (!arenaSessionId) {
    res.status(400).json({ error: "arenaSessionId required" });
    return;
  }

  const session = sessions.get(arenaSessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  session.closedAt = new Date().toISOString();
  session.outcome = outcome ?? "manual_stop";

  const userTurns = session.turns.filter(t => t.speaker === "user").length;
  const needsDebrief = session.role === "seller" && userTurns > 0;
  const debrief = needsDebrief
    ? await generateDebrief(session.turns, session.context, session.lang, session.outcome ?? "manual_stop", arenaSessionId, session.clientProfile)
    : null;

  // Close session — logs totals, keeps record 10 min for debug panel
  closeSession(arenaSessionId);

  res.json({
    turns: session.turns,
    summary: {
      role: session.role,
      context: session.context,
      lang: session.lang,
      totalTurns: session.turns.length,
      userTurns,
      createdAt: session.createdAt,
      closedAt: session.closedAt,
      outcome: session.outcome,
      debrief,
    },
  });

  setTimeout(() => sessions.delete(arenaSessionId), 5 * 60 * 1000);
});

// ── POST /api/arena/note ──────────────────────────────────────────────────────
router.post("/arena/note", (req, res) => {
  const { arenaSessionId, note } = req.body as { arenaSessionId?: string; note?: string };
  if (!arenaSessionId || !note?.trim()) {
    res.status(400).json({ error: "arenaSessionId and note required" });
    return;
  }
  const session = sessions.get(arenaSessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  session.sellerNotes.push(note.trim());
  res.json({ ok: true, noteCount: session.sellerNotes.length });
});

// ── POST /api/arena/repitch ───────────────────────────────────────────────────
// Generates a new AI seller turn without a user message (triggered after a note is injected)
router.post("/arena/repitch", async (req, res) => {
  const { arenaSessionId } = req.body as { arenaSessionId?: string };
  if (!arenaSessionId) { res.status(400).json({ error: "arenaSessionId required" }); return; }
  const session = sessions.get(arenaSessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const historyLen = session.turns.length;
  const windowedTurns = USE_OPTIMIZED_ARENA && historyLen > ARENA_HISTORY_WINDOW
    ? session.turns.slice(-ARENA_HISTORY_WINDOW)
    : session.turns;

  const triggerMsg = session.lang === "en"
    ? "[The client's coach just updated your constraints. Without mentioning it, naturally restate your position according to the updated restrictions — keep it conversational, 1-3 sentences.]"
    : "[El entrenador del cliente acaba de actualizar tus restricciones. Sin mencionarlo, replantea tu posición de forma natural según las restricciones actualizadas — 1-3 frases conversacionales.]";

  const gptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    {
      role: "system",
      content: buildSystemPrompt(
        session.role, session.context, session.lang,
        historyLen,
        session.clientProfile, session.sellerProfile, session.difficulty,
        session.sellerNotes,
      ),
    },
    ...windowedTurns.map(t => ({
      role: (t.speaker === "user" ? "user" : "assistant") as "user" | "assistant",
      content: t.message,
    })),
    { role: "user", content: triggerMsg },
  ];

  const t0 = Date.now();
  let aiResponse = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0.7,
      messages: gptMessages,
    });
    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/repitch",
        endpoint: "turn",
        sessionId: arenaSessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        maxTokensConfigured: 300,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        latencyMs,
      });
    }
    aiResponse = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    aiResponse = session.lang === "en" ? "Let me reconsider that." : "Déjame replantear eso.";
  }

  const newIndex = session.turns.length;
  session.turns.push({ index: newIndex, timestamp: new Date().toISOString(), speaker: "ai", message: aiResponse });
  res.json({ message: aiResponse, index: newIndex });
});

// ── POST /api/arena/suggest ───────────────────────────────────────────────────
router.post("/arena/suggest", async (req, res) => {
  const { arenaSessionId, lang } = req.body as {
    arenaSessionId?: string;
    lang?: Lang;
  };

  if (!arenaSessionId) {
    res.status(400).json({ error: "arenaSessionId required" });
    return;
  }

  const session = sessions.get(arenaSessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const effectiveLang = lang ?? session.lang;

  // Limit transcript for suggest — recent context is what matters
  const relevantTurns = USE_OPTIMIZED_ARENA && session.turns.length > SUGGEST_MAX_TURNS
    ? session.turns.slice(-SUGGEST_MAX_TURNS)
    : session.turns;

  const transcript = relevantTurns.map(t => {
    const sp = t.speaker === "user"
      ? (effectiveLang === "es" ? "VENDEDOR" : "SELLER")
      : (effectiveLang === "es" ? "CLIENTE" : "CLIENT");
    return `${sp}: ${t.message}`;
  }).join("\n");

  const truncNote = session.turns.length > SUGGEST_MAX_TURNS
    ? (effectiveLang === "es"
        ? `[Se muestran los últimos ${SUGGEST_MAX_TURNS} de ${session.turns.length} turnos]\n`
        : `[Showing last ${SUGGEST_MAX_TURNS} of ${session.turns.length} turns]\n`)
    : "";

  const prompt = effectiveLang === "es"
    ? `Eres experto en ventas. Escribe la respuesta PERFECTA que debería dar el vendedor ahora para avanzar la venta.

Contexto: ${session.context || "venta genérica"}
${truncNote}
Conversación:
${transcript}

Solo el texto de la respuesta ideal del vendedor. Natural, conversacional, tácticamente correcto. 2-3 frases máximo.`
    : `You are an expert sales professional. Write the PERFECT response the seller should give now to advance the sale.

Context: ${session.context || "generic sale"}
${truncNote}
Conversation:
${transcript}

Only the ideal seller response. Natural, conversational, tactically sound. 2-3 sentences max.`;

  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }],
    });
    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/suggest",
        endpoint: "suggest",
        sessionId: arenaSessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        maxTokensConfigured: 200,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }
    const suggestion = completion.choices[0]?.message?.content?.trim() ?? "";
    res.json({ suggestion });
  } catch {
    res.status(500).json({ error: "Failed to generate suggestion" });
  }
});

export default router;
