import { useState, useCallback, useEffect, useRef } from "react";
import { Mic, MicOff, Keyboard, Loader2, AlertCircle, ExternalLink } from "lucide-react";
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
  question?: string;
  risk?: string;
  support?: string;
}

interface TacticalState {
  signal: string;
  sayNow: string;
  avoid: string;
  detail: Detail | null;
}

const EMPTY_STATE: TacticalState = { signal: "", sayNow: "", avoid: "", detail: null };

export default function CopilotPage() {
  const [inputMode, setInputMode] = useState<InputMode>("simulate");
  const [speakerMode, setSpeakerMode] = useState<SpeakerMode>("auto");
  const [simulateText, setSimulateText] = useState("");
  const [sessionContext, setSessionContext] = useState<string | null>(null);
  const [tacticalState, setTacticalState] = useState<TacticalState>(EMPTY_STATE);
  // Mini call map: last 5 signals
  const [signalHistory, setSignalHistory] = useState<string[]>([]);

  const sessionActive = sessionContext !== null;
  const speakerModeRef = useRef(speakerMode);
  speakerModeRef.current = speakerMode;

  const { mutate: analyze, isPending } = useAnalyzeConversation();

  const handleAnalysis = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const speaker = speakerModeRef.current;
      const speakerPrefix =
        speaker === "client" ? "[CLIENTE]: " :
        speaker === "me"     ? "[YO]: " : "";
      const fullText = speakerPrefix + text;

      analyze(
        { data: { text: fullText, ...(sessionContext ? { context: sessionContext } : {}) } },
        {
          onSuccess: (res) => {
            setTacticalState({
              signal: res.signal,
              sayNow: res.say_now,
              avoid: res.avoid,
              detail: res.detail ?? null,
            });
            if (res.signal) {
              setSignalHistory((prev) => [...prev.slice(-4), res.signal]);
            }
          },
        }
      );
    },
    [analyze, sessionContext]
  );

  const { isSupported, isListening, error: speechError, interimText, startListening, stopListening } =
    useSpeech({ onAnalyzeReady: handleAnalysis, analysisIntervalMs: 8000 });

  // ── Keyboard shortcuts (only when session active, not in text inputs) ────────
  useEffect(() => {
    if (!sessionActive) return;

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      const idx = SPEAKER_ORDER.indexOf(speakerModeRef.current);

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSpeakerMode(SPEAKER_ORDER[Math.max(0, idx - 1)]);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSpeakerMode(SPEAKER_ORDER[Math.min(SPEAKER_ORDER.length - 1, idx + 1)]);
      } else if (e.key === " ") {
        e.preventDefault();
        setSpeakerMode(SPEAKER_ORDER[(idx + 1) % SPEAKER_ORDER.length]);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionActive]);

  const handleContextReady = (context: string) => {
    setSessionContext(context);
    setTacticalState(EMPTY_STATE);
    setSignalHistory([]);
  };

  const handleClearSession = () => {
    setSessionContext(null);
    setTacticalState(EMPTY_STATE);
    setSignalHistory([]);
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

  // ── SETUP SCREEN ────────────────────────────────────────────────────────────
  if (sessionContext === null) {
    return <ContextSetup onContextReady={handleContextReady} />;
  }

  // ── ACTIVE SESSION ───────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black text-foreground flex flex-col overflow-hidden font-sans">

      {/* Compact session bar */}
      <SessionBar sessionContext={sessionContext} onClearSession={handleClearSession} />

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

      {/* Call map — top left, only when there's history */}
      {signalHistory.length > 0 && (
        <div className="absolute top-10 left-5 z-10 flex items-center gap-1.5 max-w-[40%]">
          <span className="text-[9px] font-mono tracking-widest uppercase text-zinc-800 shrink-0">señales</span>
          <div className="flex items-center gap-1 flex-wrap">
            {signalHistory.map((s, i) => (
              <span
                key={i}
                className={cn(
                  "text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded",
                  i === signalHistory.length - 1
                    ? "text-zinc-500 bg-white/5"
                    : "text-zinc-800"
                )}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Main HUD */}
      <div className="flex-1 min-h-0 relative">
        <TacticalDisplay
          signal={tacticalState.signal}
          sayNow={tacticalState.sayNow}
          avoid={tacticalState.avoid}
          detail={tacticalState.detail}
          isPending={isPending}
        />

        {/* Interim text */}
        {inputMode === "listen" && isListening && interimText && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-xl w-full px-6 text-center pointer-events-none">
            <p className="text-[11px] text-zinc-700 font-mono truncate">{interimText}</p>
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
              <p className="text-[10px] text-zinc-600 font-mono text-center">
                O usa el modo Simular para probar la IA ahora
              </p>
            </div>
          </div>
        )}

        {/* Browser not supported */}
        {inputMode === "listen" && !isSupported && !speechError && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 max-w-sm w-full">
              <p className="text-xs font-mono text-zinc-400 text-center leading-relaxed">
                Tu navegador no soporta reconocimiento de voz.<br />
                Usa Chrome o Edge.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Controls — bottom bar */}
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
                inputMode === "listen" ? "bg-white text-black shadow" : "text-zinc-500 hover:text-white"
              )}
            >
              {isListening ? <Mic className="w-3 h-3 text-red-500" /> : <MicOff className="w-3 h-3" />}
              ESCUCHAR
            </button>
            <button
              onClick={() => handleModeSwitch("simulate")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono font-medium transition-all",
                inputMode === "simulate" ? "bg-white text-black shadow" : "text-zinc-500 hover:text-white"
              )}
            >
              <Keyboard className="w-3 h-3" />
              SIMULAR
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
                  speakerMode === s ? "bg-white/15 text-white" : "text-zinc-600 hover:text-zinc-400"
                )}
              >
                {SPEAKER_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Keyboard hint */}
        <p className="text-[9px] font-mono text-zinc-800 tracking-widest">
          ← → cambia hablante · espacio cicla
        </p>
      </div>
    </div>
  );
}
