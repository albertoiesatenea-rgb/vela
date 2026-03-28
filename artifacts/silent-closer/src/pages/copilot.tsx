import { useState, useCallback } from "react";
import { Mic, MicOff, Keyboard, Play, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { useAnalyzeConversation } from "@workspace/api-client-react";
import { useSpeech } from "@/hooks/use-speech";
import { TacticalDisplay } from "@/components/tactical-display";
import { ContextPanel } from "@/components/context-panel";
import { cn } from "@/lib/utils";

type Mode = "listen" | "simulate";

export default function CopilotPage() {
  const [mode, setMode] = useState<Mode>("simulate");
  const [simulateText, setSimulateText] = useState("");
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
        {
          data: {
            text,
            ...(sessionContext ? { context: sessionContext } : {}),
          },
        },
        {
          onSuccess: (res) => {
            setTacticalState({
              signal: res.signal,
              sayNow: res.say_now,
              avoid: res.avoid,
            });
          },
        }
      );
    },
    [analyze, sessionContext]
  );

  const {
    isSupported,
    isListening,
    error: speechError,
    interimText,
    startListening,
    stopListening,
  } = useSpeech({
    onAnalyzeReady: handleAnalysis,
    analysisIntervalMs: 8000,
  });

  const handleContextReady = (context: string) => {
    setSessionContext(context || "");
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
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleSimulateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAnalysis(simulateText);
    setSimulateText("");
  };

  const openInNewTab = () => {
    window.open(window.location.href, "_blank");
  };

  const sessionStarted = sessionContext !== null;

  return (
    <div className="fixed inset-0 bg-black text-foreground flex flex-col overflow-hidden font-sans">

      {/* CONTEXT PANEL — top strip */}
      <ContextPanel
        onContextReady={handleContextReady}
        sessionContext={sessionContext}
        onClearSession={handleClearSession}
      />

      {/* MAIN HUD — only rendered after session starts */}
      {sessionStarted ? (
        <>
          <TacticalDisplay
            signal={tacticalState.signal}
            sayNow={tacticalState.sayNow}
            avoid={tacticalState.avoid}
            isPending={isPending}
          />

          {/* STATUS — Top Right */}
          <div className="absolute top-16 right-6 flex items-center gap-3">
            {isPending && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="text-[10px] font-mono tracking-widest uppercase">Analizando</span>
              </div>
            )}
            {mode === "listen" && !speechError && (
              <div
                className={cn(
                  "flex items-center gap-2 px-2 py-1 rounded-full transition-colors duration-500 cursor-pointer",
                  isListening ? "bg-red-500/10 text-red-500" : "text-muted-foreground"
                )}
                onClick={handleMicToggle}
              >
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    isListening ? "bg-red-500 animate-pulse" : "bg-muted-foreground"
                  )}
                />
                <span className="text-[10px] font-mono tracking-widest uppercase">
                  {isListening ? "Escuchando" : "Pausado"}
                </span>
              </div>
            )}
          </div>

          {/* INTERIM TEXT */}
          {mode === "listen" && isListening && interimText && (
            <div className="absolute bottom-32 left-1/2 -translate-x-1/2 max-w-2xl w-full px-6 text-center">
              <p className="text-xs text-muted-foreground/40 font-mono truncate">
                {interimText}
              </p>
            </div>
          )}

          {/* MIC ERROR */}
          {mode === "listen" && speechError && (
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-full max-w-sm px-6">
              <div className="flex flex-col gap-3 bg-zinc-900 border border-white/10 rounded-2xl p-5 shadow-xl">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs font-mono text-zinc-300 leading-relaxed">
                    {speechError}
                  </p>
                </div>
                <button
                  onClick={openInNewTab}
                  className="flex items-center justify-center gap-2 text-xs font-mono text-black bg-white rounded-xl px-4 py-2.5 hover:bg-zinc-200 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir en pestaña separada
                </button>
                <p className="text-[10px] text-muted-foreground font-mono text-center">
                  O usa el modo Simular para probar la IA ahora
                </p>
              </div>
            </div>
          )}

          {/* NOT SUPPORTED */}
          {mode === "listen" && !isSupported && !speechError && (
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-full max-w-sm px-6">
              <div className="flex flex-col gap-3 bg-zinc-900 border border-white/10 rounded-2xl p-5">
                <p className="text-xs font-mono text-zinc-300 text-center leading-relaxed">
                  Tu navegador no soporta reconocimiento de voz.<br />
                  Usa Chrome o Edge para el modo de escucha.
                </p>
              </div>
            </div>
          )}

          {/* CONTROLS — Bottom */}
          <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col items-center bg-black pt-8 border-t border-white/5">

            {/* Simulate input */}
            {mode === "simulate" && (
              <form
                onSubmit={handleSimulateSubmit}
                className="w-full max-w-2xl mb-6 flex gap-2 animate-in slide-in-from-bottom-4 fade-in duration-300"
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
                  placeholder="Pega aquí un fragmento de la conversación y pulsa Analizar..."
                  rows={2}
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-zinc-500 transition-all font-mono resize-none"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!simulateText.trim() || isPending}
                  className="bg-white text-black px-6 py-3 rounded-xl font-bold text-sm hover:bg-zinc-200 active:scale-95 disabled:opacity-40 transition-all flex items-center gap-2 self-end"
                >
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  <span>Analizar</span>
                </button>
              </form>
            )}

            {/* Listen mic button */}
            {mode === "listen" && isSupported && !speechError && (
              <button
                onClick={handleMicToggle}
                className={cn(
                  "mb-6 px-6 py-3 rounded-full font-mono text-xs font-semibold tracking-widest uppercase transition-all duration-300 flex items-center gap-2",
                  isListening
                    ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                    : "bg-white/10 text-white border border-white/20 hover:bg-white/20"
                )}
              >
                {isListening ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    Pausar escucha
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5" />
                    Iniciar escucha
                  </>
                )}
              </button>
            )}

            {/* Mode toggle */}
            <div className="flex items-center bg-white/5 backdrop-blur-md p-1 rounded-full border border-white/10">
              <button
                onClick={() => handleModeSwitch("listen")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full text-xs font-mono font-medium transition-all duration-300",
                  mode === "listen"
                    ? "bg-white text-black shadow-lg"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                )}
              >
                {isListening ? <Mic className="w-3.5 h-3.5 text-red-500" /> : <MicOff className="w-3.5 h-3.5" />}
                ESCUCHAR
              </button>
              <button
                onClick={() => handleModeSwitch("simulate")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full text-xs font-mono font-medium transition-all duration-300",
                  mode === "simulate"
                    ? "bg-white text-black shadow-lg"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                )}
              >
                <Keyboard className="w-3.5 h-3.5" />
                SIMULAR
              </button>
            </div>
          </div>
        </>
      ) : (
        /* Waiting state before session starts */
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs font-mono tracking-widest uppercase text-zinc-700">
            Configura el contexto arriba para empezar
          </p>
        </div>
      )}
    </div>
  );
}
