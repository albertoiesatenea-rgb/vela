import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────
type ArenaRole = "seller" | "client";
type Lang = "es" | "en";

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
}

// ── In-memory session store ───────────────────────────────────────────────────
const sessions = new Map<string, ArenaSession>();

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildSystemPrompt(role: ArenaRole, context: string, lang: Lang): string {
  const langRule = lang === "en"
    ? "Respond only in English."
    : "Responde solo en español.";

  if (role === "seller") {
    // User is seller → AI plays the client/prospect
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
    // User is client → AI plays the seller
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
    // AI (client) opens — sets the scene for the seller (user) to respond
    return `Genera el primer mensaje de un cliente/prospecto que inicia o responde a un primer contacto de venta.
Contexto: ${context || "conversación de venta genérica"}
Escribe 1-2 frases naturales como si fueras el cliente iniciando el contacto o respondiendo al vendedor. Sin etiquetas. Solo el texto.
${langRule}`;
  } else {
    // AI (seller) opens — starts the conversation for the client (user) to respond
    return `Genera el primer mensaje de un vendedor experto que inicia una conversación de venta.
Contexto: ${context || "conversación de venta genérica"}
Escribe 1-2 frases naturales como si fueras el vendedor iniciando el contacto. Sin etiquetas. Solo el texto.
${langRule}`;
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

  // Generate opening message from AI
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

  // Add user turn to session
  session.turns.push({
    index: session.turns.length,
    timestamp: new Date().toISOString(),
    speaker: "user",
    message: userMessage.trim(),
  });

  // Build GPT messages from history
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

  res.json({ aiMessage });
});

// ── POST /api/arena/finish ────────────────────────────────────────────────────
router.post("/arena/finish", async (req, res) => {
  const { arenaSessionId } = req.body as { arenaSessionId?: string };

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

  const userTurns = session.turns.filter(t => t.speaker === "user").length;

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
    },
  });

  // Clean up session from memory after 5 minutes
  setTimeout(() => sessions.delete(arenaSessionId), 5 * 60 * 1000);
});

export default router;
