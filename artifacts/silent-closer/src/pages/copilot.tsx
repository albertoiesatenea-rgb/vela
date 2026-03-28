import { useState, useCallback, useRef, useEffect } from "react";
import { Mic, MicOff, Keyboard, Play, Loader2, AlertCircle } from "lucide-react";
import { useAnalyzeConversation } from "@workspace/api-client-react";
import { useSpeech } from "@/hooks/use-speech";
import { TacticalDisplay } from "@/components/tactical-display";
import { cn } from "@/lib/utils";

type Mode = "listen" | "simulate";

export default function CopilotPage() {
  const [mode, setMode] = useState<Mode>("listen");
  const [simulateText, setSimulateText] = useState("");
  
  // Tactical State
  const [tacticalState, setTacticalState] = useState({
    signal: "",
    sayNow: "",
    avoid: ""
  });

  // API Integration
  const { mutate: analyze, isPending } = useAnalyzeConversation();

  const handleAnalysis = useCallback((text: string) => {
    if (!text.trim()) return;
    
    analyze({ data: { text } }, {
      onSuccess: (res) => {
        setTacticalState({
          signal: res.signal,
          sayNow: res.say_now,
          avoid: res.avoid
        });
      },
      onError: (err) => {
        console.error("Analysis failed:", err);
      }
    });
  }, [analyze]);

  // Speech Recognition Hook
  const {
    isSupported,
    isListening,
    error: speechError,
    interimText,
    startListening,
    stopListening
  } = useSpeech({
    onAnalyzeReady: handleAnalysis,
    analysisIntervalMs: 8000 // Analyze every 8 seconds of continuous speech
  });

  // Auto-start listening if supported and in listen mode
  useEffect(() => {
    if (mode === "listen" && isSupported && !isListening && !speechError) {
      startListening();
    } else if (mode === "simulate" && isListening) {
      stopListening();
    }
  }, [mode, isSupported, isListening, startListening, stopListening, speechError]);

  const handleSimulateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAnalysis(simulateText);
    setSimulateText("");
  };

  return (
    <div className="fixed inset-0 bg-black text-foreground flex flex-col overflow-hidden selection:bg-white/20 selection:text-black font-sans">
      
      {/* MAIN HUD */}
      <TacticalDisplay 
        signal={tacticalState.signal}
        sayNow={tacticalState.sayNow}
        avoid={tacticalState.avoid}
        isPending={isPending}
      />

      {/* SUBTLE STATUS INDICATORS (Top Right) */}
      <div className="absolute top-6 right-6 flex items-center gap-3">
        {isPending && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[10px] font-mono tracking-widest uppercase">Analizando</span>
          </div>
        )}
        
        {mode === "listen" && (
          <div className={cn(
            "flex items-center gap-2 px-2 py-1 rounded-full transition-colors duration-500",
            isListening ? "bg-red-500/10 text-red-500" : "text-muted-foreground"
          )}>
            <div className={cn("w-2 h-2 rounded-full", isListening ? "bg-red-500 animate-pulse" : "bg-muted-foreground")} />
            <span className="text-[10px] font-mono tracking-widest uppercase">
              {isListening ? "Mic Activo" : "Mic Pausado"}
            </span>
          </div>
        )}
      </div>

      {/* ERROR BANNER (if mic fails) */}
      {speechError && mode === "listen" && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-destructive/10 text-destructive px-4 py-2 rounded-full border border-destructive/20 backdrop-blur-md">
          <AlertCircle className="w-4 h-4" />
          <span className="text-xs font-mono">{speechError}</span>
        </div>
      )}

      {/* INTERIM TEXT (Subtle preview of what is being heard) */}
      {mode === "listen" && isListening && interimText && (
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 max-w-2xl w-full px-6 text-center">
          <p className="text-xs text-muted-foreground/40 font-mono truncate mask-image-fade">
            {interimText}
          </p>
        </div>
      )}

      {/* CONTROLS (Bottom edge) */}
      <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col items-center bg-gradient-to-t from-black via-black/80 to-transparent pt-12">
        
        {/* Simulate Mode Input */}
        {mode === "simulate" && (
          <form 
            onSubmit={handleSimulateSubmit}
            className="w-full max-w-2xl mb-6 flex gap-2 animate-in slide-in-from-bottom-4 fade-in duration-300"
          >
            <input
              type="text"
              value={simulateText}
              onChange={(e) => setSimulateText(e.target.value)}
              placeholder="Pega texto de la conversación aquí..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 transition-all font-mono"
              autoFocus
            />
            <button
              type="submit"
              disabled={!simulateText.trim() || isPending}
              className="bg-white text-black px-6 py-3 rounded-xl font-bold text-sm hover:bg-zinc-200 active:scale-95 disabled:opacity-50 disabled:active:scale-100 transition-all flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              <span>Analizar</span>
            </button>
          </form>
        )}

        {/* Mode Toggles */}
        <div className="flex items-center bg-white/5 backdrop-blur-md p-1 rounded-full border border-white/10">
          <button
            onClick={() => setMode("listen")}
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
            onClick={() => setMode("simulate")}
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
    </div>
  );
}
