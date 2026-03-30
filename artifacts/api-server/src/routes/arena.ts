import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

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

// ── Personality & difficulty descriptors ─────────────────────────────────────
const CLIENT_PROFILE_DESC: Record<string, string> = {
  analytical:      "Eres analítico: necesitas datos, números y evidencia antes de decidir. Haces muchas preguntas técnicas y específicas. Los argumentos emocionales no te convencen.",
  emotional:       "Eres emocional: decides basándote en confianza, sensaciones y relación personal. Te afectan los testimonios y casos de éxito. La conexión con el vendedor importa mucho.",
  insecure:        "Eres inseguro: tienes muchas dudas y miedo a equivocarte. Necesitas validación y garantías constantes. Postpones decisiones y buscas opiniones externas.",
  dominant:        "Eres dominante: tomas el control de la conversación, interrumpes con frecuencia, marcas tú los tiempos y necesitas sentir que tienes el poder en la negociación.",
  indecisive:      "Eres indeciso: cambias de opinión, necesitas mucho tiempo, dices 'me lo pienso' repetidamente y es difícil que te comprometas a nada.",
  hard_negotiator: "Eres un negociador duro: presionas siempre en precio, pides descuentos agresivos, comparas con la competencia y amenazas con no cerrar si no obtienes condiciones.",
};

const SELLER_PROFILE_DESC: Record<string, string> = {
  communicative: "Eres comunicativo: hablas mucho, construyes relación, usas anécdotas y ejemplos. A veces te extiendes demasiado.",
  authoritative: "Eres autoritario: proyectas mucha seguridad, eres directo y asertivo, controlas la conversación y rebates objeciones con firmeza.",
  technical:     "Eres técnico: hablas en detalle de características, especificaciones y datos. Eres muy preciso pero a veces poco emocional.",
  passive:       "Eres pasivo: escuchas mucho, no presionas, esperas que el cliente llegue a sus conclusiones. Puedes parecer poco convencido de tu propio producto.",
  aggressive:    "Eres agresivo: presionas para cerrar, creas urgencia artificial, no aceptas 'no' fácilmente y puedes incomodar al cliente.",
  consultive:    "Eres consultivo: haces muchas preguntas, entiendes primero las necesidades del cliente y adaptas tu solución antes de argumentar.",
};

const DIFFICULTY_DESC: Record<string, string> = {
  easy:   "Sé fácil de convencer. Tienes pocas objeciones y estás bastante abierto a escuchar.",
  normal: "Sé realista. Tienes algunas objeciones válidas y necesitas buenos argumentos para convencerte.",
  hard:   "Sé exigente. Tienes muchas objeciones, comparas mucho con la competencia y eres difícil de convencer.",
  brutal: "Sé muy difícil. Eres escéptico, cuestionas todo, tienes objeciones fuertes y solo cederás ante argumentos verdaderamente sólidos.",
};

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildSystemPrompt(
  role: ArenaRole,
  context: string,
  lang: Lang,
  clientProfile?: string,
  sellerProfile?: string,
  difficulty?: string,
): string {
  const langRule = lang === "en"
    ? "Respond only in English."
    : "Responde solo en español.";

  if (role === "seller") {
    const profileNote = clientProfile && CLIENT_PROFILE_DESC[clientProfile]
      ? `\nPERSONALIDAD: ${CLIENT_PROFILE_DESC[clientProfile]}`
      : "";
    const diffNote = difficulty && DIFFICULTY_DESC[difficulty]
      ? `\nDIFICULTAD: ${DIFFICULTY_DESC[difficulty]}`
      : "";

    return `Eres el cliente/prospecto en una simulación de conversación de venta.

Contexto de la sesión:
${context || "Conversación de venta genérica."}
${profileNote}${diffNote}

Tu papel es el de la otra parte: el cliente, inversor, prospecto o interlocutor.
Responde siempre como esa persona. Mantén tu personalidad y nivel de dificultad de forma consistente durante toda la conversación.

Reglas:
- Sé coherente con el contexto y tu personalidad asignada.
- Responde con 1-3 frases conversacionales naturales.
- No añadas etiquetas, explicaciones ni metacomentarios.
- Solo el texto de tu respuesta como cliente.
${langRule}`;
  } else {
    const profileNote = sellerProfile && SELLER_PROFILE_DESC[sellerProfile]
      ? `\nPERSONALIDAD: ${SELLER_PROFILE_DESC[sellerProfile]}`
      : "";

    return `Eres un vendedor/consultor en una simulación de conversación de venta.

Contexto de la sesión:
${context || "Conversación de venta genérica."}
${profileNote}

Tu papel es el del vendedor: guías la conversación, gestionas objeciones, presentas argumentos y trabajas hacia un cierre o avance.
Mantén tu personalidad de forma consistente durante toda la conversación.

Reglas:
- Sé coherente con el contexto y tu estilo de venta asignado.
- Responde con 1-3 frases conversacionales naturales.
- No añadas etiquetas, explicaciones ni metacomentarios.
- Solo el texto de tu respuesta como vendedor.
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
    ? ` Personalidad del cliente: ${CLIENT_PROFILE_DESC[clientProfile]}`
    : role === "client" && sellerProfile && SELLER_PROFILE_DESC[sellerProfile]
    ? ` Personalidad del vendedor: ${SELLER_PROFILE_DESC[sellerProfile]}`
    : "";

  if (role === "seller") {
    return `Genera el primer mensaje de un cliente/prospecto que inicia o responde a un primer contacto de venta.
Contexto: ${context || "conversación de venta genérica"}${profileHint}
Escribe 1-2 frases naturales como si fueras el cliente. Sin etiquetas. Solo el texto.
${langRule}`;
  } else {
    return `Genera el primer mensaje de un vendedor experto que inicia una conversación de venta.
Contexto: ${context || "conversación de venta genérica"}${profileHint}
Escribe 1-2 frases naturales como si fueras el vendedor. Sin etiquetas. Solo el texto.
${langRule}`;
  }
}

// ── Debrief generator (for lost/broken sessions, seller role only) ────────────
async function generateDebrief(
  turns: ArenaTurn[],
  context: string,
  lang: Lang,
): Promise<{ score: number; critique: string[] } | null> {
  const transcript = turns.map(t => {
    const sp = t.speaker === "user"
      ? (lang === "es" ? "VENDEDOR" : "SELLER")
      : (lang === "es" ? "CLIENTE" : "CLIENT");
    return `${sp}: ${t.message}`;
  }).join("\n");

  const prompt = lang === "es"
    ? `Eres un coach de ventas experto. Analiza esta conversación de venta y evalúa al vendedor con precisión y sin rodeos.

Contexto de la sesión: ${context || "venta genérica"}

Conversación:
${transcript}

Responde ÚNICAMENTE con un JSON válido con este formato:
{
  "score": <número entero del 1 al 10>,
  "critique": ["punto de mejora 1", "punto de mejora 2", "punto de mejora 3"]
}

Reglas:
- score: puntuación honesta del vendedor (1=desastre, 5=mediocre, 8=bueno, 10=perfecto)
- critique: exactamente 3 frases cortas y accionables con lo más concreto que el vendedor debe mejorar para la próxima vez
- Comienza cada frase con un verbo en imperativo (Escucha, Controla, Adapta, Gestiona, Presenta...)
- Sé específico con la conversación real, no genérico
- Responde solo con el JSON, sin texto extra`
    : `You are an expert sales coach. Analyze this sales conversation and evaluate the seller honestly and directly.

Session context: ${context || "generic sale"}

Conversation:
${transcript}

Reply ONLY with valid JSON in this exact format:
{
  "score": <integer 1 to 10>,
  "critique": ["improvement point 1", "improvement point 2", "improvement point 3"]
}

Rules:
- score: honest seller rating (1=disaster, 5=mediocre, 8=good, 10=perfect)
- critique: exactly 3 short actionable sentences with the most concrete things the seller must improve next time
- Start each sentence with an imperative verb (Listen, Control, Adapt, Handle, Present...)
- Be specific to the actual conversation, not generic
- Reply only with the JSON, no extra text`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
    });
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
// Only runs in seller mode (AI plays client). In client mode, user controls outcome manually.
// Requires at least 4 turns to have meaningful signal.
async function detectTerminalState(
  turns: ArenaTurn[],
  role: ArenaRole,
  lang: Lang,
): Promise<Exclude<ArenaOutcome, "manual_stop">> {
  if (role === "client") return "none";
  if (turns.length < 4) return "none";

  const recent = turns.slice(-6).map(t => {
    const speaker = t.speaker === "user"
      ? (lang === "es" ? "VENDEDOR" : "SELLER")
      : (lang === "es" ? "CLIENTE" : "CLIENT");
    return `${speaker}: ${t.message}`;
  }).join("\n");

  const prompt = lang === "es"
    ? `Analiza esta conversación de venta y determina si ha llegado a un estado terminal claro.
Responde ÚNICAMENTE con una de estas palabras (sin explicación):
- none — no hay cierre claro todavía, la conversación sigue abierta
- closed — el cliente ha comprado, aceptado la oferta o cerrado el trato
- next_step — el cliente ha aceptado avanzar (reunión, demo, propuesta, llamada)
- lost — la conversación está perdida, el cliente ha rechazado definitivamente
- broken — ruptura total, conversación imposible o cortada

Conversación reciente:
${recent}

Responde solo con la palabra:`
    : `Analyze this sales conversation and determine if it has reached a clear terminal state.
Reply with ONLY one of these words (no explanation):
- none — no clear closure yet, conversation is still open
- closed — client has bought, accepted the offer, or closed the deal
- next_step — client agreed to move forward (meeting, demo, proposal, call)
- lost — conversation is lost, client has definitively rejected
- broken — total breakdown, conversation is impossible or cut off

Recent conversation:
${recent}

Reply with one word only:`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 5,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
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
    id,
    role,
    lang,
    context: context.trim(),
    turns: [],
    createdAt: new Date().toISOString(),
    clientProfile,
    sellerProfile,
    difficulty,
  };

  let openingMessage = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      messages: [{ role: "user", content: buildOpeningPrompt(role, context, lang, clientProfile, sellerProfile) }],
    });
    openingMessage = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    openingMessage = lang === "en" ? "Hello, I'm ready." : "Hola, estoy listo.";
  }

  session.turns.push({
    index: 0,
    timestamp: new Date().toISOString(),
    speaker: "ai",
    message: openingMessage,
  });

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

  const gptMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: buildSystemPrompt(session.role, session.context, session.lang, session.clientProfile, session.sellerProfile, session.difficulty) },
  ];

  for (const turn of session.turns) {
    gptMessages.push({
      role: turn.speaker === "user" ? "user" : "assistant",
      content: turn.message,
    });
  }

  let aiMessage = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 300,
      messages: gptMessages,
    });
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

  // Detect terminal state (seller mode only, fast classification call)
  const terminalSignal = await detectTerminalState(session.turns, session.role, session.lang);

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

  // Generate debrief for seller sessions that had actual user participation
  const needsDebrief = session.role === "seller" && userTurns > 0;
  const debrief = needsDebrief
    ? await generateDebrief(session.turns, session.context, session.lang)
    : null;

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
// Returns the ideal next seller response given the conversation so far.
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

  const transcript = session.turns.map(t => {
    const sp = t.speaker === "user"
      ? (effectiveLang === "es" ? "VENDEDOR" : "SELLER")
      : (effectiveLang === "es" ? "CLIENTE" : "CLIENT");
    return `${sp}: ${t.message}`;
  }).join("\n");

  const prompt = effectiveLang === "es"
    ? `Eres un experto en ventas. Dado el contexto y la conversación actual, escribe la respuesta PERFECTA que debería dar el vendedor ahora mismo para avanzar la venta.

Contexto de la sesión: ${session.context || "venta genérica"}

Conversación hasta ahora:
${transcript}

Escribe SOLO el texto de la respuesta ideal del vendedor. Natural, conversacional, tácticamente correcta. 2-3 frases máximo. Nada más.`
    : `You are an expert sales professional. Given the context and conversation so far, write the PERFECT response the seller should give right now to advance the sale.

Session context: ${session.context || "generic sale"}

Conversation so far:
${transcript}

Write ONLY the ideal seller response text. Natural, conversational, tactically sound. 2-3 sentences max. Nothing else.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }],
    });
    const suggestion = completion.choices[0]?.message?.content?.trim() ?? "";
    res.json({ suggestion });
  } catch {
    res.status(500).json({ error: "Failed to generate suggestion" });
  }
});

export default router;
