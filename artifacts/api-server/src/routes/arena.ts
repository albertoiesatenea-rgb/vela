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
}

// ── In-memory session store ───────────────────────────────────────────────────
const sessions = new Map<string, ArenaSession>();

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildSystemPrompt(role: ArenaRole, context: string, lang: Lang): string {
  const langRule = lang === "en"
    ? "Respond only in English."
    : "Responde solo en español.";

  if (role === "seller") {
    return `Eres el cliente/prospecto en una simulación de conversación de venta.

Contexto de la sesión:
${context || "Conversación de venta genérica."}

Tu papel es el de la otra parte: el cliente, inversor, prospecto o interlocutor que puede ser convencido.
Responde siempre como esa persona. Puedes tener dudas, objeciones, preguntas, comparar alternativas o mostrar interés con reservas.

Reglas:
- Sé coherente con el contexto dado.
- Si el contexto es escaso, simula un cliente realista y razonable.
- No seas ni demasiado fácil ni imposiblemente hostil.
- Responde con 1-3 frases conversacionales naturales.
- No añadas etiquetas, explicaciones ni metacomentarios.
- Solo el texto de tu respuesta como cliente.
${langRule}`;
  } else {
    return `Eres un vendedor/consultor experto en una simulación de conversación de venta.

Contexto de la sesión:
${context || "Conversación de venta genérica."}

Tu papel es el del vendedor: guías la conversación, gestionas objeciones, presentas argumentos sólidos y trabajas hacia un cierre o avance.

Reglas:
- Sé coherente con el contexto dado.
- Si el contexto es escaso, simula un vendedor profesional y razonable.
- Sé profesional, directo y útil. No seas agresivo.
- Responde con 1-3 frases conversacionales naturales.
- No añadas etiquetas, explicaciones ni metacomentarios.
- Solo el texto de tu respuesta como vendedor.
${langRule}`;
  }
}

function buildOpeningPrompt(role: ArenaRole, context: string, lang: Lang): string {
  const langRule = lang === "en" ? "Write in English." : "Escribe en español.";

  if (role === "seller") {
    return `Genera el primer mensaje de un cliente/prospecto que inicia o responde a un primer contacto de venta.
Contexto: ${context || "conversación de venta genérica"}
Escribe 1-2 frases naturales como si fueras el cliente iniciando el contacto o respondiendo al vendedor. Sin etiquetas. Solo el texto.
${langRule}`;
  } else {
    return `Genera el primer mensaje de un vendedor experto que inicia una conversación de venta.
Contexto: ${context || "conversación de venta genérica"}
Escribe 1-2 frases naturales como si fueras el vendedor iniciando el contacto. Sin etiquetas. Solo el texto.
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
    ? `Eres un coach de ventas experto. Analiza esta conversación de venta perdida y evalúa al vendedor con precisión y sin rodeos.

Contexto de la sesión: ${context || "venta genérica"}

Conversación:
${transcript}

Responde ÚNICAMENTE con un JSON válido con este formato:
{
  "score": <número entero del 1 al 10>,
  "critique": ["frase corta 1", "frase corta 2", "frase corta 3"]
}

Reglas:
- score: puntuación honesta del vendedor (1=desastre, 5=mediocre, 8=bueno, 10=perfecto)
- critique: exactamente 3 frases cortas y directas explicando por qué se perdió
- Sé específico con la conversación real, no genérico
- Responde solo con el JSON, sin texto extra`
    : `You are an expert sales coach. Analyze this lost sales conversation and evaluate the seller honestly and directly.

Session context: ${context || "generic sale"}

Conversation:
${transcript}

Reply ONLY with valid JSON in this exact format:
{
  "score": <integer 1 to 10>,
  "critique": ["short point 1", "short point 2", "short point 3"]
}

Rules:
- score: honest seller rating (1=disaster, 5=mediocre, 8=good, 10=perfect)
- critique: exactly 3 short direct sentences explaining why the session was lost
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
  const { role, lang = "es", context = "" } = req.body as {
    role?: ArenaRole;
    lang?: Lang;
    context?: string;
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
  };

  let openingMessage = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      messages: [{ role: "user", content: buildOpeningPrompt(role, context, lang) }],
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
    { role: "system", content: buildSystemPrompt(session.role, session.context, session.lang) },
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

  // Generate debrief for seller sessions that ended in loss/breakdown
  const needsDebrief = session.role === "seller" && ["lost", "broken"].includes(session.outcome);
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

export default router;
