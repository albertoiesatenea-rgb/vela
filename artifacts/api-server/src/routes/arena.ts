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

// ── CoachLite types ───────────────────────────────────────────────────────────
interface CoachLite {
  explanation: string;
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

    return `Eres el vendedor en una simulación de venta. Actúa como un comercial real y hábil.

Contexto: ${context || "Conversación de venta genérica."}${profileNote}${notesBlock}${windowNote}

CRITERIO DE RESPUESTA:
Responde con la mínima cantidad de información necesaria para mover la conversación un paso útil. Elige el movimiento que pida la situación:
— Pregunta breve para diagnosticar o explorar
— Respuesta directa y corta
— Aclaración de una duda concreta
— Reencuadre de una objeción
— Resumen de lo más importante
— Comprobación breve: "¿Hasta aquí te cuadra?" / "¿Es eso lo que buscas?"
— Desarrollo detallado, solo si el cliente lo pide explícitamente o si la objeción lo exige de verdad

REGLAS:
— No sueltes información sin que te la pidan
— No te justifiques de más ni des toda la argumentación de golpe
— No repitas siempre la misma estructura de respuesta
— No hagas preguntas por inercia si lo que toca es afirmar algo claro
— Tras una respuesta más larga de lo habitual, cierra con una comprobación antes de seguir

Usa **negrita** solo para cifras, argumentos críticos o compromisos concretos. Sin etiquetas ni metacomentarios.
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

  return lang === "en"
    ? `Generate the opening message of a ${whoEn} starting a sales conversation. Context: ${context || "generic sale"}${profileHint}. Write 1-2 natural sentences as that person. No labels. Text only. ${langRule}`
    : `Genera el primer mensaje de un ${who} que inicia o responde a una conversación de venta. Contexto: ${context || "venta genérica"}${profileHint}. Escribe 1-2 frases naturales como esa persona. Sin etiquetas. Solo el texto. ${langRule}`;
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
    return `You are a sales professor pausing a live simulation to annotate a key moment for the class. Write exactly 2 ultra-short sentences. Use **bold** to highlight the 1–2 core tactical terms. Sentence 1: what the seller detected and the move they made. Sentence 2: why it works and what goal it achieves. Third person. No filler, no praise.

Context: ${context || "Generic sale"}
Client said: "${userMessage}"
Seller responded: "${aiMessage}"

Reply ONLY with the 2 sentences. No quotes, no labels.`;
  }
  return `Eres un profesor de ventas que pausa la simulación para anotar un momento clave en la pizarra. Escribe exactamente 2 frases ultra-cortas. Usa **negrita** para destacar 1-2 términos tácticos clave. Frase 1: qué detectó el vendedor y qué movimiento hizo. Frase 2: por qué funciona y qué objetivo consigue. Tercera persona. Sin rodeos, sin elogios.

Contexto: ${context || "Venta genérica"}
Cliente dijo: "${userMessage}"
Vendedor respondió: "${aiMessage}"

Responde SOLO con las 2 frases. Sin comillas, sin etiquetas.`;
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

// ── POST /api/arena/turn ──────────────────────────────────────────────────────
router.post("/arena/turn", async (req, res) => {
  const { arenaSessionId, userMessage } = req.body as {
    arenaSessionId?: string;
    userMessage?: string;
  };

  if (!arenaSessionId || !userMessage?.trim()) {
    res.status(400).json({ error: "arenaSessionId and userMessage required" });
    return;
  }

  const session = sessions.get(arenaSessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  session.turns.push({
    index: session.turns.length,
    timestamp: new Date().toISOString(),
    speaker: "user",
    message: userMessage.trim(),
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

  // ── Run terminal detection + coachLite in parallel ────────────────────────
  const [terminalSignal, coachLite] = await Promise.all([
    detectTerminalState(session.turns, session.role, session.lang, arenaSessionId, session.forceTerminal),
    session.role === "client"
      ? generateCoachLite(userMessage.trim(), aiMessage, session.context, session.lang, arenaSessionId)
      : Promise.resolve(null),
  ]);

  res.json({ aiMessage, terminalSignal, ...(coachLite ? { coachLite } : {}) });
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
