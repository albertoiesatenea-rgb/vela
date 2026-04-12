import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logAICall, closeSession } from "../lib/ai-tracker";
import {
  CLIENT_PROFILE_DESC,
  SELLER_PROFILE_DESC,
  DIFFICULTY_DESC,
  PRESET_SYSTEM_DESC,
  DEBRIEF_CLIENT_PROFILE,
  SALES_ANTIPATTERNS_BLOCK,
  COMPARISON_RULE_BLOCK,
  buildArenaSellerTacticalRules,
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

    // TOP BLOCK — placed before role definition for maximum primacy weight
    const topRestrictionsBlock = restrictionsList
      ? `══════════════════════════════════════════
MARCO ACTIVO DE LA SESIÓN — PRIORIDAD ABSOLUTA
══════════════════════════════════════════
El trainer ha definido las siguientes restricciones para esta sesión.
Tienen prioridad absoluta sobre:
— tu inercia comercial general
— las heurísticas y tácticas del vendedor
— el preset o dificultad configurados
— cualquier argumento que creas que "vendería mejor"

Si una restricción entra en conflicto con una heurística general, GANA LA RESTRICCIÓN.
No puedes salir del marco que definen, aunque la alternativa parezca más efectiva.

RESTRICCIONES ACTIVAS:
${restrictionsList}

PROHIBIDO bajo cualquier restricción activa:
— salir del producto, país, mercado o tipo de operación que define el caso
— ofrecer alternativas fuera del marco definido
— cambiar de geografía, categoría de bien o tipo de operación
— usar marcos argumentales explícitamente excluidos
— tratar estas restricciones como sugerencias blandas

Antes de escribir cada respuesta: ¿viola alguna restricción activa? Si es así, reescríbela dentro del marco permitido.
══════════════════════════════════════════

`
      : "";

    // BOTTOM REMINDER — placed right before langRule for recency weight
    const bottomRestrictionsReminder = restrictionsList
      ? `\nRECORDATORIO — RESTRICCIONES ACTIVAS DE ESTA SESIÓN (siguen vigentes):
${restrictionsList}
Mantente dentro del marco que definen. No salgas de él aunque el cliente lo invite.`
      : "";

    return `${topRestrictionsBlock}Eres el vendedor en una simulación de venta. Actúas como un comercial experimentado: preciso, honesto y sin relleno.

Contexto: ${context || "Conversación de venta genérica."}${profileNote}${presetBlock}${scBlock}${windowNote}

${buildArenaSellerTacticalRules(lang)}

COHERENCIA CON EL CONTEXTO:
— No propongas cambiar variables que el contexto ya define como fijas (precio, alquiler, condiciones pactadas, etc.).
— Si ya has afirmado que algo es fijo, no lo vuelvas a proponer como palanca.
— Si el contexto no permite cerrar el gap con el umbral del cliente, reconócelo.

TERCERO DECISOR:
— Si aparece pareja, socio, comité, asesor u otro decisor: no lo ignores ni lo eludes.
— Propón una de estas dos acciones: (a) incluir al tercero en la próxima conversación, o (b) cerrar un microcompromiso antes de que todo se enfríe.
— "Lo hablo y te digo" sin fecha ni siguiente paso concreto = callejón sin salida. No lo aceptes como cierre de turno.

COMPROMISO CON EL PRODUCTO:
— Solo descarta la operación si el gap es objetivamente incerrable y ya lo verificaste con datos concretos del contexto.
— Si hay ángulos sin explorar, explóralos antes de concluir que no hay encaje.

${SALES_ANTIPATTERNS_BLOCK[lang === "en" ? "en" : "es"]}

FORMATO:
— Separa con una línea en blanco la idea principal, la aclaración y la pregunta. No las pegues en un bloque corrido.
— Si hay 2 o 3 opciones o condiciones, ponlas en lista con guión: "- **Opción:** descripción breve"
— Frases cortas. Si la frase supera 20 palabras, córtala.
— No uses listas por sistema. Solo cuando enumeres opciones reales.
— Si el mensaje contiene una pregunta, escríbela ENTERA en negrita: **¿texto completo de la pregunta?**
— La pregunta final siempre en su propio párrafo (línea en blanco antes). Nunca pegada al final de un bloque corrido.

TONO: conversacional, claro, creíble. Como una persona, no como un chatbot.
Usa **negrita** para cifras, condiciones clave, conclusiones directas y cualquier término que el lector deba captar de un vistazo. Úsala con criterio — no en cada frase, pero sí donde aporte claridad.
Sin etiquetas ni metacomentarios.${bottomRestrictionsReminder}
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

  const who = role === "seller" ? "cliente/prospecto" : "vendedor experto";
  const whoEn = role === "seller" ? "client/prospect" : "expert seller";

  if (lang === "en") {
    if (role === "client") {
      return `You are an expert seller opening a sales conversation. Context: ${context || "generic sale"}${profileHint}${presetHint}. Invent a specific real-sounding name and company for yourself (e.g. "I'm Sara Voss from Clearpath Advisory" — no placeholders, no brackets). Write EXACTLY ONE sentence. Do what a top-tier seller would genuinely do to open: a precise observation, a direct reference to the prospect's situation, a short hook, or a well-placed question — vary the approach, never explain the product. Use **bold** on the most important word or number if relevant. No labels. Text only. ${langRule}`;
    }
    return `Generate the opening message of a ${whoEn} starting a sales conversation. Context: ${context || "generic sale"}${profileHint}${presetHint}. Write 1 short natural sentence as that person. No labels. Text only. ${langRule}`;
  }
  if (role === "client") {
    return `Eres un vendedor experto que abre una conversación de ventas. Contexto: ${context || "venta genérica"}${profileHint}${presetHint}. Invéntate un nombre y empresa reales y concretos (ej: "Soy Marcos Reina de Solvinova" — sin corchetes, sin variables). Escribe EXACTAMENTE UNA frase. Haz lo que haría un vendedor de primer nivel: puede ser una observación directa, una referencia al problema del prospecto, un gancho potente, o una pregunta bien colocada — varía el enfoque, nunca expliques el producto. Usa **negrita** en la palabra o cifra más importante si aporta. Sin etiquetas. Solo el texto. ${langRule}`;
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
      messages: [{ role: "user", content: buildOpeningPrompt(role, context, lang, clientProfile, sellerProfile, session.randomPreset) }],
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
        session.sellerNotes, session.randomPreset, session.arenaStructuredContext,
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
