import { useState, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, MicOff, Keyboard, Loader2, AlertCircle, ExternalLink, ChevronDown, Info } from "lucide-react";
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
  next_move?: string;
  support?: string;
}

interface Journey {
  past: string;
  now: string;
  next: string;
}

interface TacticalState {
  signal: string;
  sayNow: string;
  avoid?: string;
  detail: Detail | null;
  journey: Journey | null;
  callMemory: string;
}

const EMPTY_STATE: TacticalState = { signal: "", sayNow: "", avoid: undefined, detail: null, journey: null, callMemory: "" };

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

// ── Color config per detail field — colorblind-safe (blue / white / amber)
const FIELD_CONFIG = {
  LECTURA:   { label: "text-sky-400",   content: "text-sky-200",   border: "border-sky-600",   size: "text-[13px]" },
  SIGUIENTE: { label: "text-white",     content: "text-white",     border: "border-white/70",  size: "text-[15px]" },
  APOYO:     { label: "text-amber-400", content: "text-amber-200", border: "border-amber-600", size: "text-[13px]" },
} as const;

type FieldKey = keyof typeof FIELD_CONFIG;

function DetailField({ fieldKey, value }: { fieldKey: FieldKey; value?: string }) {
  if (!value) return null;
  const cfg = FIELD_CONFIG[fieldKey];
  const label = fieldKey === "SIGUIENTE" ? "SIGUIENTE MOVIMIENTO" : fieldKey;
  return (
    <div className="w-full flex flex-col items-center gap-2 text-center">
      <span className={cn("text-[9px] font-mono tracking-[0.22em] uppercase", cfg.label)}>{label}</span>
      <p className={cn(
        "font-mono leading-relaxed text-center w-full",
        cfg.size,
        cfg.content,
        fieldKey === "SIGUIENTE" && "font-medium",
      )}>{value}</p>
    </div>
  );
}

// ── Detail panel — 3 fields, full-width centered
function DetailPanel({ detail }: { detail: Detail }) {
  return (
    <div className="px-8 py-5 flex flex-col items-center gap-6 w-full max-w-2xl mx-auto">
      {detail.reading   && <DetailField fieldKey="LECTURA"   value={detail.reading} />}
      {detail.next_move && <DetailField fieldKey="SIGUIENTE" value={detail.next_move} />}
      {detail.support   && <DetailField fieldKey="APOYO"     value={detail.support} />}
    </div>
  );
}

// ── Memory bullets — scannable list for expanded journey view
function MemoryBullets({ lines }: { lines: string[] }) {
  const visible = lines.slice(-8);
  return (
    <ul className="px-5 py-3 space-y-2">
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

// ── Conversation timeline — 3 connected nodes embedded in HUD
function ConversationTimeline({ journey, memoryLines }: { journey: Journey; memoryLines: string[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="shrink-0">
      {/* Compact 3-node row */}
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-start justify-center gap-0 pt-3 pb-2 px-4 group"
        title={expanded ? "Cerrar historial" : "Ver historial completo"}
      >
        {/* ANTES node */}
        <div className="flex flex-col items-center gap-1.5 w-24">
          <div className="w-2 h-2 rounded-full bg-zinc-600 group-hover:bg-zinc-500 transition-colors" />
          <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider text-center leading-tight line-clamp-2">
            {journey.past}
          </span>
        </div>

        {/* Left connector */}
        <div className="h-px w-6 bg-zinc-700 mt-[4px] shrink-0" />

        {/* AHORA node — bright */}
        <div className="flex flex-col items-center gap-1.5 w-28">
          <div className="w-2.5 h-2.5 rounded-full bg-white" />
          <span className="text-[9px] font-mono text-zinc-100 uppercase tracking-wider text-center leading-tight font-medium line-clamp-2">
            {journey.now}
          </span>
        </div>

        {/* Right connector */}
        <div className="h-px w-6 bg-zinc-700 mt-[4px] shrink-0" />

        {/* DESPUÉS node — dashed future */}
        <div className="flex flex-col items-center gap-1.5 w-24">
          <div className="w-2 h-2 rounded-full border border-zinc-500 bg-transparent" />
          <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider text-center leading-tight line-clamp-2">
            {journey.next}
          </span>
        </div>
      </button>

      {/* Expanded — full memory bullets */}
      <AnimatePresence>
        {expanded && memoryLines.length > 0 && (
          <motion.div
            key="memory-expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: { duration: 0.22 } }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
            className="overflow-hidden border-t border-white/5"
          >
            <MemoryBullets lines={memoryLines} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function CopilotPage() {
  const [inputMode, setInputMode] = useState<InputMode>("simulate");
  const [speakerMode, setSpeakerMode] = useState<SpeakerMode>("auto");
  const [simulateText, setSimulateText] = useState("");
  const [sessionContext, setSessionContext] = useState<string | null>(loadSession);
  const [tacticalState, setTacticalState] = useState<TacticalState>(EMPTY_STATE);
  const [contextLabel, setContextLabel] = useState<string>(loadLabel);

  // Panel state
  const [detailOpen, setDetailOpen] = useState(false);

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
              avoid: res.avoid || undefined,
              detail: res.detail ?? null,
              journey: res.journey ?? null,
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
    setDetailOpen(false);
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
    setDetailOpen(false);
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
  const hasJourney = !!tacticalState.journey;
  const memoryLines = tacticalState.callMemory
    ? tacticalState.callMemory.split(/\\n|\n/).filter(Boolean)
    : [];
  const handleToggleDetail = () => setDetailOpen(p => !p);

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
      <div className="flex-1 min-h-[220px] relative flex flex-col">

        {/* Journey timeline — compact 3-node, only when data exists */}
        {hasJourney && (
          <ConversationTimeline
            journey={tacticalState.journey!}
            memoryLines={memoryLines}
          />
        )}

        {/* Tactical display takes remaining space */}
        <div className="flex-1 relative">
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
        </div>{/* end flex-1 relative (tactical display) */}
      </div>{/* end HUD flex-col */}

      {/* ── Detail panel — CSS transitions only, no layout bounce ── */}
      {hasDetail && (
        <div className="shrink-0">

          {/* Badge — cross-fades out as panel opens */}
          <div
            className="overflow-hidden border-t border-white/5"
            style={{
              maxHeight: detailOpen ? "0px" : "48px",
              opacity: detailOpen ? 0 : 1,
              transition: "max-height 0.22s ease, opacity 0.14s ease",
              pointerEvents: detailOpen ? "none" : "auto",
            }}
          >
            <div className="flex items-center justify-center py-2">
              <button
                onClick={handleToggleDetail}
                className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/8 text-zinc-500 hover:text-zinc-200 hover:bg-white/8 hover:border-white/15 text-[10px] font-mono tracking-widest uppercase transition-colors"
              >
                <Info className="w-3 h-3" />
                Detalle
              </button>
            </div>
          </div>

          {/* Full content — slides down when open, click anywhere to close */}
          <div
            onClick={handleToggleDetail}
            className="overflow-hidden border-t border-white/5 cursor-pointer select-none"
            style={{
              maxHeight: detailOpen ? "260px" : "0px",
              transition: "max-height 0.22s ease",
            }}
          >
            <div className="flex items-center justify-center py-1.5 text-zinc-700">
              <ChevronDown className="w-3.5 h-3.5" />
            </div>
            <div className="overflow-y-auto border-t border-white/5" style={{ maxHeight: "240px" }}>
              <DetailPanel detail={tacticalState.detail!} />
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
