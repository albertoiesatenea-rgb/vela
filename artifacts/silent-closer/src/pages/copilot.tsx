import { useState, useCallback } from "react";
import { Mic, MicOff, Keyboard, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { useAnalyzeConversation } from "@workspace/api-client-react";
import { useSpeech } from "@/hooks/use-speech";
import { TacticalDisplay } from "@/components/tactical-display";
import { ContextSetup, SessionBar } from "@/components/context-panel";
import { cn } from "@/lib/utils";

type Mode = "listen" | "simulate";

export default function CopilotPage() {
  const [mode, setMode] = useState<Mode>("simulate");
  const [simulateText, setSimulateText] = useState("");
  // null = setup screen; string = active session (may be empty string = no context)
  const [sessionContext, setSessionContext] = useState<string | null>(null);

  const [tacticalState, setTacticalState] = useState({
    signal: "",
    sayNow: "",
    avoid: "",
  });

  const { mutate: analyze, isPending } = useAnalyzeConversation();

  const handleAnalysis = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      analyze(
        { data: { text, ...(sessionContext ? { context: sessionContext } : {}) } },
        {
          onSuccess: (res) => {
            setTacticalState({ signal: res.signal, sayNow: res.say_now, avoid: res.avoid });
          },
        }
      );
    },
    [analyze, sessionContext]
  );

  const { isSupported, isListening, error: speechError, interimText, startListening, stopListening } =
    useSpeech({ onAnalyzeReady: handleAnalysis, analysisIntervalMs: 8000 });

  const handleContextReady = (context: string) => {
    setSessionContext(context);
    setTacticalState({ signal: "", sayNow: "", avoid: "" });
  };

  const handleClearSession = () => {
    setSessionContext(null);
    setTacticalState({ signal: "", sayNow: "", avoid: "" });
    if (isListening) stopListening();
    setMode("simulate");
  };

  const handleModeSwitch = (newMode: Mode) => {
    if (newMode === "simulate" && isListening) stopListening();
    setMode(newMode);
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
        {mode === "listen" && !speechError && (
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

      {/* Main HUD — fills all space between bar and controls */}
      <div className="flex-1 min-h-0 relative">
        <TacticalDisplay
          signal={tacticalState.signal}
          sayNow={tacticalState.sayNow}
          avoid={tacticalState.avoid}
          isPending={isPending}
        />

        {/* Interim text */}
        {mode === "listen" && isListening && interimText && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-xl w-full px-6 text-center pointer-events-none">
            <p className="text-[11px] text-zinc-700 font-mono truncate">{interimText}</p>
          </div>
        )}

        {/* Mic error overlay */}
        {mode === "listen" && speechError && (
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
        {mode === "listen" && !isSupported && !speechError && (
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

      {/* Controls — solid bottom bar */}
      <div className="shrink-0 border-t border-white/5 bg-black px-6 py-4 flex flex-col items-center gap-3">

        {/* Simulate textarea */}
        {mode === "simulate" && (
          <form
            onSubmit={handleSimulateSubmit}
            className="w-full max-w-2xl flex items-stretch gap-2"
          >
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
              {isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : "Analizar"}
            </button>
          </form>
        )}

        {/* Listen mic button */}
        {mode === "listen" && isSupported && !speechError && (
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

        {/* Mode toggle */}
        <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/8">
          <button
            onClick={() => handleModeSwitch("listen")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono font-medium transition-all",
              mode === "listen" ? "bg-white text-black shadow" : "text-zinc-500 hover:text-white"
            )}
          >
            {isListening ? <Mic className="w-3 h-3 text-red-500" /> : <MicOff className="w-3 h-3" />}
            ESCUCHAR
          </button>
          <button
            onClick={() => handleModeSwitch("simulate")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono font-medium transition-all",
              mode === "simulate" ? "bg-white text-black shadow" : "text-zinc-500 hover:text-white"
            )}
          >
            <Keyboard className="w-3 h-3" />
            SIMULAR
          </button>
        </div>
      </div>
    </div>
  );
}
