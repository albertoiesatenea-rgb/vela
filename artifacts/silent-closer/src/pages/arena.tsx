import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Send } from "lucide-react";
import { WizardIcon } from "@/components/context-panel";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
export type ArenaRole = "seller" | "client";
type Lang = "es" | "en";

interface ArenaMessage {
  index: number;
  speaker: "user" | "ai";
  message: string;
}

interface ArenaSummary {
  role: ArenaRole;
  context: string;
  lang: Lang;
  totalTurns: number;
  userTurns: number;
  createdAt: string;
  closedAt: string;
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
  },
};

// ── Arena component ───────────────────────────────────────────────────────────
export function Arena({
  context,
  contextLabel,
  role,
  lang,
  onExit,
}: {
  context: string;
  contextLabel: string;
  role: ArenaRole;
  lang: Lang;
  onExit: () => void;
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const aiLabel = role === "seller" ? t.AI_AS_CLIENT : t.AI_AS_SELLER;
  const roleTag = role === "seller" ? t.ROLE_TAG_SELLER : t.ROLE_TAG_CLIENT;

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Start arena session on mount
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

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isSending || !arenaSessionId) return;

    const userMsg: ArenaMessage = { index: messages.length, speaker: "user", message: text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch("/api/arena/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arenaSessionId, userMessage: text }),
      });
      const data = await res.json() as { aiMessage: string };
      setMessages(prev => [...prev, { index: prev.length, speaker: "ai", message: data.aiMessage }]);
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
  }, [input, isSending, arenaSessionId, messages.length, lang]);

  const handleEnd = useCallback(async () => {
    if (!arenaSessionId || isEnding) return;
    setIsEnding(true);
    try {
      const res = await fetch("/api/arena/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arenaSessionId }),
      });
      const data = await res.json() as { turns: ArenaMessage[]; summary: ArenaSummary };
      setAllTurns(data.turns);
      setSummary(data.summary);
    } catch {
      // Fallback: build summary from local state
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
      });
    } finally {
      setIsEnding(false);
    }
  }, [arenaSessionId, isEnding, messages, role, context, lang]);

  const handleExportLog = () => {
    if (!summary) return;
    const isEs = lang === "es";
    const roleName = role === "seller"
      ? (isEs ? "Vendedor" : "Seller")
      : (isEs ? "Cliente" : "Client");
    const aiName = role === "seller"
      ? (isEs ? "CLIENTE" : "CLIENT")
      : (isEs ? "VENDEDOR" : "SELLER");

    const lines: string[] = [
      `CLOSER WIZARD — ARENA SESSION LOG`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `${isEs ? "Modo" : "Mode"}: ARENA`,
      `${isEs ? "Tu rol" : "Your role"}: ${roleName}`,
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
    lines.push(`${isEs ? "Turnos totales" : "Total turns"}: ${summary.totalTurns}`);
    lines.push(`${isEs ? "Tus turnos" : "Your turns"}: ${summary.userTurns}`);

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    a.download = `closer-wizard-arena-${ts}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ── Summary screen ────────────────────────────────────────────────────────
  if (summary) {
    const roleName = role === "seller"
      ? (lang === "es" ? t.ROLE_SELLER : t.ROLE_SELLER)
      : (lang === "es" ? t.ROLE_CLIENT : t.ROLE_CLIENT);
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm flex flex-col gap-6">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <WizardIcon className="w-5 h-5 text-zinc-400" />
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-zinc-400">Closer Wizard</span>
            <span className="text-zinc-700 text-[10px]">·</span>
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-zinc-500">{t.ARENA}</span>
          </div>

          {/* Title */}
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">{t.SUMMARY_TITLE}</p>
            <p className="text-2xl font-mono font-bold text-white leading-tight">
              {summary.userTurns} {t.TURNS.toLowerCase()}
            </p>
          </div>

          {/* Stats */}
          <div className="flex gap-6 border-t border-white/8 pt-4">
            <div className="flex flex-col gap-0.5">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.ROLE_USED}</p>
              <p className="text-sm font-mono font-semibold text-white uppercase">{roleName}</p>
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.TOTAL}</p>
              <p className="text-sm font-mono font-semibold text-white">{summary.totalTurns}</p>
            </div>
          </div>

          {/* Context preview */}
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
            <button
              onClick={handleExportLog}
              className="w-full bg-white text-black text-xs font-mono font-bold py-3 rounded-xl hover:bg-zinc-100 active:scale-[0.98] transition-all"
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

  // ── Main Arena screen ─────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black flex flex-col font-mono overflow-hidden">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
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
        <button
          onClick={onExit}
          className="shrink-0 text-[9px] tracking-widest uppercase text-zinc-500 hover:text-zinc-200 transition-colors ml-4"
        >
          {t.EXIT}
        </button>
      </div>

      {/* ── Message list ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isStarting ? (
          <div className="flex items-center justify-center h-full gap-2 text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs tracking-widest uppercase">{t.STARTING}</span>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto flex flex-col gap-5">
            {messages.map((msg, i) => (
              <MessageRow
                key={i}
                msg={msg}
                youLabel={t.YOU}
                aiLabel={aiLabel}
              />
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

      {/* ── Input area ───────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/6 px-4 py-3">
        <div className="max-w-2xl mx-auto flex flex-col gap-2">
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.PLACEHOLDER}
              rows={2}
              disabled={isStarting || isSending}
              autoFocus
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors resize-none leading-relaxed disabled:opacity-40"
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || isSending || isStarting || !arenaSessionId}
              className="shrink-0 flex items-center justify-center w-10 h-10 bg-white text-black rounded-xl hover:bg-zinc-100 active:scale-[0.97] transition-all disabled:opacity-30 disabled:pointer-events-none self-end"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="flex justify-between items-center">
            <p className="text-[9px] text-zinc-600 tracking-widest">
              {lang === "es" ? "Enter envía · Shift+Enter nueva línea" : "Enter sends · Shift+Enter new line"}
            </p>
            <button
              onClick={() => void handleEnd()}
              disabled={isEnding || isStarting || messages.length < 2}
              className="text-[9px] font-mono tracking-widest uppercase text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              {isEnding ? <Loader2 className="w-3 h-3 animate-spin inline" /> : t.END}
            </button>
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
