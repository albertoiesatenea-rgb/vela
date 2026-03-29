import { useState, useCallback, useEffect, useRef } from "react";
import { Mic, MicOff, Keyboard, Loader2, AlertCircle, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { useAnalyzeConversation } from "@workspace/api-client-react";
import { useSpeech } from "@/hooks/use-speech";
import { TacticalDisplay } from "@/components/tactical-display";
import { ContextSetup, SessionBar } from "@/components/context-panel";
import { cn } from "@/lib/utils";

type InputMode = "listen" | "simulate";
type SpeakerMode = "auto" | "client" | "me";

const SPEAKER_LABELS: Record<SpeakerMode, string> = {
  auto: "AUTO",
  client: "CLIENTE",
  me: "YO",
};
const SPEAKER_ORDER: SpeakerMode[] = ["auto", "client", "me"];

interface Detail {
  reading?: string;
  argument?: string;
  talk_track?: string;
  question?: string;
  risk?: string;
  support?: string;
}

interface TacticalState {
  signal: string;
  sayNow: string;
  avoid: string;
  detail: Detail | null;
  callMemory: string;
}

const EMPTY_STATE: TacticalState = { signal: "", sayNow: "", avoid: "", detail: null, callMemory: "" };

const SESSION_KEY = "sc_session_context";
const LABEL_KEY   = "sc_context_label";

function loadSession(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}
function saveSession(ctx: string | null) {
  try {
    if (ctx === null) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, ctx);
  } catch { /* ignore */ }
}
function loadLabel(): string {
  try { return localStorage.getItem(LABEL_KEY) ?? ""; } catch { return ""; }
}
function saveLabel(l: string) {
  try {
    if (!l) localStorage.removeItem(LABEL_KEY);
    else localStorage.setItem(LABEL_KEY, l);
  } catch { /* ignore */ }
}

// ── Color config per detail field
const FIELD_CONFIG = {
  LECTURA:    { label: "text-zinc-400",    content: "text-zinc-300",   border: "border-zinc-600",    size: "text-xs" },
  ARGUMENTO:  { label: "text-blue-400",    content: "text-blue-100",   border: "border-blue-600",    size: "text-xs" },
  GUION:      { label: "text-zinc-300",    content: "text-white",      border: "border-zinc-400",    size: "text-[13px]" },
  PREGUNTA:   { label: "text-amber-400",   content: "text-amber-100",  border: "border-amber-600",   size: "text-[13px]" },
  RIESGO:     { label: "text-red-400",     content: "text-red-200",    border: "border-red-700",     size: "text-xs" },
  APOYO:      { label: "text-emerald-400", content: "text-emerald-100",border: "border-emerald-700", size: "text-xs" },
} as const;

type FieldKey = keyof typeof FIELD_CONFIG;

function DetailField({ fieldKey, value }: { fieldKey: FieldKey; value?: string }) {
  if (!value) return null;
  const cfg = FIELD_CONFIG[fieldKey];
  const isGuion = fieldKey === "GUION";
  return (
    <div className={cn("pl-3 border-l-2 flex flex-col gap-1", cfg.border)}>
      <span className={cn("text-[8px] font-mono tracking-[0.22em] uppercase", cfg.label)}>{fieldKey}</span>
      <p className={cn(
        "font-mono leading-snug line-clamp-2",
        cfg.size,
        cfg.content,
        isGuion && "italic",
      )}>{value}</p>
    </div>
  );
}

// ── Detail panel — readable grid with breathing room
function DetailPanel({ detail }: { detail: Detail }) {
  return (
    <div className="px-5 py-3.5 grid grid-cols-2 gap-x-5 gap-y-3.5">
      {detail.reading   && <DetailField fieldKey="LECTURA"   value={detail.reading} />}
      {detail.argument  && <DetailField fieldKey="ARGUMENTO" value={detail.argument} />}
      {detail.talk_track && (
        <div className="col-span-2">
          <DetailField fieldKey="GUION" value={detail.talk_track} />
        </div>
      )}
      {detail.question && (
        <div className="col-span-2">
          <DetailField fieldKey="PREGUNTA" value={detail.question} />
        </div>
      )}
      {detail.risk    && <DetailField fieldKey="RIESGO" value={detail.risk} />}
      {detail.support && <DetailField fieldKey="APOYO"  value={detail.support} />}
    </div>
  );
}

// ── Memory panel — scannable bullets
function MemoryPanel({ lines }: { lines: string[] }) {
  const visible = lines.slice(-6);
  return (
    <ul className="px-5 py-3.5 space-y-2.5">
      {visible.map((line, i) => {
        const text = line.replace(/^[-–—]\s*/, "");
        const isLast = i === visible.length - 1;
        return (
          <li key={i} className="flex items-start gap-3">
            <span className={cn(
              "shrink-0 mt-[5px] w-1.5 h-1.5 rounded-full",
              isLast ? "bg-zinc-200" : "bg-zinc-600"
            )} />
            <span className={cn(
              "text-[12px] font-mono leading-snug",
              isLast ? "text-zinc-200 font-medium" : "text-zinc-500"
            )}>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function CopilotPage() {
  const [inputMode, setInputMode] = useState<InputMode>("simulate");
  const [speakerMode, setSpeakerMode] = useState<SpeakerMode>("auto");
  const [simulateText, setSimulateText] = useState("");
  const [sessionContext, setSessionContext] = useState<string | null>(loadSession);
  const [tacticalState, setTacticalState] = useState<TacticalState>(EMPTY_STATE);
  const [contextLabel, setContextLabel] = useState<string>(loadLabel);

  // Panel state — independent toggles, can both be open simultaneously
  const [detailOpen, setDetailOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);

  const sessionActive = sessionContext !== null;
  const speakerModeRef = useRef(speakerMode);
  speakerModeRef.current = speakerMode;

  const { mutate: analyze, isPending } = useAnalyzeConversation();

  const callMemoryRef = useRef(tacticalState.callMemory);
  callMemoryRef.current = tacticalState.callMemory;

  const handleAnalysis = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const speaker = speakerModeRef.current;
      const speakerPrefix =
        speaker === "client" ? "[CLIENTE]: " :
        speaker === "me"     ? "[YO]: " : "";
      const fullText = speakerPrefix + text;

      analyze(
        {
          data: {
            text: fullText,
            ...(sessionContext ? { context: sessionContext } : {}),
            ...(callMemoryRef.current ? { call_memory: callMemoryRef.current } : {}),
          },
        },
        {
          onSuccess: (res) => {
            setTacticalState({
              signal: res.signal,
              sayNow: res.say_now,
              avoid: res.avoid,
              detail: res.detail ?? null,
              callMemory: res.call_memory ?? "",
            });
          },
        }
      );
    },
    [analyze, sessionContext]
  );

  const { isSupported, isListening, error: speechError, interimText, startListening, stopListening } =
    useSpeech({ onAnalyzeReady: handleAnalysis, analysisIntervalMs: 8000 });

  // Keyboard shortcuts
  useEffect(() => {
    if (!sessionActive) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "button") return;
      const idx = SPEAKER_ORDER.indexOf(speakerModeRef.current);
      if (e.key === "ArrowLeft") { e.preventDefault(); setSpeakerMode(SPEAKER_ORDER[Math.max(0, idx - 1)]); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setSpeakerMode(SPEAKER_ORDER[Math.min(SPEAKER_ORDER.length - 1, idx + 1)]); }
      else if (e.key === " ") { e.preventDefault(); setSpeakerMode(SPEAKER_ORDER[(idx + 1) % SPEAKER_ORDER.length]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionActive]);

  const handleContextReady = (context: string) => {
    setSessionContext(context);
    saveSession(context);
    setTacticalState(EMPTY_STATE);
    setContextLabel("");
    saveLabel("");
    setActivePanel(null);
    // Generate short context label in background
    void fetch("/api/copilot/context-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    })
      .then(r => r.json())
      .then(({ label }: { label: string }) => {
        if (label) { setContextLabel(label); saveLabel(label); }
      })
      .catch(() => {});
  };

  const handleClearSession = () => {
    setSessionContext(null);
    saveSession(null);
    setTacticalState(EMPTY_STATE);
    setContextLabel("");
    saveLabel("");
    setActivePanel(null);
    if (isListening) stopListening();
    setInputMode("simulate");
    setSpeakerMode("auto");
  };

  const handleModeSwitch = (newMode: InputMode) => {
    if (newMode === "simulate" && isListening) stopListening();
    setInputMode(newMode);
  };

  const handleMicToggle = () => {
    if (isListening) stopListening();
    else startListening();
  };

  const handleSimulateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAnalysis(simulateText);
    setSimulateText("");
  };

  // Setup screen
  if (sessionContext === null) {
    return <ContextSetup onContextReady={handleContextReady} />;
  }

  // Derived panel data
  const hasDetail = !!(tacticalState.detail && Object.values(tacticalState.detail).some(Boolean));
  const memoryLines = tacticalState.callMemory
    ? tacticalState.callMemory.split(/\\n|\n/).filter(Boolean)
    : [];
  const hasMemory = memoryLines.length > 0;
  const detailVisible = detailOpen && hasDetail;
  const memoryVisible = memoryOpen && hasMemory;

  const handleToggleDetail = () => setDetailOpen(p => !p);
  const handleToggleMemory = () => setMemoryOpen(p => !p);

  // Active session layout
  return (
    <div className="fixed inset-0 bg-black text-foreground flex flex-col overflow-hidden font-sans">

      {/* Compact session bar */}
      <SessionBar sessionContext={sessionContext} contextLabel={contextLabel} onClearSession={handleClearSession} />

      {/* Status pill — top right */}
      <div className="absolute top-10 right-5 flex items-center gap-3 z-10">
        {isPending && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[10px] font-mono tracking-widest uppercase">Analizando</span>
          </div>
        )}
        {inputMode === "listen" && !speechError && (
          <div
            onClick={handleMicToggle}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-full transition-colors cursor-pointer",
              isListening ? "bg-red-500/10 text-red-400" : "text-muted-foreground"
            )}
          >
            <div className={cn("w-2 h-2 rounded-full", isListening ? "bg-red-500 animate-pulse" : "bg-zinc-600")} />
            <span className="text-[10px] font-mono tracking-widest uppercase">
              {isListening ? "Escuchando" : "Pausado"}
            </span>
          </div>
        )}
      </div>


      {/* ── Main HUD — flexible, shrinks to give panel room ── */}
      <div className="flex-1 min-h-[220px] relative">
        <TacticalDisplay
          signal={tacticalState.signal}
          sayNow={tacticalState.sayNow}
          avoid={tacticalState.avoid}
          isPending={isPending}
          isListening={isListening}
        />

        {/* Interim speech text */}
        {inputMode === "listen" && isListening && interimText && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-xl w-full px-6 text-center pointer-events-none">
            <p className="text-[11px] text-zinc-200 font-mono truncate">{interimText}</p>
          </div>
        )}

        {/* Mic error overlay */}
        {inputMode === "listen" && speechError && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="flex flex-col gap-3 bg-zinc-900 border border-white/10 rounded-2xl p-5 shadow-xl max-w-sm w-full">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs font-mono text-zinc-300 leading-relaxed">{speechError}</p>
              </div>
              <button
                onClick={() => window.open(window.location.href, "_blank")}
                className="flex items-center justify-center gap-2 text-xs font-mono text-black bg-white rounded-xl px-4 py-2.5 hover:bg-zinc-200 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Abrir en pestaña separada
              </button>
              <p className="text-[10px] text-zinc-200 font-mono text-center">
                O usa el modo Simular para probar la IA ahora
              </p>
            </div>
          </div>
        )}

        {/* Browser not supported */}
        {inputMode === "listen" && !isSupported && !speechError && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 max-w-sm w-full">
              <p className="text-xs font-mono text-zinc-200 text-center leading-relaxed">
                Tu navegador no soporta reconocimiento de voz.<br />
                Usa Chrome o Edge.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Panel zone — independent toggles, both can be open ── */}
      {(hasDetail || hasMemory) && (
        <div className="shrink-0 border-t border-white/5">

          {/* Toggle row — independent buttons, more breathing room */}
          <div className="flex items-center justify-center gap-12 py-3">
            {hasDetail && (
              <button
                onClick={handleToggleDetail}
                className="flex items-center gap-2 text-[11px] font-mono tracking-widest uppercase transition-colors hover:text-white"
                style={{ color: detailVisible ? "rgb(228 228 231)" : "rgb(82 82 91)" }}
              >
                {detailVisible ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Detalle
              </button>
            )}
            {hasMemory && (
              <button
                onClick={handleToggleMemory}
                className="flex items-center gap-2 text-[11px] font-mono tracking-widest uppercase transition-colors hover:text-white"
                style={{ color: memoryVisible ? "rgb(228 228 231)" : "rgb(82 82 91)" }}
              >
                {memoryVisible ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Memoria
              </button>
            )}
          </div>

          {/* Detalle — independently animated, scrollable internally */}
          <div
            className="overflow-hidden"
            style={{
              maxHeight: detailVisible ? "164px" : "0px",
              transition: "max-height 0.22s ease",
            }}
          >
            <div className="border-t border-white/5 overflow-y-auto" style={{ maxHeight: "164px" }}>
              {hasDetail && <DetailPanel detail={tacticalState.detail!} />}
            </div>
          </div>

          {/* Memoria — independently animated, scrollable internally */}
          <div
            className="overflow-hidden"
            style={{
              maxHeight: memoryVisible ? "152px" : "0px",
              transition: "max-height 0.22s ease",
            }}
          >
            <div className="border-t border-white/5 overflow-y-auto" style={{ maxHeight: "152px" }}>
              {hasMemory && <MemoryPanel lines={memoryLines} />}
            </div>
          </div>

        </div>
      )}

      {/* ── Controls — bottom bar ─────────────────── */}
      <div className="shrink-0 border-t border-white/5 bg-black px-6 py-4 flex flex-col items-center gap-3">

        {/* Simulate textarea */}
        {inputMode === "simulate" && (
          <form onSubmit={handleSimulateSubmit} className="w-full max-w-2xl flex items-stretch gap-2">
            <textarea
              value={simulateText}
              onChange={(e) => setSimulateText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSimulateSubmit(e as any);
                }
              }}
              placeholder="Pega un fragmento de la conversación..."
              rows={2}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono resize-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={!simulateText.trim() || isPending}
              className="bg-white text-black px-5 rounded-xl font-mono text-xs font-semibold tracking-widest uppercase hover:bg-zinc-200 active:scale-95 disabled:opacity-40 transition-all flex items-center justify-center gap-2 min-w-[90px]"
            >
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Analizar"}
            </button>
          </form>
        )}

        {/* Listen mic button */}
        {inputMode === "listen" && isSupported && !speechError && (
          <button
            onClick={handleMicToggle}
            className={cn(
              "px-6 py-2.5 rounded-full font-mono text-xs font-semibold tracking-widest uppercase transition-all flex items-center gap-2",
              isListening
                ? "bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25"
                : "bg-white/8 text-white border border-white/15 hover:bg-white/15"
            )}
          >
            {isListening
              ? <><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />Pausar</>
              : <><Mic className="w-3.5 h-3.5" />Iniciar escucha</>}
          </button>
        )}

        {/* Bottom row: mode toggle + speaker mode */}
        <div className="flex items-center justify-center gap-3 w-full">

          {/* Input mode toggle */}
          <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/8">
            <button
              onClick={() => handleModeSwitch("listen")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono font-medium transition-all",
                inputMode === "listen" ? "bg-white text-black shadow" : "text-zinc-300 hover:text-white"
              )}
            >
              {isListening ? <Mic className="w-3 h-3 text-red-500" /> : <MicOff className="w-3 h-3" />}
              ESCUCHAR
            </button>
            <button
              onClick={() => handleModeSwitch("simulate")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono font-medium transition-all",
                inputMode === "simulate" ? "bg-white text-black shadow" : "text-zinc-300 hover:text-white"
              )}
            >
              <Keyboard className="w-3 h-3" />
              ESCRIBIR
            </button>
          </div>

          {/* Speaker mode toggle */}
          <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/8">
            {SPEAKER_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => setSpeakerMode(s)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[10px] font-mono tracking-widest transition-all",
                  speakerMode === s ? "bg-white/15 text-white" : "text-zinc-200 hover:text-zinc-100"
                )}
              >
                {SPEAKER_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Keyboard hint */}
        <p className="text-[9px] font-mono text-zinc-500 tracking-widest">
          ← → cambia hablante · espacio cicla
        </p>
      </div>
    </div>
  );
}
