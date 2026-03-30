import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logAICall, logSessionTotal, estimateCost } from "../lib/ai-tracker";

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
  analytical:      "Analítico: necesitas datos y evidencia antes de decidir. Haces preguntas técnicas. Los argumentos emocionales no te convencen.",
  emotional:       "Emocional: decides por confianza y relación personal. Te influyen testimonios y la conexión con el vendedor.",
  insecure:        "Inseguro: muchas dudas, miedo a equivocarte, necesitas validación constante. Postpones y buscas opiniones externas.",
  dominant:        "Dominante: tomas el control, interrumpes, marcas tú los tiempos. Necesitas sentir que tienes el poder.",
  indecisive:      "Indeciso: cambias de opinión, dices 'me lo pienso' repetidamente, difícil que te comprometas.",
  hard_negotiator: "Negociador duro: presionas siempre en precio, pides descuentos agresivos, comparas con competencia, amenazas con no cerrar.",
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
const TERMINAL_HINTS: Record<Lang, string[]> = {
  es: [
    "de acuerdo", "trato hecho", "vamos adelante", "siguiente paso", "cuándo podemos",
    "me has convencido", "lo pensaré", "no me interesa", "no estoy dispuesto",
    "no puedo seguir", "adiós", "hasta luego", "no voy a", "descartado", "imposible",
    "cerramos", "firmamos", "perfecto, adelante", "ya no",
  ],
  en: [
    "agreed", "deal", "let's go", "next step", "when can we", "you convinced me",
    "i'll think about it", "not interested", "won't do this", "can't continue",
    "goodbye", "bye", "ruled out", "impossible", "let's close", "sign", "perfect, let's",
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

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildSystemPrompt(
  role: ArenaRole,
  context: string,
  lang: Lang,
  historyLen: number,
  clientProfile?: string,
  sellerProfile?: string,
  difficulty?: string,
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

Tu papel es la otra parte. Mantén tu personalidad de forma consistente. Responde con 1-3 frases conversacionales naturales. Sin etiquetas ni metacomentarios. Solo el texto.
${langRule}`;
  } else {
    const profileNote = sellerProfile && SELLER_PROFILE_DESC[sellerProfile]
      ? `\nPERSONALIDAD: ${SELLER_PROFILE_DESC[sellerProfile]}`
      : "";

    return `Eres el vendedor/consultor en una simulación de conversación de venta.

Contexto: ${context || "Conversación de venta genérica."}${profileNote}${windowNote}

Tu papel es el vendedor. Mantén tu personalidad de forma consistente. Responde con 1-3 frases conversacionales naturales. Sin etiquetas ni metacomentarios. Solo el texto.
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

  const prompt = lang === "es"
    ? `Eres coach de ventas experto. Evalúa al vendedor con precisión y sin rodeos.

Contexto: ${context || "venta genérica"}
${outcomeLine}
${turns.length > DEBRIEF_MAX_TURNS ? `[Conversación de ${turns.length} turnos; se analizan los últimos ${relevantTurns.length}]` : ""}

Conversación:
${transcript}

Responde SOLO con JSON válido:
{"score":<1-10>,"critique":["frase 1","frase 2","frase 3"]}

Reglas: score honesto pesando el resultado (cerrada contra cliente difícil → mínimo 7; perdida → máximo 6). critique: exactamente 3 frases cortas accionables, imperativo (Escucha, Controla, Adapta...), específicas a esta conversación.`
    : `You are an expert sales coach. Evaluate the seller honestly and directly.

Context: ${context || "generic sale"}
${outcomeLine}
${turns.length > DEBRIEF_MAX_TURNS ? `[Conversation had ${turns.length} turns; analyzing last ${relevantTurns.length}]` : ""}

Conversation:
${transcript}

Reply ONLY with valid JSON:
{"score":<1-10>,"critique":["point 1","point 2","point 3"]}

Rules: honest score weighted by result (closed vs tough client → min 7; lost → max 6). critique: exactly 3 short actionable sentences, imperative (Listen, Control, Adapt...), specific to this conversation.`;

  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
    });
    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/finish/debrief",
        sessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        estimatedCostUsd: estimateCost(usage.prompt_tokens, usage.completion_tokens),
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
): Promise<Exclude<ArenaOutcome, "manual_stop">> {
  if (role === "client") return "none";

  // Skip if terminal check not warranted (saves the extra API call in most turns)
  if (USE_OPTIMIZED_ARENA && !shouldCheckTerminal(turns, lang)) return "none";
  if (turns.length < 4) return "none";

  const recent = turns.slice(-6).map(t => {
    const speaker = t.speaker === "user"
      ? (lang === "es" ? "VENDEDOR" : "SELLER")
      : (lang === "es" ? "CLIENTE" : "CLIENT");
    return `${speaker}: ${t.message}`;
  }).join("\n");

  const prompt = lang === "es"
    ? `Analiza esta conversación de venta y determina si ha llegado a un estado terminal claro.
Responde ÚNICAMENTE con una de estas palabras:
none | closed | next_step | lost | broken

none = sigue abierta
closed = cliente aceptó la oferta o cerró trato
next_step = cliente aceptó avanzar (reunión, demo, propuesta)
lost = cliente rechazó definitivamente
broken = ruptura total o conversación imposible

Conversación:
${recent}

Responde solo con la palabra:`
    : `Analyze this sales conversation and determine if it reached a clear terminal state.
Reply with ONLY one word:
none | closed | next_step | lost | broken

none = still open
closed = client accepted the offer or closed deal
next_step = client agreed to move forward
lost = client definitively rejected
broken = total breakdown

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
        route: "arena/turn/terminal",
        sessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        estimatedCostUsd: estimateCost(usage.prompt_tokens, usage.completion_tokens),
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
  const { role, lang = "es", context = "", clientProfile, sellerProfile, difficulty } = req.body as {
    role?: ArenaRole;
    lang?: Lang;
    context?: string;
    clientProfile?: string;
    sellerProfile?: string;
    difficulty?: string;
  };

  if (!role || !["seller", "client"].includes(role)) {
    res.status(400).json({ error: "role must be 'seller' or 'client'" });
    return;
  }

  const id = crypto.randomUUID();
  const session: ArenaSession = {
    id, role, lang,
    context: context.trim(),
    turns: [],
    createdAt: new Date().toISOString(),
    clientProfile, sellerProfile, difficulty,
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
        sessionId: id,
        mode: "arena",
        model: "gpt-4o-mini",
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        estimatedCostUsd: estimateCost(usage.prompt_tokens, usage.completion_tokens),
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
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      messages: gptMessages,
    });
    const latencyMs = Date.now() - t0;
    const usage = completion.usage;
    if (usage) {
      logAICall({
        route: "arena/turn",
        sessionId: arenaSessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        estimatedCostUsd: estimateCost(usage.prompt_tokens, usage.completion_tokens),
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

  // ── Conditional terminal detection ────────────────────────────────────────
  const terminalSignal = await detectTerminalState(
    session.turns, session.role, session.lang, arenaSessionId,
  );

  res.json({ aiMessage, terminalSignal });
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
    ? await generateDebrief(session.turns, session.context, session.lang, session.outcome ?? "manual_stop", arenaSessionId)
    : null;

  // Log session total before clearing
  logSessionTotal(arenaSessionId);

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
        sessionId: arenaSessionId,
        mode: "arena",
        model: "gpt-4o-mini",
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        estimatedCostUsd: estimateCost(usage.prompt_tokens, usage.completion_tokens),
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
