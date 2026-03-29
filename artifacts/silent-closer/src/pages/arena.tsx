import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { WizardIcon } from "@/components/context-panel";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
export type ArenaRole = "seller" | "client";
type Lang = "es" | "en";
type ConversationState = "favorable" | "tense" | "critical";
export type ArenaOutcome = "closed" | "next_step" | "lost" | "broken" | "manual_stop" | "none";
type FinalOutcome = Exclude<ArenaOutcome, "none">;

interface ArenaMessage {
  index: number;
  speaker: "user" | "ai";
  message: string;
}

interface ArenaDebrief {
  score: number;
  critique: string[];
}

interface ArenaSummary {
  role: ArenaRole;
  context: string;
  lang: Lang;
  totalTurns: number;
  userTurns: number;
  createdAt: string;
  closedAt: string;
  outcome: FinalOutcome;
  debrief?: ArenaDebrief | null;
}

// ── Conversation state heuristic ──────────────────────────────────────────────
const CRITICAL_KEYWORDS = {
  es: [
    "no me interesa", "no puedo", "absolutamente no", "imposible", "demasiado caro",
    "no estoy dispuesto", "ya tengo proveedor", "no es para mí", "no voy a",
    "no tiene sentido", "no lo necesito", "no gracias", "no me convence",
    "ya tenemos solución", "descartado",
  ],
  en: [
    "not interested", "absolutely not", "impossible", "way too expensive",
    "already have", "not for me", "won't do", "doesn't make sense",
    "don't need it", "no thanks", "not convinced", "we already have a solution",
    "ruled out", "can't do this",
  ],
};

const FAVORABLE_KEYWORDS = {
  es: [
    "interesante", "me gusta", "podría funcionar", "cuéntame más", "¿cuándo",
    "de acuerdo", "vamos adelante", "suena bien", "me parece bien", "perfecto",
    "podría ser", "hay posibilidad", "vale, explícame", "seguimos hablando",
    "me llama la atención", "podemos avanzar",
  ],
  en: [
    "interesting", "i like", "could work", "tell me more", "when can",
    "agreed", "let's go", "sounds good", "that works", "perfect",
    "that could be", "there's a possibility", "okay, explain", "keep talking",
    "catches my attention", "we can move forward",
  ],
};

function inferState(text: string, lang: Lang): ConversationState {
  const lower = text.toLowerCase();
  if (CRITICAL_KEYWORDS[lang].some(kw => lower.includes(kw))) return "critical";
  if (FAVORABLE_KEYWORDS[lang].some(kw => lower.includes(kw))) return "favorable";
  return "tense";
}

// ── Translations ──────────────────────────────────────────────────────────────
const T = {
  es: {
    ARENA: "ARENA",
    YOU: "TÚ",
    AI_AS_CLIENT: "CLIENTE",
    AI_AS_SELLER: "VENDEDOR",
    ROLE_TAG_SELLER: "Eres el vendedor",
    ROLE_TAG_CLIENT: "Eres el cliente",
    PLACEHOLDER: "Escribe tu mensaje...",
    SEND: "Enviar",
    END: "Terminar sesión",
    STARTING: "Iniciando arena...",
    SENDING: "Respondiendo...",
    SUMMARY_TITLE: "SESIÓN TERMINADA",
    TURNS: "Turnos del usuario",
    TOTAL: "Turnos totales",
    ROLE_USED: "Tu rol",
    ROLE_SELLER: "Vendedor",
    ROLE_CLIENT: "Cliente",
    EXPORT: "Exportar log (.txt) ↓",
    CLOSE: "Cerrar y volver",
    EXIT: "← Salir",
    STATE_FAVORABLE: "Favorable",
    STATE_TENSE: "Tensa",
    STATE_CRITICAL: "Crítica",
    // Outcomes
    OUTCOME_CLOSED: "Sesión ganada",
    OUTCOME_NEXT_STEP: "Avance conseguido",
    OUTCOME_LOST: "Sesión perdida",
    OUTCOME_BROKEN: "Conversación rota",
    OUTCOME_MANUAL_STOP: "Parada manual",
    // Modal
    MODAL_DETECT: "Arena detecta",
    MODAL_CONFIRM: "Confirmar y cerrar",
    MODAL_CONTINUE: "Seguir conversando",
    MODAL_CORRECT: "Corregir resultado",
    MODAL_CORRECT_PROMPT: "¿Cuál fue el resultado real?",
    // Client mode outcome buttons
    CLIENT_SOLD: "Trato hecho ✓",
    CLIENT_ACCEPT: "Ok, sigue →",
    CLIENT_OBJECTION: "No estoy de acuerdo",
    CLIENT_ACCEPT_MSG: "Ok, cuéntame más.",
    CLIENT_OBJECTION_MSG: "No, eso no me convence.",
    CLIENT_END_CHAT: "Terminar chat",
    CLIENT_EXIT_TITLE: "¿Cómo termina esto?",
    CLIENT_EXIT_CONVINCED: "Me has convencido ✓",
    CLIENT_EXIT_LOST: "Me has perdido",
    CLIENT_EXIT_QUIT: "Solo quería acabar",
    CLIENT_EXIT_REASON_TITLE: "¿Por qué te han perdido?",
    CLIENT_EXIT_REASON_PH: "Escribe el motivo (opcional)",
    CLIENT_EXIT_CONFIRM: "Confirmar →",
    CLIENT_EXIT_BACK: "← Volver",
    CLIENT_EXIT_NOTE_LABEL: "MOTIVO DE SALIDA",
    // Summary
    OUTCOME_LABEL: "RESULTADO",
    // Debrief
    DEBRIEF_SCORE: "PUNTUACIÓN",
    DEBRIEF_CRITIQUE: "QUÉ FALLÓ",
    DEBRIEF_RETRY: "Intentar de nuevo →",
    CLIENT_RETRY: "Repetir →",
    DEBRIEF_LOADING: "Analizando sesión...",
  },
  en: {
    ARENA: "ARENA",
    YOU: "YOU",
    AI_AS_CLIENT: "CLIENT",
    AI_AS_SELLER: "SELLER",
    ROLE_TAG_SELLER: "You are the seller",
    ROLE_TAG_CLIENT: "You are the client",
    PLACEHOLDER: "Type your message...",
    SEND: "Send",
    END: "End session",
    STARTING: "Starting arena...",
    SENDING: "Responding...",
    SUMMARY_TITLE: "SESSION ENDED",
    TURNS: "Your turns",
    TOTAL: "Total turns",
    ROLE_USED: "Your role",
    ROLE_SELLER: "Seller",
    ROLE_CLIENT: "Client",
    EXPORT: "Export log (.txt) ↓",
    CLOSE: "Close and exit",
    EXIT: "← Exit",
    STATE_FAVORABLE: "Favorable",
    STATE_TENSE: "Tense",
    STATE_CRITICAL: "Critical",
    // Outcomes
    OUTCOME_CLOSED: "Session won",
    OUTCOME_NEXT_STEP: "Next step achieved",
    OUTCOME_LOST: "Session lost",
    OUTCOME_BROKEN: "Conversation broken",
    OUTCOME_MANUAL_STOP: "Manual stop",
    // Modal
    MODAL_DETECT: "Arena detects",
    MODAL_CONFIRM: "Confirm and close",
    MODAL_CONTINUE: "Keep talking",
    MODAL_CORRECT: "Correct outcome",
    MODAL_CORRECT_PROMPT: "What was the actual outcome?",
    // Client mode outcome buttons
    CLIENT_SOLD: "Deal ✓",
    CLIENT_ACCEPT: "OK, keep going →",
    CLIENT_OBJECTION: "I disagree",
    CLIENT_ACCEPT_MSG: "OK, tell me more.",
    CLIENT_OBJECTION_MSG: "No, I'm not convinced by that.",
    CLIENT_END_CHAT: "End chat",
    CLIENT_EXIT_TITLE: "How does this end?",
    CLIENT_EXIT_CONVINCED: "You convinced me ✓",
    CLIENT_EXIT_LOST: "You lost me",
    CLIENT_EXIT_QUIT: "I just wanted to stop",
    CLIENT_EXIT_REASON_TITLE: "Why did you lose interest?",
    CLIENT_EXIT_REASON_PH: "Write the reason (optional)",
    CLIENT_EXIT_CONFIRM: "Confirm →",
    CLIENT_EXIT_BACK: "← Back",
    CLIENT_EXIT_NOTE_LABEL: "EXIT REASON",
    // Summary
    OUTCOME_LABEL: "OUTCOME",
    // Debrief
    DEBRIEF_SCORE: "SCORE",
    DEBRIEF_CRITIQUE: "WHAT WENT WRONG",
    DEBRIEF_RETRY: "Try again →",
    CLIENT_RETRY: "Repeat →",
    DEBRIEF_LOADING: "Analyzing session...",
  },
};

// ── Outcome helpers ───────────────────────────────────────────────────────────
function getOutcomeLabel(outcome: FinalOutcome, t: typeof T["es"]): string {
  const map: Record<FinalOutcome, string> = {
    closed: t.OUTCOME_CLOSED,
    next_step: t.OUTCOME_NEXT_STEP,
    lost: t.OUTCOME_LOST,
    broken: t.OUTCOME_BROKEN,
    manual_stop: t.OUTCOME_MANUAL_STOP,
  };
  return map[outcome];
}

function getOutcomeColor(outcome: FinalOutcome): string {
  const map: Record<FinalOutcome, string> = {
    closed: "text-emerald-400",
    next_step: "text-sky-400",
    lost: "text-red-400",
    broken: "text-amber-400",
    manual_stop: "text-zinc-400",
  };
  return map[outcome];
}

function getOutcomeBg(outcome: FinalOutcome): string {
  const map: Record<FinalOutcome, string> = {
    closed: "bg-emerald-400/10 border-emerald-400/20",
    next_step: "bg-sky-400/10 border-sky-400/20",
    lost: "bg-red-400/10 border-red-400/20",
    broken: "bg-amber-400/10 border-amber-400/20",
    manual_stop: "bg-zinc-800/60 border-zinc-700/40",
  };
  return map[outcome];
}

// ── State indicator ───────────────────────────────────────────────────────────
const STATE_DOT: Record<ConversationState, string> = {
  favorable: "bg-emerald-400",
  tense: "bg-amber-400",
  critical: "bg-red-400",
};

const STATE_TEXT: Record<ConversationState, string> = {
  favorable: "text-emerald-400",
  tense: "text-amber-400",
  critical: "text-red-400",
};

function StateIndicator({ state, lang }: { state: ConversationState | null; lang: Lang }) {
  if (!state) return null;
  const t = T[lang];
  const label = state === "favorable" ? t.STATE_FAVORABLE : state === "tense" ? t.STATE_TENSE : t.STATE_CRITICAL;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATE_DOT[state])} />
      <span className={cn("text-[9px] font-mono tracking-widest uppercase", STATE_TEXT[state])}>
        {label}
      </span>
    </div>
  );
}

// ── Outcome confirmation modal (seller mode) ──────────────────────────────────
function OutcomeModal({
  detectedOutcome,
  lang,
  onConfirm,
  onContinue,
}: {
  detectedOutcome: Exclude<ArenaOutcome, "none" | "manual_stop">;
  lang: Lang;
  onConfirm: (outcome: FinalOutcome) => void;
  onContinue: () => void;
}) {
  const t = T[lang];
  const [correcting, setCorrecting] = useState(false);

  const outcomes: Array<{ key: FinalOutcome; label: string }> = [
    { key: "closed", label: t.OUTCOME_CLOSED },
    { key: "next_step", label: t.OUTCOME_NEXT_STEP },
    { key: "lost", label: t.OUTCOME_LOST },
    { key: "broken", label: t.OUTCOME_BROKEN },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center px-6 z-50">
      <div className="w-full max-w-xs bg-zinc-950 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-4">
        {!correcting ? (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">
                {t.MODAL_DETECT}
              </p>
              <p className={cn("text-base font-mono font-bold", getOutcomeColor(detectedOutcome))}>
                {getOutcomeLabel(detectedOutcome, t)}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => onConfirm(detectedOutcome)}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-mono font-bold hover:bg-zinc-100 active:scale-[0.98] transition-all"
              >
                {t.MODAL_CONFIRM}
              </button>
              <button
                onClick={onContinue}
                className="w-full py-2.5 rounded-xl border border-zinc-800 text-zinc-300 text-xs font-mono hover:border-zinc-600 hover:text-white transition-all"
              >
                {t.MODAL_CONTINUE}
              </button>
              <button
                onClick={() => setCorrecting(true)}
                className="w-full py-1.5 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                {t.MODAL_CORRECT}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">
              {t.MODAL_CORRECT_PROMPT}
            </p>
            <div className="flex flex-col gap-2">
              {outcomes.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => onConfirm(key)}
                  className={cn(
                    "w-full py-2.5 rounded-xl border text-xs font-mono transition-all text-left px-3",
                    key === detectedOutcome
                      ? "border-zinc-600 text-white bg-zinc-900"
                      : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  )}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => setCorrecting(false)}
                className="w-full py-1.5 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                ← {lang === "es" ? "Volver" : "Back"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Client mode outcome buttons ───────────────────────────────────────────────
function ClientOutcomeBar({
  lang,
  disabled,
  onShortcut,
  onEndChat,
}: {
  lang: Lang;
  disabled: boolean;
  onShortcut: (text: string) => void;
  onEndChat: () => void;
}) {
  const t = T[lang];

  return (
    <div className="flex gap-2 pt-1">
      {/* Accept — shortcut message, conversation continues */}
      <button
        onClick={() => onShortcut(t.CLIENT_ACCEPT_MSG)}
        disabled={disabled}
        className="flex-1 py-2 rounded-lg border text-[10px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-sky-400 border-sky-400/30 hover:border-sky-400/60 hover:bg-sky-400/5"
      >
        {t.CLIENT_ACCEPT}
      </button>

      {/* Objection — shortcut message, conversation continues */}
      <button
        onClick={() => onShortcut(t.CLIENT_OBJECTION_MSG)}
        disabled={disabled}
        className="flex-1 py-2 rounded-lg border text-[10px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-amber-400 border-amber-400/30 hover:border-amber-400/60 hover:bg-amber-400/5"
      >
        {t.CLIENT_OBJECTION}
      </button>

      {/* End chat — opens exit panel */}
      <button
        onClick={onEndChat}
        disabled={disabled}
        className="flex-1 py-2 rounded-lg border text-[10px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-zinc-300 border-zinc-700 hover:border-zinc-500 hover:text-white"
      >
        {t.CLIENT_END_CHAT}
      </button>
    </div>
  );
}

// ── Arena component ───────────────────────────────────────────────────────────
export function Arena({
  context,
  contextLabel,
  role,
  lang,
  onExit,
  onRetry,
}: {
  context: string;
  contextLabel: string;
  role: ArenaRole;
  lang: Lang;
  onExit: () => void;
  onRetry?: () => void;
}) {
  const t = T[lang];

  const [arenaSessionId, setArenaSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ArenaMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStarting, setIsStarting] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [summary, setSummary] = useState<ArenaSummary | null>(null);
  const [allTurns, setAllTurns] = useState<ArenaMessage[]>([]);
  const [exitStep, setExitStep] = useState<null | "outcomes" | "reason">(null);
  const [pendingExitReason, setPendingExitReason] = useState("");
  const [exitNote, setExitNote] = useState<{ text: string; outcome: FinalOutcome } | null>(null);
  const [conversationState, setConversationState] = useState<ConversationState | null>(null);
  // Terminal state detection (seller mode)
  const [pendingOutcome, setPendingOutcome] = useState<Exclude<ArenaOutcome, "none" | "manual_stop"> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const aiLabel = role === "seller" ? t.AI_AS_CLIENT : t.AI_AS_SELLER;
  const roleTag = role === "seller" ? t.ROLE_TAG_SELLER : t.ROLE_TAG_CLIENT;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus textarea as soon as the session finishes loading
  useEffect(() => {
    if (!isStarting) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isStarting]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/arena/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, lang, context }),
        });
        const data = await res.json() as { arenaSessionId: string; openingMessage: string };
        if (cancelled) return;
        setArenaSessionId(data.arenaSessionId);
        setMessages([{ index: 0, speaker: "ai", message: data.openingMessage }]);
        setConversationState(inferState(data.openingMessage, lang));
      } catch {
        if (!cancelled) {
          setMessages([{ index: 0, speaker: "ai", message: lang === "en" ? "Ready." : "Listo." }]);
          setArenaSessionId("offline-" + Date.now());
        }
      } finally {
        if (!cancelled) setIsStarting(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleEnd = useCallback(async (outcome: FinalOutcome = "manual_stop") => {
    if (!arenaSessionId || isEnding) return;
    setIsEnding(true);
    setPendingOutcome(null);
    try {
      const res = await fetch("/api/arena/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arenaSessionId, outcome }),
      });
      const data = await res.json() as { turns: ArenaMessage[]; summary: ArenaSummary };
      setAllTurns(data.turns);
      setSummary(data.summary);
    } catch {
      const localTurns = messages.map((m, i) => ({ ...m, index: i }));
      setAllTurns(localTurns);
      setSummary({
        role,
        context,
        lang,
        totalTurns: messages.length,
        userTurns: messages.filter(m => m.speaker === "user").length,
        createdAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
        outcome,
      });
    } finally {
      setIsEnding(false);
    }
  }, [arenaSessionId, isEnding, messages, role, context, lang]);

  const handleClientExit = useCallback(async (outcome: FinalOutcome) => {
    const reason = pendingExitReason.trim();
    setExitNote({ text: reason, outcome });
    setExitStep(null);
    setPendingExitReason("");
    await handleEnd(outcome);
  }, [pendingExitReason, handleEnd]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isSending || !arenaSessionId) return;

    const userMsg: ArenaMessage = { index: messages.length, speaker: "user", message: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch("/api/arena/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arenaSessionId, userMessage: text.trim() }),
      });
      const data = await res.json() as { aiMessage: string; terminalSignal?: ArenaOutcome };
      setMessages(prev => [...prev, { index: prev.length, speaker: "ai", message: data.aiMessage }]);
      setConversationState(inferState(data.aiMessage, lang));
      if (data.terminalSignal && data.terminalSignal !== "none" && data.terminalSignal !== "manual_stop") {
        setPendingOutcome(data.terminalSignal as Exclude<ArenaOutcome, "none" | "manual_stop">);
      }
    } catch {
      setMessages(prev => [...prev, {
        index: prev.length,
        speaker: "ai",
        message: lang === "en" ? "(Connection error)" : "(Error de conexión)",
      }]);
    } finally {
      setIsSending(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isSending, arenaSessionId, messages.length, lang]);

  const handleSend = useCallback(() => {
    void sendMessage(input);
  }, [input, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleExportLog = () => {
    if (!summary) return;
    const isEs = lang === "es";
    const roleName = role === "seller" ? (isEs ? "Vendedor" : "Seller") : (isEs ? "Cliente" : "Client");
    const aiName = role === "seller" ? (isEs ? "CLIENTE" : "CLIENT") : (isEs ? "VENDEDOR" : "SELLER");
    const outcomeName = getOutcomeLabel(summary.outcome, T[lang]);

    const lines: string[] = [
      `CLOSER WIZARD — ARENA SESSION LOG`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `${isEs ? "Modo" : "Mode"}: ARENA`,
      `${isEs ? "Tu rol" : "Your role"}: ${roleName}`,
      `${isEs ? "Resultado" : "Outcome"}: ${outcomeName}`,
      `${isEs ? "Idioma" : "Lang"}: ${lang.toUpperCase()}`,
      `${isEs ? "Inicio" : "Start"}: ${summary.createdAt}`,
      `${isEs ? "Fin" : "End"}: ${summary.closedAt}`,
      ``,
      `${isEs ? "CONTEXTO" : "CONTEXT"}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      summary.context || (isEs ? "(sin contexto)" : "(no context)"),
      ``,
      `${isEs ? "CONVERSACIÓN" : "CONVERSATION"}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ];

    allTurns.forEach((turn, i) => {
      const label = turn.speaker === "user" ? (isEs ? "TÚ" : "YOU") : aiName;
      lines.push(`[${i + 1}] [${label}]: ${turn.message}`);
    });

    lines.push(``);
    lines.push(`${isEs ? "RESUMEN" : "SUMMARY"}`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`${isEs ? "Resultado" : "Outcome"}: ${outcomeName}`);
    lines.push(`${isEs ? "Turnos totales" : "Total turns"}: ${summary.totalTurns}`);
    lines.push(`${isEs ? "Tus turnos" : "Your turns"}: ${summary.userTurns}`);

    if (exitNote?.text) {
      lines.push(``);
      lines.push(`${isEs ? "MOTIVO DE SALIDA" : "EXIT REASON"}`);
      lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      lines.push(exitNote.text);
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    a.download = `closer-wizard-arena-${ts}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Summary screen ──────────────────────────────────────────────────────────
  if (summary) {
    const roleName = role === "seller" ? t.ROLE_SELLER : t.ROLE_CLIENT;
    const outcomeName = getOutcomeLabel(summary.outcome, t);
    const outcomeColor = getOutcomeColor(summary.outcome);
    const outcomeBg = getOutcomeBg(summary.outcome);
    const isLoss = ["lost", "broken"].includes(summary.outcome) && role === "seller";
    const debrief = summary.debrief;

    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center px-6 overflow-y-auto py-8">
        <div className="w-full max-w-sm flex flex-col gap-5">

          <div className="flex items-center gap-2">
            <WizardIcon className="w-5 h-5 text-zinc-400" />
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-zinc-400">Closer Wizard</span>
            <span className="text-zinc-700 text-[10px]">·</span>
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-zinc-500">{t.ARENA}</span>
          </div>

          {/* Outcome badge */}
          <div className={cn("flex flex-col gap-1 border rounded-xl px-4 py-3", outcomeBg)}>
            <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.OUTCOME_LABEL}</p>
            <p className={cn("text-xl font-mono font-bold", outcomeColor)}>{outcomeName}</p>
          </div>

          {/* Exit note — only for client mode when reason was given */}
          {exitNote?.text && role === "client" && (
            <div className="border border-zinc-800 rounded-xl px-4 py-3 flex flex-col gap-1">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.CLIENT_EXIT_NOTE_LABEL}</p>
              <p className="text-sm font-mono text-zinc-300 leading-relaxed">{exitNote.text}</p>
            </div>
          )}

          {/* Debrief block — only for lost/broken seller sessions */}
          {isLoss && debrief && (
            <div className="flex flex-col gap-4 border border-zinc-800 rounded-xl px-4 py-4 bg-zinc-950">

              {/* Score */}
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-0.5">
                  <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.DEBRIEF_SCORE}</p>
                  <div className="flex items-baseline gap-1">
                    <span className={cn(
                      "text-4xl font-mono font-bold tabular-nums",
                      debrief.score <= 3 ? "text-red-400"
                      : debrief.score <= 5 ? "text-amber-400"
                      : debrief.score <= 7 ? "text-zinc-200"
                      : "text-emerald-400"
                    )}>
                      {debrief.score}
                    </span>
                    <span className="text-lg font-mono text-zinc-600">/ 10</span>
                  </div>
                </div>
              </div>

              {/* Critique bullets */}
              {debrief.critique.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.DEBRIEF_CRITIQUE}</p>
                  <div className="flex flex-col gap-2">
                    {debrief.critique.map((point, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-zinc-600 font-mono text-xs shrink-0 mt-0.5">—</span>
                        <p className="text-xs font-mono text-zinc-300 leading-relaxed">{point}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Stats row */}
          <div className="flex gap-6 border-t border-white/8 pt-4">
            <div className="flex flex-col gap-0.5">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.ROLE_USED}</p>
              <p className="text-sm font-mono font-semibold text-white uppercase">{roleName}</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.TURNS}</p>
              <p className="text-sm font-mono font-semibold text-white">{summary.userTurns}</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.TOTAL}</p>
              <p className="text-sm font-mono font-semibold text-white">{summary.totalTurns}</p>
            </div>
          </div>

          {/* Context */}
          {summary.context && (
            <div className="border-t border-white/8 pt-4">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500 mb-1.5">
                {lang === "es" ? "CONTEXTO" : "CONTEXT"}
              </p>
              <p className="text-xs font-mono text-zinc-400 leading-relaxed line-clamp-3">
                {summary.context}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 border-t border-white/8 pt-4">
            {/* Retry — primary CTA for losses and all client sessions */}
            {(isLoss || role === "client") && onRetry && (
              <button
                onClick={onRetry}
                className="w-full bg-white text-black text-xs font-mono font-bold py-3 rounded-xl hover:bg-zinc-100 active:scale-[0.98] transition-all"
              >
                {role === "client" ? t.CLIENT_RETRY : t.DEBRIEF_RETRY}
              </button>
            )}
            {/* Export */}
            <button
              onClick={handleExportLog}
              className={cn(
                "w-full text-xs font-mono font-bold py-3 rounded-xl active:scale-[0.98] transition-all",
                (isLoss || role === "client") && onRetry
                  ? "border border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-white"
                  : "bg-white text-black hover:bg-zinc-100"
              )}
            >
              {t.EXPORT}
            </button>
            <button
              onClick={onExit}
              className="w-full text-center text-[10px] font-mono text-zinc-500 hover:text-zinc-200 py-2 transition-colors"
            >
              {t.CLOSE}
            </button>
          </div>

        </div>
      </div>
    );
  }

  // ── Main Arena screen ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black flex flex-col font-mono overflow-hidden">

      {/* Outcome confirmation modal (seller mode only) */}
      {pendingOutcome && (
        <OutcomeModal
          detectedOutcome={pendingOutcome}
          lang={lang}
          onConfirm={(outcome) => void handleEnd(outcome)}
          onContinue={() => setPendingOutcome(null)}
        />
      )}

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-white/6">
        <div className="flex items-center gap-2 min-w-0">
          <WizardIcon className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
          <span className="text-[8px] tracking-[0.25em] uppercase text-zinc-400 shrink-0">Closer Wizard</span>
          <div className="w-px h-2.5 bg-zinc-800 shrink-0" />
          <span className="text-[10px] tracking-widest uppercase text-sky-400 font-semibold shrink-0">{t.ARENA}</span>
          <div className="w-px h-2.5 bg-zinc-800 shrink-0" />
          <span className="text-[8px] tracking-widest uppercase text-zinc-500 shrink-0">{roleTag}</span>
          {contextLabel && (
            <>
              <div className="w-px h-2.5 bg-zinc-800 shrink-0" />
              <span className="text-[9px] text-zinc-500 truncate">{contextLabel}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-4">
          <StateIndicator state={conversationState} lang={lang} />
          <button
            onClick={onExit}
            className="text-[9px] tracking-widest uppercase text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            {t.EXIT}
          </button>
        </div>
      </div>

      {/* ── Message list ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isStarting ? (
          <div className="flex items-center justify-center h-full gap-2 text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs tracking-widest uppercase">{t.STARTING}</span>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto flex flex-col gap-5">
            {messages.map((msg, i) => (
              <MessageRow key={i} msg={msg} youLabel={t.YOU} aiLabel={aiLabel} />
            ))}
            {isSending && (
              <div className="flex flex-col gap-1">
                <span className="text-[9px] tracking-widest uppercase text-zinc-600">{aiLabel}</span>
                <div className="flex items-center gap-1.5 text-zinc-600">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span className="text-xs">{t.SENDING}</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/6 px-4 py-3">
        <div className="max-w-2xl mx-auto flex flex-col gap-2">
          {/* Client mode: outcome shortcuts OR exit panel */}
          {role === "client" && !isStarting && messages.length >= 2 && (
            exitStep !== null ? (
              <div className="flex flex-col gap-2 px-3 py-3 bg-zinc-950 border border-zinc-800 rounded-xl">
                {exitStep === "outcomes" ? (
                  /* Step 1 — choose outcome */
                  <>
                    <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.CLIENT_EXIT_TITLE}</p>
                    <div className="flex flex-col gap-1.5">
                      <button
                        onClick={() => void handleClientExit("closed")}
                        disabled={isEnding}
                        className="w-full py-2 rounded-lg border text-[10px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-emerald-400 border-emerald-400/30 hover:border-emerald-400/60 hover:bg-emerald-400/5"
                      >
                        {isEnding ? <Loader2 className="w-3 h-3 animate-spin inline" /> : t.CLIENT_EXIT_CONVINCED}
                      </button>
                      <button
                        onClick={() => setExitStep("reason")}
                        disabled={isEnding}
                        className="w-full py-2 rounded-lg border text-[10px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-amber-400 border-amber-400/30 hover:border-amber-400/60 hover:bg-amber-400/5"
                      >
                        {t.CLIENT_EXIT_LOST}
                      </button>
                      <button
                        onClick={() => void handleClientExit("manual_stop")}
                        disabled={isEnding}
                        className="w-full py-2 rounded-lg border text-[10px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-zinc-400 border-zinc-700 hover:border-zinc-500"
                      >
                        {t.CLIENT_EXIT_QUIT}
                      </button>
                    </div>
                    <button
                      onClick={() => setExitStep(null)}
                      className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors text-center"
                    >
                      ✕ cancelar
                    </button>
                  </>
                ) : (
                  /* Step 2 — reason for "lost" */
                  <>
                    <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.CLIENT_EXIT_REASON_TITLE}</p>
                    <textarea
                      value={pendingExitReason}
                      onChange={e => setPendingExitReason(e.target.value)}
                      onKeyDown={e => { if (e.key === "Escape") setExitStep("outcomes"); }}
                      placeholder={t.CLIENT_EXIT_REASON_PH}
                      autoFocus
                      rows={2}
                      className="w-full bg-transparent border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setExitStep("outcomes")}
                        className="px-3 py-1.5 rounded-lg border text-[10px] font-mono tracking-wide transition-all text-zinc-500 border-zinc-800 hover:border-zinc-600 hover:text-zinc-300"
                      >
                        {t.CLIENT_EXIT_BACK}
                      </button>
                      <button
                        onClick={() => void handleClientExit("lost")}
                        disabled={isEnding}
                        className="flex-1 py-1.5 rounded-lg border text-[10px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-amber-400 border-amber-400/30 hover:border-amber-400/60 hover:bg-amber-400/5"
                      >
                        {isEnding ? <Loader2 className="w-3 h-3 animate-spin inline" /> : t.CLIENT_EXIT_CONFIRM}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <ClientOutcomeBar
                lang={lang}
                disabled={isEnding || isSending}
                onShortcut={(text) => void sendMessage(text)}
                onEndChat={() => setExitStep("outcomes")}
              />
            )
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.PLACEHOLDER}
            rows={2}
            disabled={isStarting || isSending}
            autoFocus
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors resize-none leading-relaxed disabled:opacity-40"
          />

          {/* Footer row: hint + end session */}
          <div className="flex justify-between items-center">
            <p className="text-[9px] text-zinc-600 tracking-widest">
              {lang === "es" ? "Enter envía · Shift+Enter nueva línea" : "Enter sends · Shift+Enter new line"}
            </p>
            {role === "seller" && (
              <button
                onClick={() => void handleEnd("manual_stop")}
                disabled={isEnding || isStarting || messages.length < 2}
                className="text-[9px] font-mono tracking-widest uppercase text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                {isEnding ? <Loader2 className="w-3 h-3 animate-spin inline" /> : t.END}
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

// ── Message row ───────────────────────────────────────────────────────────────
function MessageRow({
  msg,
  youLabel,
  aiLabel,
}: {
  msg: ArenaMessage;
  youLabel: string;
  aiLabel: string;
}) {
  const isUser = msg.speaker === "user";
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <span className={cn(
        "text-[9px] tracking-widest uppercase",
        isUser ? "text-zinc-500" : "text-sky-700"
      )}>
        {isUser ? youLabel : aiLabel}
      </span>
      <div className={cn(
        "max-w-[80%] px-4 py-2.5 rounded-xl text-sm leading-relaxed",
        isUser
          ? "bg-zinc-900 border border-zinc-700 text-white text-right"
          : "bg-transparent border border-zinc-800 text-zinc-200 text-left"
      )}>
        {msg.message}
      </div>
    </div>
  );
}
