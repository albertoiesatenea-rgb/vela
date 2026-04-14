import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logAICall, closeSession } from "../lib/ai-tracker";
import {
  CLIENT_PROFILE_DESC,
  SELLER_PROFILE_DESC,
  DIFFICULTY_DESC,
  PRESET_SYSTEM_DESC,
  DEBRIEF_CLIENT_PROFILE,
  MASTER_SELLER_BRAIN,
  buildArenaSellerTacticalRules,
  buildGroundingAndPhaseBlock,
  buildObjectionFirstPolicy,
  buildFalseDichotomyGuard,
  buildAntiPrematureDisqualification,
  buildConcreteComparisonEngine,
  extractContextGrounding,
} from "@workspace/sales-brain";

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

interface ArenaStructuredContext {
  meeting_goal?: string;
  main_blocker?: string;
  blocker_status?: "open" | "partial" | "resolved";
  what_not_to_do?: string;
  valid_outcome_today?: string;
  known_context_notes?: string;
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
  randomPreset?: string;
  sellerNotes: string[];
  arenaStructuredContext?: ArenaStructuredContext;
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

// ── Personality, difficulty and preset descriptors ────────────────────────────
// Imported from @workspace/sales-brain (source of truth).
// CLIENT_PROFILE_DESC, SELLER_PROFILE_DESC, DIFFICULTY_DESC, PRESET_SYSTEM_DESC

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

// ── Sentence count helper (client mode compaction) ────────────────────────────
// Approximates sentence count by looking for sentence-ending punctuation.
// Handles bold markdown, ellipsis, and Spanish/English patterns robustly.
function countSentences(text: string): number {
  // Strip markdown bold markers for cleaner counting
  const clean = text.replace(/\*\*/g, "");
  // Match sentence-ending punctuation followed by whitespace/newline/end, or end of string
  const matches = clean.match(/[.!?…]+(?:\s|$|\n)/g);
  if (!matches) return 1;
  // Collapse sequences that are just "..." (single ellipsis) to avoid overcounting
  return matches.filter(m => !/^\.{2,}/.test(m.trim())).length || 1;
}

// ── Question cadence helpers ──────────────────────────────────────────────────
// Detect if a text string ends with a question mark (handles bold markdown wrappers).
function endsWithQuestion(text: string): boolean {
  const stripped = text.trim().replace(/\*\*/g, "");
  return /\?[\s"'»\u00BB]*$/.test(stripped);
}

// Client signals that they want clarity or an example — seller should explain, not ask.
const CLARITY_PATTERNS: Record<Lang, string[]> = {
  es: [
    "explícame", "explica", "ponme un ejemplo", "dame un ejemplo", "ejemplo concreto",
    "más claro", "más simple", "en simple", "simplifica", "sin jerga", "no entiendo",
    "no me queda claro", "no queda claro",
  ],
  en: [
    "explain", "give me an example", "concrete example",
    "more clearly", "simpler", "simplify", "no jargon", "don't understand",
    "not clear",
  ],
};

// Client signals frustration specifically with questions being asked too often.
const FRUSTRATION_PATTERNS: Record<Lang, string[]> = {
  es: [
    "basta de preguntas", "deja de preguntar", "para de preguntar",
    "siempre preguntas", "solo preguntas", "tantas preguntas", "más preguntas",
    "no me preguntes", "sin preguntas",
  ],
  en: [
    "stop asking", "you keep asking", "always questions", "just questions",
    "enough questions", "no more questions", "no questions",
  ],
};

// Markers of a competitor or concrete alternative being raised.
const COMPETITOR_PATTERNS: Record<Lang, string[]> = {
  es: [
    "berlín", "berlin", "leipzig", "magdeburg", "madrid", "barcelona", "lisboa", "dubai", "miami",
    "alternativa", "otra opción", "en vez de", "en lugar de", "la competencia",
    "el otro", "la otra", "prefiero otra", "mejor opción", "otra propuesta",
  ],
  en: [
    "alternative", "competitor", "instead of", "rather than", "other option",
    "prefer another", "better option", "other deal",
  ],
};

// Client signals that they want a direct, rapid response — no storytelling, no jargon.
const TIME_PRESSURE_PATTERNS: Record<Lang, string[]> = {
  es: [
    "tengo poco tiempo", "no tengo tiempo", "rápido", "al grano", "en resumen",
    "no me cuentes historias", "hablando claro", "sé directo", "sin rodeos",
    "sin storytelling", "sin rollo", "punto por punto",
  ],
  en: [
    "short on time", "no time", "quick", "to the point", "in short",
    "no stories", "be direct", "cut to the chase", "no fluff", "straight to it",
  ],
};

interface CadenceAnalysis {
  lastAiHadQuestion: boolean;             // previous AI turn ended with question
  recentQuestionCount: number;            // questions in last 3 AI turns
  clientWantsClarity: boolean;            // client asked for explanation / example
  clientFrustratedWithQuestions: boolean; // client explicitly asked to stop questions
  clientTimePressed: boolean;             // client signalled urgency / wants brevity
  competitorMentioned: boolean;           // client brought a concrete alternative
  repeatedObjection: boolean;             // same objection keyword in last 2 user messages
}

// Analyze the session turn history to detect cadence patterns.
// Called only for client mode (AI = seller).
// currentUserMessage must be the INCOMING user message (not yet in session.turns).
function analyzeQuestionCadence(session: ArenaSession, currentUserMessage: string): CadenceAnalysis {
  const aiTurns = session.turns.filter(t => t.speaker === "ai");
  const lastAiHadQuestion = aiTurns.length > 0
    ? endsWithQuestion(aiTurns[aiTurns.length - 1]!.message)
    : false;

  const lastThreeAiTurns = aiTurns.slice(-3);
  const recentQuestionCount = lastThreeAiTurns.filter(t => endsWithQuestion(t.message)).length;

  // Use the CURRENT incoming user message for pattern detection (not the previous one in history)
  const lower = currentUserMessage.toLowerCase();

  const clarityPatterns = CLARITY_PATTERNS[session.lang];
  const frustrationPatterns = FRUSTRATION_PATTERNS[session.lang];
  const competitorPatterns = COMPETITOR_PATTERNS[session.lang];
  const timePressurePatterns = TIME_PRESSURE_PATTERNS[session.lang];

  const clientWantsClarity = clarityPatterns.some(p => lower.includes(p));
  const clientFrustratedWithQuestions = frustrationPatterns.some(p => lower.includes(p));
  const clientTimePressed = timePressurePatterns.some(p => lower.includes(p));
  const competitorMentioned = competitorPatterns.some(p => lower.includes(p));

  // Repeated objection: same keyword in the last user message in history AND the current one
  const prevUserMsg = [...session.turns].reverse().find(t => t.speaker === "user")?.message ?? "";
  const recentUserMsgs = [prevUserMsg.toLowerCase(), lower].filter(Boolean);
  const OBJECTION_KEYWORDS = session.lang === "es"
    ? ["precio", "caro", "cara", "no me convence", "no encaja", "no tengo", "no puedo", "no es el momento"]
    : ["price", "expensive", "not convinced", "doesn't fit", "can't", "not the right time"];
  const repeatedObjection = recentUserMsgs.length >= 2 &&
    OBJECTION_KEYWORDS.some(kw => recentUserMsgs.every(m => m.includes(kw)));

  return {
    lastAiHadQuestion, recentQuestionCount,
    clientWantsClarity, clientFrustratedWithQuestions, clientTimePressed,
    competitorMentioned, repeatedObjection,
  };
}

// Build an inline contextual instruction to inject into the system prompt for this turn.
// Returns empty string when no cadence correction is needed.
function buildCadenceNote(analysis: CadenceAnalysis, lang: Lang): string {
  const notes: string[] = [];

  if (analysis.clientTimePressed) {
    notes.push(lang === "es"
      ? "⚠️ MODO RESPUESTA DIRECTA — ESTE TURNO: El cliente indicó que tiene poco tiempo o pidió ir al grano. Aplica sin excepción: máximo 2 frases. CERO storytelling. CERO jerga abstracta. Si pide comparación, da comparación directa en 2 líneas. Si pide ejemplo, da el ejemplo sin introducción. Sin pregunta final salvo que sea imprescindible y muy concreta."
      : "⚠️ DIRECT RESPONSE MODE — THIS TURN: Client signalled urgency or asked for brevity. Apply without exception: maximum 2 sentences. ZERO storytelling. ZERO abstract jargon. If they ask for comparison, give it in 2 lines. If they ask for an example, give it directly. No closing question unless strictly necessary and very specific.");
  }

  if (analysis.clientFrustratedWithQuestions) {
    notes.push(lang === "es"
      ? "⚠️ MODO EXPLICACIÓN CLARA ACTIVADO — ESTE TURNO: El cliente expresó frustración con las preguntas. Responde con (1) una explicación directa, (2) un ejemplo concreto si aplica. CERO preguntas al final. Sin jerga. Frases cortas."
      : "⚠️ CLEAR EXPLANATION MODE — THIS TURN: Client expressed frustration with questions. Respond with (1) a direct explanation, (2) a concrete example if applicable. ZERO questions at the end. No jargon. Short sentences.");
  } else if (analysis.clientWantsClarity) {
    notes.push(lang === "es"
      ? "⚠️ TURNO DE EXPLICACIÓN — ESTE TURNO: El cliente pidió claridad o un ejemplo. Responde con explicación directa + ejemplo concreto si aplica. Sin jerga. Sin pregunta al final de este turno."
      : "⚠️ EXPLANATION TURN — THIS TURN: Client asked for clarity or an example. Respond with direct explanation + concrete example if applicable. No jargon. No question at the end of this turn.");
  } else if (analysis.recentQuestionCount >= 2) {
    notes.push(lang === "es"
      ? "⚠️ MODO STATEMENT FORZADO — ESTE TURNO: Hiciste pregunta en 2+ de los últimos 3 turnos. Este turno: haz una afirmación táctica o propón un paso concreto. Sin pregunta al final."
      : "⚠️ STATEMENT MODE — THIS TURN: You asked a question in 2+ of the last 3 turns. This turn: make a tactical statement or propose a concrete next step. No question at the end.");
  } else if (analysis.lastAiHadQuestion) {
    notes.push(lang === "es"
      ? "⚠️ Hiciste pregunta en el turno anterior. Si el cliente ya dio suficiente contexto, responde con una afirmación o propuesta. Solo haz pregunta si es imprescindible para avanzar."
      : "⚠️ You asked a question in the previous turn. If the client gave enough context, respond with a statement or proposal. Only ask if strictly necessary to advance.");
  }

  if (analysis.competitorMentioned) {
    notes.push(lang === "es"
      ? "⚠️ COMPARACIÓN COMPETITIVA — ESTE TURNO: El cliente trajo una alternativa concreta. Usa este formato: (1) Reconoce el criterio real del cliente en 1 frase. (2) Compara en 2-3 ejes concretos — sé honesto si la alternativa gana en alguno. (3) Solo haz pregunta si ayuda a decidir entre criterios reales y distintos de los ya explorados. PROHIBIDO: '¿qué prefieres?', '¿qué valoras más?', '¿qué es más importante para ti?' si ya hiciste alguna variación de esa pregunta."
      : "⚠️ COMPETITIVE COMPARISON — THIS TURN: Client brought a concrete alternative. Use this format: (1) Acknowledge the client's real criterion in 1 sentence. (2) Compare on 2-3 concrete axes — be honest if the rival wins on some. (3) Only ask a question if it helps decide between genuinely different criteria not already explored. FORBIDDEN: 'what do you prefer?', 'what matters most?', 'what's more important to you?' if you've already asked any variation of that.");
  }

  return notes.length > 0
    ? `\n\n[INSTRUCCIÓN CONTEXTUAL — OBLIGATORIA ESTE TURNO]\n${notes.join("\n")}`
    : "";
}

// Lightweight structured event logger for cadence and mode observability.
// These events are captured by the Pino logger alongside regular request logs.
// Useful for measuring: question rate, direct mode activation, mode distribution.
function logCadenceEvent(
  sessionId: string,
  event:
    | "ends_in_question" | "statement_forced" | "clarity_mode"
    | "journey_gated" | "coach_lite_gated" | "direct_mode",
  detail?: string,
): void {
  console.log(JSON.stringify({ type: "cadence", sessionId, event, ...(detail ? { detail } : {}), ts: Date.now() }));
}

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

interface CoachLiteFields {
  signal: string;
  reading: string;
  mission: string;
  next_move: string;
  strategy: string;
  why_this_response: string;
  alternative: string;
}

interface CoachLite {
  explanation: string;
  journey?: JourneyData;
  fields?: CoachLiteFields;
}

// ── Context verified-data extractor ──────────────────────────────────────────
// Scans the session context string for numbers, percentages, currency values and
// explicit facts that the seller IS allowed to use.  Any number not appearing
// in this block or stated by the client in the conversation is "invented".
// Returns a short prompt block (or empty string if no numeric facts found).
function buildVerifiedDataBlock(context: string, lang: Lang): string {
  // Match: standalone numbers with optional unit: %, €, $, k, mil, años, m², etc.
  const raw = context.match(/\d+(?:[.,]\d+)?\s*(?:%|€|\$|k|K|mil(?:es)?|años?|m²|por\s+ciento|percent)?/gi) ?? [];
  // Deduplicate and take up to 12 data points to keep prompt size bounded
  const facts = [...new Set(raw.map(s => s.trim()).filter(s => s.length > 1))].slice(0, 12);
  if (facts.length === 0) return "";
  if (lang === "en") {
    return `\n\nVERIFIED SESSION DATA (the only numbers you may cite in comparisons or examples):\n${facts.map(f => `— ${f}`).join("\n")}\nAny other number, percentage, or projection NOT in this list AND NOT stated by the client is INVENTED. Do not use it. If you lack a number, say so explicitly.`;
  }
  return `\n\nDATOS VERIFICADOS DEL CONTEXTO (los únicos que puedes citar en comparaciones o ejemplos):\n${facts.map(f => `— ${f}`).join("\n")}\nCualquier otro número, porcentaje o proyección que NO esté en esta lista Y que el cliente NO haya mencionado explícitamente es INVENTADO. No lo uses. Si te falta un dato, dilo con claridad.`;
}

// ── Context sanitizer ─────────────────────────────────────────────────────────
// When the user pastes the full Prompter output (which contains multiple labeled blocks
// like DATA CHECK, SITUACIÓN DETECTADA, PROBABLE, FALTA POR ACLARAR), extract only the
// "CONTEXTO MAESTRO PARA VELA" section so the model isn't confused by the surrounding noise.
// Falls back to the full context if no such block is found.
function sanitizeArenaContext(context: string): string {
  if (!context || context.length < 100) return context;
  const masterRe = /CONTEXTO\s+MAESTRO\s+PARA\s+VELA[^\n]*\n([\s\S]+?)(?=\n(?:DATA\s+CHECK|SITUACI[ÓO]N\s+DETECTADA|PROBABLE|FALTA\s+POR\s+ACLARAR|TIPS|NOTAS|={3,}|─{3,}|—{3,}|-{4,})|$)/i;
  const m = context.match(masterRe);
  if (m && m[1] && m[1].trim().length > 80) {
    return m[1].trim();
  }
  return context;
}

// ── Dominant technical objection signals ──────────────────────────────────────
// Phrases in either language that indicate a rent/yield/price/contract objection is the
// dominant active blocker. Used to activate the per-turn hard-block injection.
const DOMINANT_TECH_SIGNALS: string[] = [
  // ES — rent / yield / price
  "renta muy baja", "renta baja", "renta demasiado baja", "renta insuficiente",
  "2,3%", "2.3%", "el porcentaje", "la rentabilidad es baja", "rentabilidad muy baja",
  "rentabilidad baja", "rendimiento bajo", "rentabilidad muy poca", "rentabilidad poca",
  "la renta es baja", "la renta está baja", "la renta no cubre",
  // ES — contract / rent increase
  "contrato antiguo", "contrato de renta antigua", "precio de alquiler bajo",
  "límite de subida", "límites de subida", "límite de actualización",
  "cuándo sube el alquiler", "cuándo puede subir", "subida de alquiler",
  // ES — extraordinary costs / price
  "derrama", "cuota extraordinaria", "gastos extraordinarios", "coste extraordinario",
  "precio alto", "precio muy alto", "el precio no encaja", "precio no me cuadra",
  // EN equivalents
  "rent is too low", "rent too low", "low rent", "rent very low",
  "yield is low", "yield too low", "return is low", "2.3%", "1.8%",
  "old contract", "legacy contract", "below-market rent",
  "rent cap", "rent increase cap", "rent control",
  "extraordinary costs", "special assessment", "price is too high",
];

// ── Conceded frame signals ─────────────────────────────────────────────────────
// Phrases a client says that explicitly close a non-technical frame.
// If detected in client turns, that frame must never be reopened as a question or argument.
interface ConcededFrameSignal { patterns: string[]; frame: string }
const CONCEDED_FRAME_SIGNALS: ConcededFrameSignal[] = [
  {
    patterns: [
      "tranquilidad te la compro", "la tranquilidad me cuadra", "tranquilidad ok",
      "la tranquilidad no la discuto", "la tranquilidad la entiendo",
      "tranquilidad de acuerdo", "tranquilidad sí",
      "i'll buy the stability", "stability works", "stability is fine",
      "not disputing the stability", "long-term is fine", "long-term ok",
    ],
    frame: "tranquilidad/seguridad patrimonial",
  },
  {
    patterns: [
      "la zona me cuadra", "la zona me gusta", "zona ok",
      "la ubicación me cuadra", "la ubicación me gusta",
      "la ubicación no la discuto", "zona bien", "ubicación bien",
      "the area works", "the location works", "location is fine",
      "not disputing the location",
    ],
    frame: "zona/ubicación",
  },
  {
    patterns: [
      "el activo me gusta", "el piso me gusta", "la propiedad me gusta",
      "el activo me cuadra", "el activo en sí ok", "el activo no es el problema",
      "el activo no lo discuto", "la propiedad no es el problema",
      "i like the property", "the asset is fine", "not rejecting the asset",
    ],
    frame: "el activo/propiedad",
  },
  {
    patterns: [
      "la estabilidad la entiendo", "la estabilidad me cuadra", "estabilidad ok",
      "el largo plazo lo entiendo", "el largo plazo me cuadra",
      "largo plazo ok", "el largo plazo no es el problema",
    ],
    frame: "estabilidad/horizonte a largo plazo",
  },
  {
    patterns: [
      "la financiación me cuadra", "la financiación ok",
      "la financiación no es el problema", "financiación de acuerdo",
      "financing works", "financing is ok", "financing not the issue",
    ],
    frame: "condiciones de financiación",
  },
];

// ── Per-turn dominant objection injection ─────────────────────────────────────
// Called each turn in client mode (AI = seller). Scans conversation state and returns
// a high-priority injection block appended at the END of the system prompt.
// Empty string when no technical objection is detected.
function buildDominantObjectionInjection(
  session: ArenaSession,
  currentUserMessage: string,
  lang: Lang,
): string {
  if (session.role !== "client") return "";

  // Scan full context + entire history + current message for technical objection signals
  const allText = [
    session.context,
    ...session.turns.map(t => t.message),
    currentUserMessage,
  ].join(" ").toLowerCase();

  const hasDomTech = DOMINANT_TECH_SIGNALS.some(s => allText.includes(s.toLowerCase()));
  if (!hasDomTech) return "";

  // Detect conceded frames — scan client turns only
  const clientHistoryLower = [
    ...session.turns.filter(t => t.speaker === "user").map(t => t.message.toLowerCase()),
    currentUserMessage.toLowerCase(),
  ].join(" ");

  const concededFrames: string[] = [];
  for (const sig of CONCEDED_FRAME_SIGNALS) {
    if (sig.patterns.some(p => clientHistoryLower.includes(p.toLowerCase()))) {
      concededFrames.push(sig.frame);
    }
  }

  // Detect past temporal references in context
  const temporalRefs = (session.context.match(
    /(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:de\s+)?\d{4}/gi,
  ) ?? []);
  const currentYear = new Date().getFullYear();
  const pastRefs = temporalRefs.filter(ref => {
    const yr = ref.match(/\d{4}/);
    return yr && parseInt(yr[0]) < currentYear;
  });

  // Client corrects a temporal framing by the seller
  const clientCorrectsTime = /estamos en \d{4}|ya est[aá]n|ya subi[oó]|ya pasó|eso ya fue|ya ocurrió|that was|already happened|already went up|we('re| are) in \d{4}|that.s past|ya se aplic/i.test(currentUserMessage);

  const parts: string[] = [];

  // ── Core technical objection mode block ───────────────────────────────────
  if (lang === "es") {
    parts.push(`⚠️ MODO OBJECIÓN TÉCNICA DOMINANTE — ACTIVO ESTE TURNO
Se ha detectado una objeción técnica/financiera activa (renta, rentabilidad, precio o contrato).
Este modo tiene PRIORIDAD MÁXIMA sobre cualquier regla táctica general. No admite excepciones.

SECUENCIA OBLIGATORIA — si no la sigues en orden, la respuesta es un FALLO GRAVE:
a) NOMBRA la cifra o condición exacta que el cliente citó. Sin paráfrasis, sin abstracción.
b) SEPARA explícitamente: "Lo confirmado es [X]. La inferencia razonable es [Y]. Lo que falta confirmar es [Z]."
c) MIDE el impacto real de ese gap sobre la decisión de compra.
d) MIDE el residuo: "Si resolvemos [X], ¿queda algo más que te frene?"
e) Solo entonces: reencuadra o propón un siguiente paso concreto.

PROHIBICIONES ABSOLUTAS ESTE TURNO — cualquier violación = FALLO GRAVE:
— Responder a la objeción técnica con "esto es una cuestión de patrimonio a largo plazo" u otro reencuadre genérico sin antes abordar la matemática concreta del cliente.
— Introducir a terceros (pareja, socio, asesor) como tema central antes de completar los pasos a–d.
— Proponer otra propiedad o alternativa antes de completar los pasos a–d.
— Crear dicotomías con marcos no técnicos si la objeción técnica sigue viva ("¿seguridad o rentabilidad?", "¿patrimonio o cashflow?" cuando el bloqueo real es la cifra de renta).`);
  } else {
    parts.push(`⚠️ DOMINANT TECHNICAL OBJECTION MODE — ACTIVE THIS TURN
An active technical/financial objection has been detected (rent, yield, price, or contract).
This mode has MAXIMUM PRIORITY over any general tactical rule. No exceptions.

MANDATORY SEQUENCE — if you skip or reorder steps, the response is a GRAVE FAILURE:
a) NAME the exact figure or condition the client cited. No paraphrase, no abstraction.
b) SEPARATE explicitly: "What's confirmed is [X]. Reasonable inference is [Y]. What's still unconfirmed is [Z]."
c) MEASURE the real impact of that gap on the purchase decision.
d) MEASURE the residue: "If we resolve [X], is there anything else blocking you?"
e) Only then: reframe or propose a concrete next step.

ABSOLUTE PROHIBITIONS THIS TURN — any violation = GRAVE FAILURE:
— Responding to the technical objection with "this is about long-term wealth" or any generic reframe without first addressing the client's specific math.
— Introducing third parties (partner, advisor) as the main topic before completing steps a–d.
— Proposing another property or alternative before completing steps a–d.
— Creating dichotomies with non-technical frames while the technical objection is still live ("security or returns?", "wealth or cashflow?" when the real blocker is a specific rent figure).`);
  }

  // ── Conceded frames hard-block ────────────────────────────────────────────
  if (concededFrames.length > 0) {
    const frameList = concededFrames.map(f => `"${f}"`).join(", ");
    if (lang === "es") {
      parts.push(`MARCOS YA CONCEDIDOS — CIERRE DEFINITIVO:
El cliente ha aceptado explícitamente estos marcos: ${frameList}.
PROHIBICIÓN TOTAL: no puedes reabrir, citar ni usar ninguno de estos marcos como pregunta exploratoria, argumento de valor o polo en una dicotomía. Hacerlo es FALLO GRAVE.
El único trabajo que te queda es la objeción técnica activa.`);
    } else {
      parts.push(`CONCEDED FRAMES — PERMANENTLY CLOSED:
The client has explicitly accepted these frames: ${frameList}.
TOTAL PROHIBITION: you cannot reopen, mention, or use any of these frames as an exploratory question, value argument, or pole in a dichotomy. Doing so is a GRAVE FAILURE.
The only remaining work is the active technical objection.`);
    }
  }

  // ── Temporal grounding ────────────────────────────────────────────────────
  if (pastRefs.length > 0 || clientCorrectsTime) {
    if (lang === "es") {
      const refStr = pastRefs.slice(0, 3).join(", ");
      parts.push(`ANCLAJE TEMPORAL — OBLIGATORIO:
${refStr ? `El contexto cita eventos con fechas pasadas: ${refStr}. Son hechos consumados — no los presentes como algo que "va a ocurrir" o "podría ocurrir".` : ""}${clientCorrectsTime ? " El cliente acaba de corregir tu encuadre temporal. Acepta la corrección de inmediato y sin argumentar." : ""}
PROHIBIDO: presentar como futura cualquier subida, revisión o actualización de renta o precio que el contexto o el cliente indiquen como ya ocurrida.
CORRECTO: "en [mes año] se aplicó la revisión". PROHIBIDO: "habrá una próxima revisión" si ya ocurrió.`);
    } else {
      const refStr = pastRefs.slice(0, 3).join(", ");
      parts.push(`TEMPORAL GROUNDING — MANDATORY:
${refStr ? `Context cites events with past dates: ${refStr}. These are past facts — do not present them as things that "will happen" or "could happen".` : ""}${clientCorrectsTime ? " The client just corrected your temporal framing. Accept the correction immediately without arguing." : ""}
FORBIDDEN: framing as future any rent increase, review, or update that context or client indicates already occurred.
CORRECT: "in [month year] the review was applied". FORBIDDEN: "there will be an upcoming review" if it already happened.`);
    }
  }

  return `\n\n[INSTRUCCIÓN TÁCTICA CRÍTICA — MÁXIMA PRIORIDAD — ESTE TURNO]\n${parts.join("\n\n")}`;
}

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildArenaScBlock(sc: ArenaStructuredContext | undefined, lang: Lang): string {
  if (!sc) return "";
  const lines: string[] = [];
  if (sc.meeting_goal) lines.push(lang === "es" ? `Objetivo de sesión: ${sc.meeting_goal}` : `Session goal: ${sc.meeting_goal}`);
  if (sc.main_blocker) {
    const statusLabel = sc.blocker_status === "resolved"
      ? (lang === "es" ? " [resuelto]" : " [resolved]")
      : sc.blocker_status === "partial"
      ? (lang === "es" ? " [parcialmente resuelto]" : " [partially resolved]")
      : (lang === "es" ? " [pendiente]" : " [open]");
    lines.push(lang === "es" ? `Bloqueo principal: ${sc.main_blocker}${statusLabel}` : `Main blocker: ${sc.main_blocker}${statusLabel}`);
  }
  if (sc.what_not_to_do) lines.push(lang === "es" ? `Restricción conductual: ${sc.what_not_to_do}` : `Behavioral constraint: ${sc.what_not_to_do}`);
  if (sc.valid_outcome_today) lines.push(lang === "es" ? `Resultado válido hoy: ${sc.valid_outcome_today}` : `Valid outcome today: ${sc.valid_outcome_today}`);
  if (sc.known_context_notes) lines.push(lang === "es" ? `Notas de escenario: ${sc.known_context_notes}` : `Scenario notes: ${sc.known_context_notes}`);
  if (lines.length === 0) return "";
  return "\n\n[OBJETIVO DE SESIÓN]\n" + lines.map(l => `— ${l}`).join("\n");
}

function buildSystemPrompt(
  role: ArenaRole,
  context: string,
  lang: Lang,
  historyLen: number,
  clientProfile?: string,
  sellerProfile?: string,
  difficulty?: string,
  sellerNotes?: string[],
  randomPreset?: string,
  arenaStructuredContext?: ArenaStructuredContext,
  cadenceNote = "",
  objectionNote = "",
): string {
  const langRule = lang === "en" ? "Respond only in English." : "Responde solo en español.";

  const windowNote = USE_OPTIMIZED_ARENA && historyLen > ARENA_HISTORY_WINDOW
    ? (lang === "en"
        ? `\n[Conversation has ${historyLen} turns total. Showing last ${ARENA_HISTORY_WINDOW} for efficiency. Stay consistent with your assigned personality and context.]`
        : `\n[Conversación de ${historyLen} turnos totales. Se muestran solo los últimos ${ARENA_HISTORY_WINDOW} por eficiencia. Mantén coherencia con tu personalidad y el contexto asignados.]`)
    : "";

  const presetBlock = randomPreset && PRESET_SYSTEM_DESC[randomPreset]
    ? `\n\n${PRESET_SYSTEM_DESC[randomPreset][lang === "en" ? "en" : "es"]}`
    : "";

  const scBlock = buildArenaScBlock(arenaStructuredContext, lang);

  if (role === "seller") {
    const profileNote = clientProfile && CLIENT_PROFILE_DESC[clientProfile]
      ? `\nPERSONALIDAD: ${CLIENT_PROFILE_DESC[clientProfile]}`
      : "";
    const diffNote = difficulty && DIFFICULTY_DESC[difficulty]
      ? `\nDIFICULTAD: ${DIFFICULTY_DESC[difficulty]}`
      : "";

    return `Eres el cliente/prospecto en una simulación de conversación de venta.

Contexto: ${context || "Conversación de venta genérica."}${profileNote}${diffNote}${presetBlock}${scBlock}${windowNote}

Tu papel es la otra parte. Mantén tu personalidad de forma consistente. Responde con 1-3 frases conversacionales naturales. Usa **negrita** para marcar objeciones clave, precios, plazos o compromisos importantes. Sin más etiquetas ni metacomentarios.
${langRule}`;
  } else {
    const profileNote = sellerProfile && SELLER_PROFILE_DESC[sellerProfile]
      ? `\nPERSONALIDAD: ${SELLER_PROFILE_DESC[sellerProfile]}`
      : "";

    // Build restrictions list (without block wrapper — used in both top and bottom)
    const restrictionsList = sellerNotes && sellerNotes.length > 0
      ? sellerNotes.map((n, i) => `${i + 1}. ${n}`).join("\n")
      : "";

    // Verified context data block — limits the seller to numbers that are actually in context
    const verifiedDataBlock = buildVerifiedDataBlock(context, lang);

    // Grounding + phase block — anchors seller identity and call phase from context
    const groundingPhaseBlock = buildGroundingAndPhaseBlock(context, lang);
    const groundingInject = groundingPhaseBlock ? `\n\n${groundingPhaseBlock}` : "";

    // Objection-first policy — enforces resolve-before-close sequence
    const objectionFirstBlock = buildObjectionFirstPolicy(lang);
    const falseDichotomyBlock  = buildFalseDichotomyGuard(lang);
    const antiDisqualBlock     = buildAntiPrematureDisqualification(lang);
    const concreteCompBlock    = buildConcreteComparisonEngine(lang);

    // Detect sellerNote intent for conditional blocks
    const noteText = (sellerNotes ?? []).join(" ").toLowerCase();
    const noPoliticianMode = /polit|consult|bland[ao]|suave|soft/i.test(noteText);
    const holdFrameMode    = /dejes ir|dejes al cliente|no.*ir|let.*go|hold|retener/i.test(noteText);

    // Conditional: NO POLITICIAN MODE block
    const noPoliticianBlock = noPoliticianMode
      ? `\nMODO SIN POLÍTICO — ACTIVO:
Detectada restricción de tono político/consultivo. Aplica sin excepción:
— Frases cortas. Si supera 15 palabras, córtala.
— PROHIBIDO: "entiendo perfectamente", "es totalmente válido", "la decisión final depende de ti", "no estoy aquí para convencerte", "explora lo que prefieras".
— PROHIBIDO: validaciones blandas repetitivas, preguntas suaves con objeción central viva.
— Formato de respuesta: 1) golpe de criterio directo → 2) explicación en 1 frase → 3) remate que obliga a elegir marco.
— Ejemplo: "No. Estás comparando caja mensual con rentabilidad total. Berlín te suena más segura porque la entiendes, no porque esté mejor comprada. La pregunta no es dónde cobras 100€ hoy; es dónde construyes más patrimonio con menos capital inmovilizado."\n`
      : "";

    // Conditional: HOLD THE FRAME enforcement block
    const holdFrameBlock = holdFrameMode
      ? `\nMODO RETENCIÓN DE MARCO — ACTIVO:
Detectada restricción de no dejar ir al cliente. Aplica sin excepción:
— Si el cliente trae una alternativa, activa SOSTENIMIENTO_DE_MARCO del motor táctico. Completa el ciclo completo antes de cualquier cesión.
— PROHIBIDO: "si prefieres X", "parece que X encaja mejor para ti", "la decisión es tuya", "si no te convence lo dejamos aquí".
— Si el cliente intenta salir de la conversación sin decisión, detecta el freno real y vuelve al umbral. No aceptes "lo pienso y te digo" sin fecha ni paso concreto.\n`
      : "";

    // TOP BLOCK — ⚠️ absolute restrictions, placed first for maximum primacy weight
    const topRestrictionsBlock = restrictionsList
      ? `⚠️ RESTRICCIONES ABSOLUTAS DEL VENDEDOR — SE APLICAN SIEMPRE.
Estas instrucciones anulan cualquier otra consideración.
Violarlas es un error crítico aunque el cliente las pida.

${restrictionsList}
${noPoliticianBlock}${holdFrameBlock}
VERIFICACIÓN OBLIGATORIA antes de escribir cada respuesta:
¿Tu respuesta contradice alguna restricción de la lista anterior?
Si es así → reescríbela hasta que no la contradiga. No hay excepciones.

`
      : "";

    // BOTTOM REMINDER — placed right before langRule for recency weight
    const bottomRestrictionsReminder = restrictionsList
      ? `\n⚠️ RESTRICCIONES ACTIVAS — SIGUEN VIGENTES EN ESTE TURNO:
${restrictionsList}
No las ignores. No las elijas parcialmente. No hay excepciones.`
      : "";

    return `${topRestrictionsBlock}Eres el vendedor en una simulación de venta. Actúas como un comercial experimentado: preciso, honesto y sin relleno.

Contexto: ${context || "Conversación de venta genérica."}${profileNote}${presetBlock}${scBlock}${windowNote}${verifiedDataBlock}${groundingInject}

REGLA DE PORTAFOLIO:
Solo puedes ofrecer productos, propiedades o condiciones que estén explícitamente mencionadas en el contexto de sesión o en tus restricciones activas.
Si el cliente pide algo que no tienes (otro producto, otra ciudad, cashflow positivo cuando no lo hay en el contexto), NO lo inventes ni lo prometas.
Reconoce que no lo tienes y trabaja con lo que sí tienes.

DOCTRINA DE VENTA (fuente de verdad compartida):
${MASTER_SELLER_BRAIN[lang === "en" ? "en" : "es"]}

MODO: EJECUTOR
No eres un observador. Eres el vendedor. Ejecutas esta doctrina en primera persona, en tiempo real, en cada mensaje.
Antes de escribir cada respuesta, declara internamente qué movimiento de la biblioteca estás usando.
No repitas el mismo movimiento dos turnos seguidos.
Prohibido "¿Te gustaría que...?" — formula preguntas directas y concretas.

${buildArenaSellerTacticalRules(lang)}

COHERENCIA CON EL CONTEXTO:
— No propongas cambiar variables que el contexto ya define como fijas (precio, alquiler, condiciones pactadas, etc.).
— Si ya has afirmado que algo es fijo, no lo vuelvas a proponer como palanca.
— Si el contexto no permite cerrar el gap con el umbral del cliente, reconócelo.

TERCERO DECISOR — CONDICIÓN PREVIA OBLIGATORIA:
Solo puedes iniciar la maniobra de tercero (incluir a pareja, socio, asesor) si se cumplen las DOS condiciones siguientes:
  1. La objeción técnica activa (renta, rentabilidad, precio, contrato) ya ha sido respondida directamente siguiendo la secuencia: nombrar cifra → separar confirmado/inferido/pendiente → medir residuo.
  2. El cliente NO tiene ningún bloqueo técnico todavía sin cerrar.
Si hay objeción técnica activa: PROHIBIDO llevar la conversación al tercero. El tercero es una maniobra de cierre, no una evasión de la objeción.
Si se cumplen las condiciones:
— Propón una de estas dos acciones: (a) incluir al tercero en la próxima conversación, o (b) cerrar un microcompromiso antes de que todo se enfríe.
— "Lo hablo y te digo" sin fecha ni siguiente paso concreto = callejón sin salida. No lo aceptes como cierre de turno.

COMPROMISO CON EL PRODUCTO:
— Solo descarta la operación si el gap es objetivamente incerrable y ya lo verificaste con datos concretos del contexto.
— Si hay ángulos sin explorar, explóralos antes de concluir que no hay encaje.

${objectionFirstBlock}

${falseDichotomyBlock}

${antiDisqualBlock}

${concreteCompBlock}

PROHIBICIÓN DE DATOS INVENTADOS — REGLA DURA:
— NUNCA cites porcentajes de revalorización futuros, comparativas históricas ni cifras de mercado si no están en los DATOS VERIFICADOS DEL CONTEXTO o si el cliente no las mencionó explícitamente.
— NUNCA construyas un ejemplo numérico comparativo (ej. "en Berlín renta X% vs aquí Y%") si no tienes esas cifras en el contexto verificado.
— Si te falta un dato, dilo así: "con lo que has compartido, no tengo esa cifra para comparar" o "sin datos comparables no te voy a vender esa conclusión".
— Esta regla tiene prioridad sobre cualquier impulso de argumentar. El silencio honesto gana más credibilidad que el número inventado.

COMPETIDOR APARENTEMENTE SUPERIOR — protocolo cuando el rival parece ganar en todos los criterios declarados:
Si el cliente presenta una alternativa que, según sus propias palabras, gana en cashflow, revalorización, gestión y ubicación, el vendedor NO puede seguir fingiendo superioridad sin evidencia.
Elige UNO de estos dos caminos:
A) Identifica el único supuesto crítico no verificado del rival (ej. ocupación garantizada, coste oculto, riesgo de divisa) y centra la respuesta en ese punto exclusivamente. Una pregunta de verificación muy concreta.
B) Admite con honestidad: "Si esos datos son reales y tus criterios son X e Y, la propuesta rival parece mejor para lo que buscas. Lo que no sé es si [supuesto no verificado]."
PROHIBIDO: seguir comparando con genéricos cuando el cliente ya enumeró criterios concretos y el rival los satisface según lo dicho.

NO AUTOGOL COMPARATIVO — regla de coherencia interna:
Si tu propio ejemplo o comparación deja claramente mejor a la alternativa rival:
— No intentes vender lo propio inmediatamente después sin cambiar el marco.
— Reconoce el dato, luego cambia a: descalificación honesta del supuesto, verificación de riesgo, o recomendación realista.
— Prohibido: usar un ejemplo que favorece al rival y luego concluir que la opción propia es mejor sin explicar por qué los datos no cierran lo que parece.

SALIDA HONESTA — cuando no hay fit real:
Si por los criterios explícitos del cliente la propuesta no encaja, puedes decirlo. De forma profesional:
— "Con lo que me has dicho, no te voy a recomendar avanzar con esto. No encaja en [criterio X]."
— Luego ofrece uno de: revisar un supuesto del rival, redefinir el criterio, o cerrar con recomendación de no seguir.
— Un vendedor que cierra con honestidad cuando no hay fit construye más credibilidad que uno que sigue empujando sin datos.

CONCISIÓN Y FOCO TÁCTICO — REGLAS DURAS (aplican SIEMPRE en modo client):
— TURNO NORMAL: máximo 2 frases totales. Sin excepciones salvo objeción técnica compleja.
— OBJECIÓN TÉCNICA COMPLEJA: máximo 3 frases.
— Nunca más de 1 pregunta por turno. Elige la más útil.
— Nunca más de 1 idea principal por turno. Si tienes dos, elige la más importante.
— PROHIBIDO: tono enciclopédico, docente o de mini-artículo.
— PROHIBIDO: contexto histórico, teoría, storytelling o comparativas si el comprador no lo pidió explícitamente.
— PROHIBIDO: listas largas (máx 2 ítems por respuesta). No rellenes con narrativa aspiracional.

PRIORIDAD TÁCTICA — ANTES DE CUALQUIER EXPLICACIÓN:
Si el comprador NO ha definido aún criterio de decisión, umbral de precio o condición de avance:
→ PRIORIZA "Diagnosticar con pregunta concreta". No lances una explicación larga sin ese dato.
Si el comprador expresa una preferencia clara:
→ 1 frase de respuesta + 1 pregunta de criterio o umbral. No más.

COMPRADOR ANALÍTICO — formato preferido cuando el perfil sea analítico o haga preguntas técnicas:
(1) Conclusión concreta en 1 frase → (2) Criterio o umbral relevante en 1 frase → (3) Pregunta directa.
Si faltan cifras reales, di qué falta en 1 frase y pregunta qué umbral necesita para decidir. NUNCA inventes números.

DISCIPLINA DE PREGUNTAS — REGLA DOCTRINAL:
Preguntar no es movimiento por defecto. Preguntar en exceso rompe el rapport y bloquea el avance.
— NO hagas pregunta si el cliente ya dio suficiente contexto en este turno.
— NO hagas pregunta si el cliente acaba de pedir explicación, claridad o un ejemplo.
— NO hagas pregunta si el cliente expresa frustración con las preguntas ("basta", "siempre preguntas", etc.).
— NO repitas con otras palabras una pregunta de criterio o prioridad que ya hiciste antes en la misma sesión.
— NO uses como cierre de turno: "¿qué prefieres?", "¿qué valoras más?", "¿qué es más importante para ti?" si ya hiciste alguna variación antes.
— SÍ haz pregunta cuando: no tienes el criterio de decisión del cliente y sin él no puedes avanzar; o cuando hay un fork real entre dos opciones y el cliente necesita elegir.
— Una pregunta por turno como máximo. Si no hay razón táctica concreta para preguntar → haz un statement.

MODO EXPLICACIÓN CLARA — actívalo cuando el cliente pida claridad o exprese frustración:
(1) Una explicación directa en 1-2 frases. Sin jerga. Sin abstracciones no concretadas.
(2) Un ejemplo comparativo concreto si aplica.
(3) CERO preguntas al final de esa respuesta.
Prohibido usar en este modo: "mercado estable", "crecimiento patrimonial", "menor volatilidad" si no los acompañas de cifras reales.

COMPARACIÓN COMPETITIVA — cuando el cliente traiga una alternativa concreta:
Nunca respondas con otra pregunta abierta de priorización.
Usa este formato:
(1) Reconoce el criterio real del cliente en 1 frase concreta.
(2) Compara en 2-3 ejes concretos. Sé honesto: si la alternativa gana en algún eje, dilo.
(3) Solo haz pregunta si sirve para decidir entre criterios reales distintos de los ya explorados.
Prohibido cuando ya hiciste variación de esa pregunta: "¿qué prefieres?", "¿qué valoras más?", "¿qué es más importante para ti?"

FORMATO:
— Separa con una línea en blanco la idea principal, la aclaración y la pregunta. No las pegues en un bloque corrido.
— Si hay 2 o 3 opciones o condiciones, ponlas en lista con guión: "- **Opción:** descripción breve"
— Frases cortas. Si la frase supera 20 palabras, córtala.
— No uses listas por sistema. Solo cuando enumeres opciones reales.
— Si el mensaje contiene una pregunta, escríbela ENTERA en negrita: **¿texto completo de la pregunta?**
— La pregunta final siempre en su propio párrafo (línea en blanco antes). Nunca pegada al final de un bloque corrido.

TONO: conversacional, claro, creíble. Como una persona, no como un chatbot.
Usa **negrita** para cifras, condiciones clave, conclusiones directas y cualquier término que el lector deba captar de un vistazo. Úsala con criterio — no en cada frase, pero sí donde aporte claridad.
Sin etiquetas ni metacomentarios.${bottomRestrictionsReminder}${cadenceNote}${objectionNote}
${langRule}`;
  }
}

function buildOpeningPrompt(
  role: ArenaRole,
  context: string,
  lang: Lang,
  clientProfile?: string,
  sellerProfile?: string,
  randomPreset?: string,
  sellerNotes?: string[],
): string {
  const langRule = lang === "en" ? "Write in English." : "Escribe en español.";
  const profileHint = role === "seller" && clientProfile && CLIENT_PROFILE_DESC[clientProfile]
    ? ` Personalidad: ${CLIENT_PROFILE_DESC[clientProfile]}`
    : role === "client" && sellerProfile && SELLER_PROFILE_DESC[sellerProfile]
    ? ` Personalidad: ${SELLER_PROFILE_DESC[sellerProfile]}`
    : "";

  const presetHint = randomPreset && PRESET_SYSTEM_DESC[randomPreset]
    ? ` [${PRESET_SYSTEM_DESC[randomPreset][lang === "en" ? "en" : "es"].split("\n")[0]}]`
    : "";

  // Portfolio constraint for seller opening: don't ask about things you can't offer
  const portfolioConstraint = role === "client" && sellerNotes && sellerNotes.length > 0
    ? (lang === "en"
        ? ` ABSOLUTE RESTRICTIONS ACTIVE — your opening must not contradict them: ${sellerNotes.map((n, i) => `${i + 1}. ${n}`).join("; ")}. Do not ask or offer anything that contradicts these restrictions.`
        : ` RESTRICCIONES ABSOLUTAS ACTIVAS — tu apertura no puede contradecirlas: ${sellerNotes.map((n, i) => `${i + 1}. ${n}`).join("; ")}. No preguntes ni ofrezcas nada que las contradiga.`)
    : "";

  const who = role === "seller" ? "cliente/prospecto" : "vendedor experto";
  const whoEn = role === "seller" ? "client/prospect" : "expert seller";

  // Extract seller identity from context — use it verbatim if found, invent otherwise
  const ctxGrounding = extractContextGrounding(context || "");
  const identityInstruction = ctxGrounding.identityFound
    ? ((): string => {
        const nameStr = [ctxGrounding.sellerName, ctxGrounding.sellerCompany].filter(Boolean).join(" de ");
        return lang === "en"
          ? `Your identity is already in the context: ${nameStr}. Use it verbatim — do NOT invent a different name or company.`
          : `Tu identidad ya está en el contexto: ${nameStr}. Úsala textualmente — PROHIBIDO inventarte otro nombre o empresa.`;
      })()
    : (lang === "en"
        ? `Invent a specific real-sounding name and company for yourself (e.g. "I'm Sara Voss from Clearpath Advisory" — no placeholders, no brackets).`
        : `Invéntate un nombre y empresa reales y concretos (ej: "Soy Marcos Reina de Solvinova" — sin corchetes, sin variables).`);

  if (lang === "en") {
    if (role === "client") {
      return `You are an expert seller opening a sales conversation. Context: ${context || "generic sale"}${profileHint}${presetHint}${portfolioConstraint}. ${identityInstruction} Write EXACTLY ONE sentence. Do what a top-tier seller would genuinely do to open: a precise observation, a direct reference to the prospect's situation, a short hook, or a well-placed question — vary the approach, never explain the product. Use **bold** on the most important word or number if relevant. No labels. Text only. ${langRule}`;
    }
    return `Generate the opening message of a ${whoEn} starting a sales conversation. Context: ${context || "generic sale"}${profileHint}${presetHint}. Write 1 short natural sentence as that person. No labels. Text only. ${langRule}`;
  }
  if (role === "client") {
    return `Eres un vendedor experto que abre una conversación de ventas. Contexto: ${context || "venta genérica"}${profileHint}${presetHint}${portfolioConstraint}. ${identityInstruction} Escribe EXACTAMENTE UNA frase. Haz lo que haría un vendedor de primer nivel: puede ser una observación directa, una referencia al problema del prospecto, un gancho potente, o una pregunta bien colocada — varía el enfoque, nunca expliques el producto. Usa **negrita** en la palabra o cifra más importante si aporta. Sin etiquetas. Solo el texto. ${langRule}`;
  }
  return `Genera el primer mensaje de un ${who} que inicia una conversación de venta. Contexto: ${context || "venta genérica"}${profileHint}${presetHint}. Escribe 1 frase corta y natural como esa persona. Sin etiquetas. Solo el texto. ${langRule}`;
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

  const profileLine = lang === "es"
    ? (clientProfile && DEBRIEF_CLIENT_PROFILE[clientProfile]
        ? DEBRIEF_CLIENT_PROFILE[clientProfile].es
        : "No especificado.")
    : (clientProfile && DEBRIEF_CLIENT_PROFILE[clientProfile]
        ? DEBRIEF_CLIENT_PROFILE[clientProfile].en
        : "Not specified.");

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
3. PENALIZACIONES GRAVES (−2 a −3 c/u — marcar explícitamente en critique): vendedor cede el marco ("sí, X parece mejor", "la decisión es tuya", "si prefieres X") sin completar el ciclo de reencuadre · vendedor valida que la alternativa rival es superior · vendedor construye ejemplo numérico que favorece claramente a la alternativa rival · tono político/consultivo con validaciones vacías repetitivas ("entiendo perfectamente", "totalmente válido") con objeción central viva · cierre propuesto con objeción principal activa · respuesta genérica ("patrimonio a largo plazo", "seguridad", "futuro") a objeción concreta de renta/rentabilidad sin abordar la matemática citada por el cliente · falsa dicotomía ("¿seguridad o rentabilidad?") cuando el cliente ya había aceptado uno de esos marcos y nombrado un bloqueo específico diferente · descalificación prematura del activo ("sigamos buscando", "puede no ser lo tuyo") sin haber respondido la objeción, aislado el criterio dominante y medido si el gap es cerrable · discordancia de tipo de rentabilidad sin puente explícito: el cliente preguntaba por la renta del contrato (TIPO 1: lo que paga el inquilino) y el vendedor respondió con retorno sobre capital (TIPO 5: ROE/financiación/apalancamiento) sin decir explícitamente "te paso de la renta del contrato al retorno sobre tu capital aportado — te explico la diferencia".
4. PENALIZACIONES MENORES (−1 a −2 c/u): vendedor propone reunión/llamada/cierre antes de resolver la objeción principal · siguiente paso queda ambiguo o sin acción/fecha concreta · vendedor repite la misma estructura de respuesta sin adaptarse.
5. SENSIBILIDAD AL PERFIL: aplica el criterio del perfil indicado arriba para juzgar si el vendedor respondió correctamente.
6. Referencias: closed vs cliente difícil → mín 8; lost/broken → máx 5; next_step buena ejecución → hasta 8; next_step ejecución débil → 5–6. Con fallo grave → máx 5 independientemente del outcome.

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
3. GRAVE PENALTIES (−2 to −3 each — call out explicitly in critique): seller cedes the frame ("yes, X seems better", "the decision is yours", "if you prefer X") without completing the reframe cycle · seller validates that the rival alternative is superior · seller builds a numerical example that clearly favors the rival alternative · consultive/political tone with repeated empty validations ("I completely understand", "totally valid") with the central objection still alive · close proposed with the main objection still active · generic abstraction ("long-term wealth", "safety", "patrimony") in response to a concrete rent/yield/price objection without first addressing the specific math the client cited · false dichotomy ("safety or returns?") when the client had already explicitly accepted one of those frames and named a different specific blocker · premature asset disqualification ("let's keep looking", "this may not be for you") without first completing the response-isolate-measure sequence · yield type mismatch without explicit bridge: the client was asking about contract rent (TYPE 1: what the tenant pays) and the seller responded with return on equity (TYPE 5: ROE/leverage/financing) without explicitly saying "I'm moving from the contract rent to your return on invested capital — let me explain the difference".
4. MINOR PENALTIES (−1 to −2 each): seller proposes meeting/call/close before resolving main objection · next step is ambiguous or lacks a concrete action/date · seller repeats the same response structure without adapting.
5. PROFILE SENSITIVITY: apply the buyer profile criterion above to judge whether the seller responded correctly.
6. Score references: closed vs tough client → min 8; lost/broken → max 5; next_step good execution → up to 8; next_step weak execution → 5–6. With a grave failure → max 5 regardless of outcome.

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

Definiciones ESTRICTAS — ante cualquier duda responde none:
none = conversación abierta, en proceso, ambigua, o el cliente pide más información
closed = cliente cerró EXPLÍCITAMENTE: dijo que compra, confirmó cuándo firma, preguntó cómo pagar
next_step = cliente COMPROMETIÓ un paso concreto (fecha de reunión confirmada, pidió contrato/propuesta enviada, confirmó disponibilidad para llamada en fecha concreta)
lost = cliente rechazó DEFINITIVAMENTE, sin vuelta atrás, con cierre explícito
broken = ruptura total, cliente cortó la conversación

PROHIBIDO responder next_step si:
— El cliente pide datos, ejemplos, cifras, comparativas o más información ("¿puedo tener ejemplos?", "necesito datos claros", "¿cómo ha crecido?")
— El cliente usa frases ambiguas: "puede ser", "lo pensaré", "me lo tengo que plantear", "quiero reflexionarlo"
— El cliente expresa interés pero NO ha confirmado ninguna acción concreta con fecha o entregable
— La conversación sigue con preguntas activas por ninguna de las dos partes
— La última frase del cliente es una pregunta o una petición de más información

Conversación:
${recent}

Responde solo con la palabra:`
    : `Analyze this sales conversation and determine if it has reached a CLEAR AND UNAMBIGUOUS terminal state.
Reply with ONLY one word:
none | closed | next_step | lost | broken

STRICT definitions — when in doubt, always reply none:
none = still open, in progress, ambiguous, or client is requesting more information
closed = client explicitly closed: said they'll buy, confirmed when to sign, asked how to pay
next_step = client COMMITTED to a concrete action (confirmed meeting date, requested contract/proposal to be sent, confirmed specific call availability with a date)
lost = client DEFINITIVELY rejected with explicit closure, no turning back
broken = total breakdown, client cut off the conversation

FORBIDDEN to reply next_step if:
— Client requests data, examples, figures, comparisons, or more information ("can I have examples?", "I need clear data", "how has it grown?")
— Client uses ambiguous phrases: "maybe", "I'll think about it", "I need to reflect", "could be"
— Client shows interest but has NOT confirmed any concrete action with a date or deliverable
— The conversation still has active questions from either side
— The client's last line is a question or a request for more information

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

// ── POST /api/arena/preset-context ───────────────────────────────────────────
// Generates a fresh, AI-invented scenario for a given preset + role + lang.
router.post("/arena/preset-context", async (req, res) => {
  const { preset, role, lang = "es" } = req.body as {
    preset?: string;
    role?: ArenaRole;
    lang?: Lang;
  };

  if (!preset || !PRESET_SYSTEM_DESC[preset]) {
    res.status(400).json({ error: "Invalid preset" });
    return;
  }
  if (!role || !["seller", "client"].includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const presetDesc = PRESET_SYSTEM_DESC[preset][lang === "en" ? "en" : "es"];

  const isSeller = role === "seller";

  const challengeExtra = preset === "challenge"
    ? (lang === "en"
        ? isSeller
          ? "\n\nCRITICAL CONSTRAINT: The scenario MUST be absurd — the client clearly does NOT need what's being sold. No normal sales scenarios. The key is precision: use specific numbers, locations, or facts that make the absurdity funny and credible (e.g. 'I have to sell a top-tier umbrella. The client lives in the Atacama desert — last year it rained 0.3mm total.' or 'I need to sell a pool heater to a penguin researcher stationed in Antarctica.'). Vary the product AND client profile wildly each time. BANNED tropes: coat in tropical city, sunscreen to vampire, GPS to monk. Overused — invent something fresh."
          : "\n\nCRITICAL CONSTRAINT: The scenario MUST be absurd — you clearly do NOT need what's being sold. No normal sales scenarios. The key is precision: use specific numbers, locations, or facts that make the absurdity funny and credible (e.g. 'Someone is trying to sell me a top-tier umbrella. I live in the Atacama desert — last year it rained 0.3mm total.' or 'A salesperson is trying to sell me a pool heater. I'm a penguin researcher in Antarctica.'). Vary the product AND your profile wildly each time. BANNED tropes: coat in tropical city, sunscreen to vampire, GPS to monk. Overused — invent something fresh."
        : isSeller
          ? "\n\nRESTRICCIÓN CRÍTICA: El escenario DEBE ser absurdo — el cliente claramente NO necesita lo que le vas a vender. No se admiten ventas normales. La clave es la precisión: usa datos concretos, cifras o hechos específicos que hagan el absurdo gracioso y creíble (ej: 'Tengo que vender un superparaguas. El cliente vive en el desierto de Atacama, lluvia total el año pasado: 0,3 mm.' o 'Tengo que convencer a un investigador de pingüinos en la Antártida de que compre un calefactor de piscina.'). Varía el producto Y el perfil del cliente radicalmente. TROPOS PROHIBIDOS: abrigo en ciudad tropical, protector solar a vampiro, GPS a monje. Sobreutilizados — inventa algo fresco."
          : "\n\nRESTRICCIÓN CRÍTICA: El escenario DEBE ser absurdo — tú claramente NO necesitas lo que te están vendiendo. No se admiten ventas normales. La clave es la precisión: usa datos concretos, cifras o hechos específicos que hagan el absurdo gracioso y creíble (ej: 'Me están intentando vender un superparaguas. Vivo en el desierto de Atacama, lluvia total el año pasado: 0,3 mm.' o 'Un vendedor quiere venderme un calefactor de piscina. Soy investigador de pingüinos en la Antártida.'). Varía el producto Y tu perfil radicalmente. TROPOS PROHIBIDOS: abrigo en ciudad tropical, protector solar a vampiro, GPS a monje. Sobreutilizados — inventa algo fresco.")
    : "";

  const isImmvest = preset === "immvest";

  const prompt = lang === "en"
    ? isImmvest
      ? isSeller
        ? `Generate ONE Immvest sales simulation scenario (2–3 sentences) written from the SELLER's perspective (first person as seller).

Rules:
${presetDesc}

Write as the seller: "I need to sell to...", "My prospect is...", "The client is X, who has Y capital and...". Invent concrete details: buyer profile (profession, age, capital, main objection, conversation stage). Vary every time.

Return ONLY the scenario text. No labels, no quotes.`
        : `Generate ONE Immvest sales simulation scenario (2–3 sentences) written from the BUYER/CLIENT's perspective (first person as client).

Rules:
${presetDesc}

Write as the client: "A salesperson is trying to get me to invest in...", "I'm being approached about...", "I have X capital and someone wants me to...". Invent concrete details about yourself (profession, capital, main concern, stage). Vary every time.

Return ONLY the scenario text. No labels, no quotes.`
      : isSeller
        ? `Generate ONE punchy sales scenario (1–2 short sentences) from the SELLER's perspective. No fluff.

Rules:
${presetDesc}${challengeExtra}

First person as seller: "I have to sell X to Y, who...", "My prospect is...". Be inventive. Vary every time.
Return ONLY the scenario text. No labels, no quotes.`
        : `Generate ONE punchy sales scenario (1–2 short sentences) from the BUYER/CLIENT's perspective. No fluff.

Rules:
${presetDesc}${challengeExtra}

First person as client: "Someone is trying to sell me X...", "I'm being offered Y...". Be inventive. Vary every time.
Return ONLY the scenario text. No labels, no quotes.`
    : isImmvest
      ? isSeller
        ? `Genera UN escenario de simulación de venta con Immvest (2-3 frases) en primera persona como VENDEDOR.

Reglas:
${presetDesc}

Escribe como el vendedor: "Tengo que vender a...", "Mi prospecto es...", "El cliente es X, tiene Y de capital y...". Inventa detalles concretos: perfil del comprador (profesión, edad, capital, objeción principal, fase de la conversación). Varía cada vez.

Devuelve SOLO el texto. Sin etiquetas, sin comillas.`
        : `Genera UN escenario de simulación de venta con Immvest (2-3 frases) en primera persona como CLIENTE/COMPRADOR.

Reglas:
${presetDesc}

Escribe como el cliente: "Me están intentando convencer de invertir en...", "Un vendedor me propone...", "Tengo X de capital y alguien quiere que...". Inventa detalles concretos sobre ti mismo (profesión, capital, preocupación principal, fase). Varía cada vez.

Devuelve SOLO el texto. Sin etiquetas, sin comillas.`
      : isSeller
        ? `Genera UN escenario de venta corto (1-2 frases) en primera persona como VENDEDOR. Sin relleno.

Reglas:
${presetDesc}${challengeExtra}

Primera persona como vendedor: "Tengo que vender X a Y, que...", "Mi prospecto es...". Sé inventivo. Varía cada vez.
Devuelve SOLO el texto. Sin etiquetas, sin comillas.`
        : `Genera UN escenario de venta corto (1-2 frases) en primera persona como CLIENTE. Sin relleno.

Reglas:
${presetDesc}${challengeExtra}

Primera persona como cliente: "Me están intentando vender X...", "Un vendedor me ofrece Y...". Sé inventivo. Varía cada vez.
Devuelve SOLO el texto. Sin etiquetas, sin comillas.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: isImmvest ? 120 : 65,
      temperature: 0.95,
      messages: [{ role: "user", content: prompt }],
    });
    const context = completion.choices[0]?.message?.content?.trim() ?? "";
    res.json({ context });
  } catch {
    res.status(500).json({ error: "Generation failed" });
  }
});

// ── POST /api/arena/adapt-context ────────────────────────────────────────────
// Rewrites an existing context text to match a different role perspective.
// Used when the user switches role (seller ↔ client) with text already written.
router.post("/arena/adapt-context", async (req, res) => {
  const { text, fromRole, toRole, lang = "es" } = req.body as {
    text?: string;
    fromRole?: ArenaRole;
    toRole?: ArenaRole;
    lang?: Lang;
  };

  if (!text?.trim()) { res.status(400).json({ error: "text required" }); return; }
  if (!fromRole || !toRole || fromRole === toRole) { res.status(400).json({ error: "Invalid roles" }); return; }

  const prompt = lang === "en"
    ? fromRole === "seller"
      ? `Rewrite this sales scenario from the BUYER/CLIENT's first-person perspective. Keep every concrete detail (product, numbers, names, location). Only change who is speaking: the user is now the client, not the seller.\n\nOriginal (seller POV): ${text.trim()}\n\nRewrite (client POV, same length). Return ONLY the rewritten text, no quotes, no labels.`
      : `Rewrite this sales scenario from the SELLER's first-person perspective. Keep every concrete detail (product, numbers, names, location). Only change who is speaking: the user is now the seller, not the client.\n\nOriginal (client POV): ${text.trim()}\n\nRewrite (seller POV, same length). Return ONLY the rewritten text, no quotes, no labels.`
    : fromRole === "seller"
      ? `Reescribe este escenario de venta en primera persona como CLIENTE. Mantén todos los detalles concretos exactamente iguales (producto, cifras, nombres, lugar). Solo cambia quién habla: ahora el usuario es el cliente, no el vendedor.\n\nOriginal (perspectiva vendedor): ${text.trim()}\n\nReescritura (perspectiva cliente, misma longitud). Devuelve SOLO el texto, sin comillas, sin etiquetas.`
      : `Reescribe este escenario de venta en primera persona como VENDEDOR. Mantén todos los detalles concretos exactamente iguales (producto, cifras, nombres, lugar). Solo cambia quién habla: ahora el usuario es el vendedor, no el cliente.\n\nOriginal (perspectiva cliente): ${text.trim()}\n\nReescritura (perspectiva vendedor, misma longitud). Devuelve SOLO el texto, sin comillas, sin etiquetas.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    const context = completion.choices[0]?.message?.content?.trim() ?? text.trim();
    res.json({ context });
  } catch {
    res.json({ context: text.trim() });
  }
});

// ── POST /api/arena/start ─────────────────────────────────────────────────────
router.post("/arena/start", async (req, res) => {
  const { role, lang = "es", context = "", clientProfile, sellerProfile, difficulty, forceTerminal, randomPreset, arenaStructuredContext } = req.body as {
    role?: ArenaRole;
    lang?: Lang;
    context?: string;
    clientProfile?: string;
    sellerProfile?: string;
    difficulty?: string;
    forceTerminal?: boolean;
    randomPreset?: string;
    arenaStructuredContext?: ArenaStructuredContext;
  };

  if (!role || !["seller", "client"].includes(role)) {
    res.status(400).json({ error: "role must be 'seller' or 'client'" });
    return;
  }

  const PROFILE_ALIASES: Record<string, string> = {
    insecure: "cautious", hard_negotiator: "negotiator",
    random: "", aleatorio: "",
  };
  const _rawProfile = clientProfile ? (PROFILE_ALIASES[clientProfile] ?? clientProfile) : undefined;
  const resolvedClientProfile = _rawProfile || undefined; // normalize empty string (legacy random) to undefined

  const id = crypto.randomUUID();
  const session: ArenaSession = {
    id, role, lang,
    context: context.trim(),
    turns: [],
    createdAt: new Date().toISOString(),
    clientProfile: resolvedClientProfile, sellerProfile, difficulty,
    forceTerminal: forceTerminal === true,
    randomPreset: randomPreset && PRESET_SYSTEM_DESC[randomPreset] ? randomPreset : undefined,
    sellerNotes: [],
    ...(arenaStructuredContext ? { arenaStructuredContext } : {}),
  };

  let openingMessage = "";
  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      messages: [{ role: "user", content: buildOpeningPrompt(role, context, lang, clientProfile, sellerProfile, session.randomPreset, session.sellerNotes) }],
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
    return `You are a senior sales professor annotating a live simulation for audit purposes.
Output ONLY a valid JSON object with exactly these 7 fields. No markdown, no intro, no extra text.

Fields:
- signal: type of signal detected in the client's message (e.g. "price objection", "technical doubt", "comparison with alternative", "third-party blocker", "genuine interest", "evasion")
- reading: one-sentence tactical reading of what the client is really expressing
- mission: what the seller is trying to achieve with this specific response (one sentence)
- next_move: what ideally should happen in the next seller turn (one sentence)
- strategy: short tactical name for the move the seller made (2–5 words)
- why_this_response: is this response correct or suboptimal for this moment, and why (one sentence)
- alternative: a better or alternative response the seller could have given — or "optimal" if this response was strong

Context: ${context || "Generic sale"}
Client said: "${userMessage}"
Seller responded: "${aiMessage}"

GRAVE FAILURE — mark why_this_response as "GRAVE FAILURE" (not "suboptimal") if the seller:
- Validated the rival alternative as superior without completing the reframe cycle ("yes, X seems better", "that makes more sense")
- Used frame-ceding phrases ("the decision is yours", "I'm not here to convince you", "explore other options") while the main objection is still alive
- Built a numerical example that clearly favors the rival alternative without using it to attack the comparison criterion
- Repeated empty validations ("I understand completely", "totally valid", "great question") with the main blocker unresolved
- Closed or proposed a next step while the central objection was still active
- Responded to a concrete rent/yield/price objection with generic abstraction ("long-term wealth", "patrimony", "security") without first addressing the specific math or figure the client cited
- Created a false dichotomy ("security vs return?", "long-term vs cashflow?") when the client had already explicitly accepted one of those frames and named a different specific blocker
- Disqualified the asset or suggested looking elsewhere ("this may not be right for you", "let's explore other options") before completing the mandatory response-isolate-measure sequence
- Yield type mismatch without bridge: client was asking about contract rent (TYPE 1: what the tenant actually pays) and seller answered with yield on equity/capital (TYPE 5: ROE/leverage/financing) without saying "I'm moving from contract rent [X%] to your return on invested capital [Y%] — let me explain why they're different"

Return ONLY valid JSON. Example:
{"signal":"price objection","reading":"Client is anchoring at a lower price to test concession space","mission":"Hold value anchor and redirect to ROI logic","next_move":"Isolate whether price is the only blocker or if there are others","strategy":"Value anchor hold","why_this_response":"Correct — seller avoids entering price negotiation before clarifying value","alternative":"optimal"}`;
  }
  return `Eres un profesor de ventas sénior anotando una simulación en directo para auditoría.
Devuelve SOLO un objeto JSON válido con exactamente estos 7 campos. Sin markdown, sin introducción, sin texto extra.

Campos:
- signal: tipo de señal detectada en el mensaje del cliente (ej: "objeción de precio", "duda técnica", "comparación con alternativa", "tercero decisor", "interés real", "evasión")
- reading: lectura táctica en una frase de lo que el cliente está expresando realmente
- mission: qué intenta conseguir el vendedor con esta respuesta concreta (una frase)
- next_move: qué debería pasar idealmente en el siguiente turno del vendedor (una frase)
- strategy: nombre corto de la táctica que usa el vendedor (2–5 palabras)
- why_this_response: ¿es esta respuesta correcta o subóptima para este momento, y por qué? (una frase)
- alternative: una respuesta mejor o alternativa que el vendedor podría haber dado — o "óptimo" si la respuesta fue sólida

Contexto: ${context || "Venta genérica"}
Cliente dijo: "${userMessage}"
Vendedor respondió: "${aiMessage}"

FALLO GRAVE — marca why_this_response como "FALLO GRAVE" (no "subóptimo") si el vendedor:
- Validó la alternativa rival como superior sin completar el ciclo de reencuadre ("sí, X parece mejor", "eso tiene más sentido para ti")
- Usó frases de cesión de marco ("la decisión es tuya", "no estoy aquí para convencerte", "explora otras opciones") con la objeción principal viva
- Construyó un ejemplo numérico que favorece claramente a la alternativa rival sin usarlo para atacar el criterio de comparación
- Repitió validaciones vacías ("entiendo perfectamente", "totalmente válido", "qué buena pregunta") con el bloqueo central sin resolver
- Cerró o propuso siguiente paso con la objeción central todavía activa
- Respondió a una objeción concreta de renta/rentabilidad/precio con abstracción genérica ("patrimonio a largo plazo", "seguridad patrimonial") sin abordar primero la matemática o cifra específica que citó el cliente
- Creó una falsa dicotomía ("¿seguridad o rentabilidad?", "¿largo plazo o cashflow?") cuando el cliente ya había aceptado explícitamente uno de esos marcos y nombrado un bloqueo específico diferente
- Descalificó el activo o sugirió buscar alternativas ("sigamos buscando", "puede que no sea para ti") sin completar la secuencia obligatoria responder-aislar-medir
- Discordancia de tipo de rentabilidad sin puente: el cliente preguntaba por la renta del contrato (TIPO 1: lo que paga realmente el inquilino) y el vendedor contestó con retorno sobre capital (TIPO 5: ROE/financiación/apalancamiento) sin decir "paso de la renta del contrato [X%] a tu retorno sobre capital aportado [Y%] — te explico la diferencia"

Devuelve SOLO JSON válido. Ejemplo:
{"signal":"objeción de precio","reading":"El cliente ancla en precio bajo para probar si hay margen de concesión","mission":"Sostener el ancla de valor y redirigir a la lógica de retorno","next_move":"Aislar si el precio es el único bloqueo o si hay otros","strategy":"Sostén de ancla de valor","why_this_response":"Correcto — el vendedor evita entrar en negociación de precio antes de clarificar valor","alternative":"óptimo"}`;
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
      max_tokens: 500,
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
        maxTokensConfigured: 500,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) return null;

    // Parse structured JSON fields
    let fields: CoachLiteFields | undefined;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.strategy) {
        fields = {
          signal: String(parsed.signal ?? ""),
          reading: String(parsed.reading ?? ""),
          mission: String(parsed.mission ?? ""),
          next_move: String(parsed.next_move ?? ""),
          strategy: String(parsed.strategy ?? ""),
          why_this_response: String(parsed.why_this_response ?? ""),
          alternative: String(parsed.alternative ?? ""),
        };
      }
    } catch {
      // JSON parse failed — fall back to using raw text as explanation
    }

    // Build display explanation string (keeps backward compat with CoachNote UI)
    const explanation = fields
      ? `**${fields.strategy}**\n- ${fields.mission}\n- ${fields.why_this_response}`
      : raw;

    return { explanation, ...(fields ? { fields } : {}) };
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

// ── Strip trailing question (frustration mode enforcement) ────────────────────
// When the client explicitly asked to stop getting questions, deterministically
// remove a trailing question from the AI response so the rule is honored even
// if the model ignores the system prompt instruction.
// Only removes the last question paragraph if the response has multiple paragraphs
// or multiple sentences — avoids gutting single-sentence responses.
function removeTrailingQuestion(text: string): string {
  const trimmed = text.trimEnd();
  // Split on blank-line paragraph boundaries
  const paragraphs = trimmed.split(/\n\s*\n/);
  if (paragraphs.length >= 2) {
    const lastPara = paragraphs[paragraphs.length - 1]!.trim();
    // If the last paragraph is purely a question (no declarative sentence)
    if (/\?[\s*»"']*$/.test(lastPara) && !/[.!][^?]*$/.test(lastPara)) {
      return paragraphs.slice(0, -1).join("\n\n").trimEnd();
    }
  }
  // Single paragraph — strip only if there is a sentence before the trailing question
  const lastQMatch = trimmed.match(/([.!]\s+|\n)(\*{0,2}¿[^?]*\?[*\s]*)$/);
  if (lastQMatch) {
    const cutAt = trimmed.lastIndexOf(lastQMatch[0]!);
    const before = trimmed.slice(0, cutAt + 1).trimEnd(); // keep sentence-ending punct
    if (before.length > 20) return before;
  }
  return trimmed;
}

// ── Client-mode response compaction ──────────────────────────────────────────
// Safety net: if the AI seller response exceeds CLIENT_MODE_MAX_SENTENCES,
// run a fast mini-prompt to compress it while preserving clarity and tone.
// This catches cases where the model ignores the conciseness rules in the system prompt.
const CLIENT_MODE_MAX_SENTENCES = 3;
// Journey is computed every N AI turns to reduce cost. CoachLite still runs every turn.
const JOURNEY_GATE_INTERVAL = 3;

async function compactIfNeeded(
  aiMessage: string,
  context: string,
  lang: Lang,
  sessionId: string,
): Promise<string> {
  if (countSentences(aiMessage) <= CLIENT_MODE_MAX_SENTENCES) return aiMessage;

  const prompt = lang === "en"
    ? `This seller response in a sales simulation is too long. Rewrite it in a maximum of ${CLIENT_MODE_MAX_SENTENCES} sentences. Preserve the single most important idea and the question if there is one. Keep a natural conversational tone — no robotic or telegraphic writing. No information loss on the key point. Return ONLY the rewritten response, no labels, no quotes.\n\nOriginal:\n${aiMessage}`
    : `Esta respuesta del vendedor en una simulación de venta es demasiado larga. Reescríbela en máximo ${CLIENT_MODE_MAX_SENTENCES} frases. Conserva la idea más importante y la pregunta si hay una. Tono conversacional natural — sin escritura robótica ni telegráfica. Sin perder el punto clave. Devuelve SOLO la respuesta reescrita, sin etiquetas, sin comillas.\n\nOriginal:\n${aiMessage}`;

  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/turn",
        endpoint: "compact",
        sessionId,
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
    const compacted = completion.choices[0]?.message?.content?.trim();
    // Only use compacted if it's non-empty and shorter than original
    return compacted && compacted.length > 10 && compacted.length < aiMessage.length
      ? compacted
      : aiMessage;
  } catch {
    return aiMessage; // Fallback: return original on any error
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

  // ── Cadence analysis (client mode only) — must run BEFORE user turn is pushed ──
  // analyzeQuestionCadence reads session.turns to detect patterns in AI's last messages
  // and the incoming user message. We call it here so the analysis reflects the true
  // last AI turn and the current user input before it's appended.
  const cadence = session.role === "client" ? analyzeQuestionCadence(session, effectiveUserMessage) : null;
  const cadenceNote = cadence ? buildCadenceNote(cadence, session.lang) : "";

  // ── Dominant technical objection injection (client mode only) ────────────
  // Computed BEFORE the user turn is appended so it reads the same state as cadence.
  // Appended at the very end of the system prompt for maximum recency weight.
  const objectionNote = buildDominantObjectionInjection(session, effectiveUserMessage, session.lang);

  // Log pre-response cadence events (what mode we're forcing BEFORE the AI responds)
  if (cadence) {
    if (cadence.clientTimePressed) {
      logCadenceEvent(arenaSessionId, "direct_mode");
    }
    if (cadence.clientFrustratedWithQuestions) {
      logCadenceEvent(arenaSessionId, "clarity_mode", "client_frustrated");
    } else if (cadence.clientWantsClarity) {
      logCadenceEvent(arenaSessionId, "clarity_mode", "client_wants_clarity");
    } else if (cadence.recentQuestionCount >= 2 || (cadence.lastAiHadQuestion && cadence.recentQuestionCount >= 1)) {
      logCadenceEvent(arenaSessionId, "statement_forced", `recent_q=${cadence.recentQuestionCount}`);
    }
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
        session.role, sanitizeArenaContext(session.context), session.lang,
        historyLen,
        session.clientProfile, session.sellerProfile, session.difficulty,
        session.sellerNotes, session.randomPreset, session.arenaStructuredContext,
        cadenceNote,
        objectionNote,
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
  const TURN_MODEL = "gpt-4o";
  try {
    // Client mode: AI is seller — cap at 220 (allows real context when needed, blocks walls of text)
    const turnMaxTokens = session.role === "client" ? 220 : 300;
    const completion = await openai.chat.completions.create({
      model: TURN_MODEL,
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
        model: TURN_MODEL,
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

  // Client mode: compact response if it exceeds the sentence limit.
  // This is a safety net on top of the conciseness rules in the system prompt.
  if (session.role === "client" && aiMessage) {
    aiMessage = await compactIfNeeded(aiMessage, session.context, session.lang, arenaSessionId);
  }

  // Strict no-question modes: strip any trailing question that survived system-prompt instructions.
  // Applied for: frustration (explicit stop-questions), clarity request, and time-pressed ("al grano").
  if (session.role === "client" && aiMessage && (
    cadence?.clientFrustratedWithQuestions ||
    cadence?.clientWantsClarity ||
    cadence?.clientTimePressed
  )) {
    aiMessage = removeTrailingQuestion(aiMessage);
  }

  session.turns.push({
    index: session.turns.length,
    timestamp: new Date().toISOString(),
    speaker: "ai",
    message: aiMessage,
  });

  // ── Post-response observability: log if the AI seller response ended in a question ──
  if (session.role === "client" && aiMessage && endsWithQuestion(aiMessage)) {
    logCadenceEvent(arenaSessionId, "ends_in_question");
  }

  // ── Journey gating: only run Journey every JOURNEY_GATE_INTERVAL AI turns ──
  // CoachLite runs every turn (high per-turn value). Journey changes slowly — no need
  // to recompute it on every single turn. Skip also on first turn (no data yet).
  const aiTurnCount = session.turns.filter(t => t.speaker === "ai").length;
  const shouldRunJourney = session.role === "client" &&
    aiTurnCount > 0 &&
    aiTurnCount % JOURNEY_GATE_INTERVAL === 0;
  if (session.role === "client" && !shouldRunJourney) {
    logCadenceEvent(arenaSessionId, "journey_gated", `ai_turn=${aiTurnCount}`);
  }

  // ── Run terminal detection + coachLite + journey in parallel ─────────────
  const [terminalSignal, coachLiteBase, journeyData] = await Promise.all([
    detectTerminalState(session.turns, session.role, session.lang, arenaSessionId, session.forceTerminal),
    session.role === "client"
      ? generateCoachLite(effectiveUserMessage, aiMessage, session.context, session.lang, arenaSessionId)
      : Promise.resolve(null),
    shouldRunJourney
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
        session.role, sanitizeArenaContext(session.context), session.lang,
        historyLen,
        session.clientProfile, session.sellerProfile, session.difficulty,
        session.sellerNotes, session.randomPreset, session.arenaStructuredContext,
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
        totalTokens: usage.total_tokens,
        latencyMs,
        status: "ok",
      });
    }
    aiResponse = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    aiResponse = session.lang === "en" ? "Let me reconsider that." : "Déjame replantear eso.";
  }

  // NOTE: repitch response is NOT added to session.turns.
  // Reason: repitch generates a visual repositioning hint only — adding it to session.turns
  // creates consecutive "assistant" messages in the GPT context which confuses the model,
  // and pollutes the audit log with a non-conversational turn.
  // The new sellerNotes are already in the system prompt for all subsequent real turns.
  res.json({ message: aiResponse });
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

  const constraintBlock = session.sellerNotes && session.sellerNotes.length > 0
    ? (effectiveLang === "es"
        ? `\nRESTRICCIONES ACTIVAS (aplica SIEMPRE):\n${session.sellerNotes.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n`
        : `\nACTIVE CONSTRAINTS (apply ALWAYS):\n${session.sellerNotes.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n`)
    : "";

  const systemPrompt = effectiveLang === "es"
    ? `Eres el vendedor ideal en una simulación de venta. Genera la MEJOR respuesta posible para el siguiente momento de la conversación.

${buildArenaSellerTacticalRules("es")}

Contexto de la sesión: ${session.context || "venta genérica"}${constraintBlock}`
    : `You are the ideal seller in a sales simulation. Generate the BEST possible response for the next moment in the conversation.

${buildArenaSellerTacticalRules("en")}

Session context: ${session.context || "generic sale"}${constraintBlock}`;

  const userPrompt = effectiveLang === "es"
    ? `${truncNote}Conversación hasta ahora:\n${transcript}\n\nEscribe SOLO el texto de la respuesta ideal del vendedor. Natural, conversacional, tácticamente correcto. 1-3 frases máximo.`
    : `${truncNote}Conversation so far:\n${transcript}\n\nWrite ONLY the text of the ideal seller response. Natural, conversational, tactically sound. 1-3 sentences max.`;

  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
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
        maxTokensConfigured: 300,
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

// ── POST /api/arena/audit-report ─────────────────────────────────────────────
// Brutal post-session audit for Arena. Independent — no regression risk.
// Input: { transcript, context, outcome, role, clientProfile?, sellerProfile?, difficulty?, lang }
router.post("/arena/audit-report", async (req, res) => {
  const {
    transcript = [],
    context = "",
    outcome = "",
    role = "seller",
    clientProfile,
    sellerProfile,
    difficulty,
    lang = "es",
    arenaStructuredContext,
  } = req.body as {
    transcript?: Array<{ speaker: "user" | "ai"; message: string }>;
    context?: string;
    outcome?: string;
    role?: string;
    clientProfile?: string;
    sellerProfile?: string;
    difficulty?: string;
    lang?: string;
    arenaStructuredContext?: ArenaStructuredContext;
  };

  const isEn = lang === "en";
  const isClient = role === "client";

  const formattedTranscript = transcript
    .map(t => {
      const who = t.speaker === "user"
        ? (isEn ? "USER" : "USUARIO")
        : (role === "seller"
          ? (isEn ? "AI CLIENT" : "CLIENTE IA")
          : (isEn ? "AI SELLER" : "VENDEDOR IA"));
      return `${who}: ${t.message}`;
    })
    .join("\n\n");

  const clientProfileDesc = clientProfile && CLIENT_PROFILE_DESC[clientProfile as keyof typeof CLIENT_PROFILE_DESC]
    ? CLIENT_PROFILE_DESC[clientProfile as keyof typeof CLIENT_PROFILE_DESC][isEn ? "en" : "es"]
    : null;
  const sellerProfileDesc = sellerProfile && SELLER_PROFILE_DESC[sellerProfile as keyof typeof SELLER_PROFILE_DESC]
    ? SELLER_PROFILE_DESC[sellerProfile as keyof typeof SELLER_PROFILE_DESC][isEn ? "en" : "es"]
    : null;
  const difficultyDesc = difficulty && DIFFICULTY_DESC[difficulty as keyof typeof DIFFICULTY_DESC]
    ? DIFFICULTY_DESC[difficulty as keyof typeof DIFFICULTY_DESC][isEn ? "en" : "es"]
    : null;

  const profileBlock = [
    !isClient && clientProfileDesc ? `${isEn ? "AI CLIENT PROFILE" : "PERFIL CLIENTE IA"}: ${clientProfileDesc}` : null,
    isClient && sellerProfileDesc ? `${isEn ? "AI SELLER PROFILE" : "PERFIL VENDEDOR IA"}: ${sellerProfileDesc}` : null,
    difficultyDesc ? `${isEn ? "DIFFICULTY" : "DIFICULTAD"}: ${difficultyDesc}` : null,
  ].filter(Boolean).join("\n");

  const sellerSchema = `{"verdict":"string","what_worked":["string"],"what_failed":["string"],"failure_owner":["usuario|timing|setup|sistema|sin fallo real — descripción"],"missed_closes":["string"],"rules_violated":["string"],"priority_changes":["string","string","string"],"prompt_patch":null,"prompt_for_replit":null,"what_i_would_have_done":"string","suspected_claim_risk":"yes|no","suspected_unresolved_technical_objection":"yes|no","suspected_false_confidence":"yes|no","suspected_soft_next_step":"yes|no"}`;
  const clientSchema = `{"verdict":"string","what_worked":["string"],"what_failed":["string"],"failure_owner":["usuario|timing|setup|sistema|sin fallo real — descripción"],"missed_closes":["string"],"rules_violated":["string"],"priority_changes":["string","string","string"],"prompt_patch":null,"prompt_for_replit":null,"what_i_would_have_done":"string"}`;
  const schema = isClient ? clientSchema : sellerSchema;

  let systemPrompt: string;
  if (isEn) {
    systemPrompt = isClient
      ? `You are a sales simulation evaluator. The user played as the CLIENT. Your job is to evaluate the quality of the AI seller — not the user as a seller.

Evaluate:
— Realism and depth of the AI seller as an interlocutor.
— Whether the AI seller provided enough challenge for the user.
— Whether the simulation was useful for learning how a real client reacts.
— Quality and variety of objection handling by the AI seller.
— failure_owner: system | AI seller | setup | no real failure.
— missed_closes: opportunities the AI seller did not exploit (moments where the user showed openness).
— what_i_would_have_done: how the AI seller should have responded at the key moment.
— prompt_patch: null unless you detect a clear AI system error.
— prompt_for_replit: null unless there is a clear setup issue.

Return EXACTLY this JSON, no markdown:
${schema}`
      : `You are a sales coach with very high standards evaluating a practice session. The user played as the SELLER. Return a brutal, actionable audit useful for training before real calls.

CRITICAL RULES:
— Evaluate actual execution (what they said and how) — not intent.
— Evaluate in context of the AI client profile and configured difficulty.
— Penalize: explanatory monologues without asking first, lack of conversational control, soft or late closes, objections answered without evidence, hiding behind explanations.
— If the practice was useful but soft, say so. If execution was weak, name it specifically.
— missed_closes: concrete moments in the transcript where the user could have closed or advanced and didn't.
— failure_owner: user | timing | setup | system | no real failure.
— what_i_would_have_done: a concrete message or tactic for the key moment of the session — not vague advice.
— prompt_patch / prompt_for_replit: null unless there's a clear system or setup error.
RISK FLAGS — evaluate and set each:
— suspected_claim_risk: "yes" if the user (seller) used "guarantee", "certified", "I assure you", "100% safe" or similar as a main argument without concrete evidence. "no" otherwise.
— suspected_unresolved_technical_objection: "yes" if the AI client raised a specific technical objection (numbers, ROI, methodology, data) and it was deferred or answered with generic reframing instead of concrete evidence. "no" otherwise.
— suspected_false_confidence: "yes" if the user used a certification, official body, or audit as definitive proof of future value or security. "no" otherwise.
— suspected_soft_next_step: "yes" if the session ended without a clear agreed next step or decision criterion for continuing. "no" otherwise.
— If the AI client showed an analytical profile (asked for data, numbers, methodology): evaluate whether the user responded with precision (confirmed/inferred/pending-proof) or with generic persuasion. Generic persuasion to an analytical client is a serious failure — name it specifically.

Return EXACTLY this JSON, no markdown:
${schema}`;
  } else {
    systemPrompt = isClient
      ? `Eres un evaluador de simulaciones de venta. El usuario jugó como CLIENTE. Tu trabajo es evaluar la calidad del vendedor IA — no al usuario como vendedor.

Evalúa:
— Realismo y profundidad del vendedor IA como interlocutor.
— Si el vendedor IA planteó suficiente desafío para el usuario.
— Si la simulación fue útil para aprender cómo reacciona un cliente real.
— Calidad y variedad del manejo de objeciones por parte del vendedor IA.
— failure_owner: sistema | vendedor IA | setup | sin fallo real.
— missed_closes: oportunidades que el vendedor IA no explotó (momentos donde el usuario mostró apertura).
— what_i_would_have_done: cómo debería haber respondido el vendedor IA en el momento clave.
— prompt_patch: null salvo error claro del sistema IA.
— prompt_for_replit: null salvo problema claro de setup.

Devuelve EXACTAMENTE este JSON, sin markdown:
${schema}`
      : `Eres un coach de ventas con criterio muy alto evaluando una sesión de práctica. El usuario jugó como VENDEDOR. Devuelve una auditoría brutal y accionable, útil para entrenar antes de llamadas reales.

REGLAS CRÍTICAS:
— Evalúa la ejecución real (lo que dijo y cómo) — no la intención.
— Evalúa en contexto del perfil del cliente IA y la dificultad configurada.
— Penaliza: monólogos explicativos sin preguntar primero, falta de control conversacional, cierres blandos o tardíos, objeciones respondidas sin evidencia, refugiarse en explicaciones.
— Si la práctica fue útil pero blanda, dilo. Si la ejecución fue floja, nómbrala específicamente.
— missed_closes: momentos concretos del transcript donde el usuario podría haber cerrado o avanzado y no lo hizo.
— failure_owner: usuario | timing | setup | sistema | sin fallo real.
— what_i_would_have_done: mensaje o táctica concreta para el momento clave de la sesión — no consejo vago.
— prompt_patch / prompt_for_replit: null salvo error claro de sistema o setup.
FLAGS DE RIESGO — evalúa y devuelve cada uno:
— suspected_claim_risk: "yes" si el usuario (vendedor) usó "garantía", "certific", "te aseguro", "100% seguro", "sin riesgo" como argumento principal sin evidencia concreta. "no" en caso contrario.
— suspected_unresolved_technical_objection: "yes" si el cliente IA planteó una objeción técnica específica (números, ROI, metodología, datos) que fue derivada a documentación o respondida con reencuadre genérico sin evidencia. "no" en caso contrario.
— suspected_false_confidence: "yes" si el usuario usó certificación, organismo regulador o auditoría como prueba definitiva de valor o seguridad futura. "no" en caso contrario.
— suspected_soft_next_step: "yes" si la sesión terminó sin siguiente paso claro o sin criterio de decisión acordado. "no" en caso contrario.
— Si el cliente IA mostró perfil analítico (pidió datos, cifras, metodología, evidencia): evalúa si el usuario respondió con precisión (confirmado/inferido/pendiente de prueba) o con persuasión genérica. La persuasión genérica ante un analítico es un fallo grave — nómbralo específicamente.

Devuelve EXACTAMENTE este JSON, sin markdown:
${schema}`;
  }

  const scAuditBlock = arenaStructuredContext
    ? buildArenaScBlock(arenaStructuredContext, lang as Lang)
    : "";

  const userMessage = [
    context ? `${isEn ? "CONTEXT" : "CONTEXTO"}: ${context}` : null,
    scAuditBlock || null,
    profileBlock || null,
    `${isEn ? "OUTCOME" : "RESULTADO"}: ${outcome}`,
    "",
    `${isEn ? "TRANSCRIPT" : "TRANSCRIPT"}:`,
    formattedTranscript || (isEn ? "(No turns recorded)" : "(Sin turnos registrados)"),
  ].filter(s => s !== null).join("\n");

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
    res.status(500).json({ error: "Arena audit generation failed" });
  }
});

export default router;
