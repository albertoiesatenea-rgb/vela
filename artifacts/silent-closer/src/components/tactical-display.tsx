import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TacticalDisplayProps {
  signal: string;
  sayNow: string;
  avoid: string;
  isPending?: boolean;
}

export function TacticalDisplay({ signal, sayNow, avoid, isPending }: TacticalDisplayProps) {
  // Animation variants for smooth, non-jarring crossfades
  const fadeVariants = {
    initial: { opacity: 0, filter: "blur(4px)", y: 10 },
    animate: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.5, ease: "easeOut" } },
    exit: { opacity: 0, filter: "blur(4px)", y: -10, transition: { duration: 0.3, ease: "easeIn" } }
  };

  const hasData = signal || sayNow || avoid;

  return (
    <div className="flex-1 flex flex-col justify-center items-center w-full max-w-6xl mx-auto px-4 sm:px-8 py-12 relative">
      
      {/* SIGNAL SECTION */}
      <div className="absolute top-12 left-0 right-0 flex flex-col items-center justify-center space-y-3">
        <span className="text-[10px] sm:text-xs text-muted-foreground font-mono tracking-[0.3em]">
          SEÑAL
        </span>
        <div className="h-8 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={signal || "empty-signal"}
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {signal ? (
                <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-md text-xs sm:text-sm font-mono text-zinc-300 uppercase tracking-widest shadow-lg shadow-black/50 backdrop-blur-sm">
                  {signal}
                </span>
              ) : (
                <span className="text-xs font-mono text-muted-foreground/50 uppercase tracking-widest">
                  {isPending ? "Analizando..." : "Esperando..."}
                </span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* SAY NOW SECTION (MAIN FOCUS) */}
      <div className="flex flex-col items-center justify-center w-full flex-1 min-h-[40vh]">
        <span className="text-[10px] sm:text-xs text-muted-foreground font-mono tracking-[0.3em] mb-8 opacity-50">
          DI AHORA
        </span>
        <div className="w-full flex items-center justify-center relative">
          <AnimatePresence mode="wait">
            <motion.h1
              key={sayNow || "empty-say"}
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className={cn(
                "text-4xl sm:text-6xl md:text-7xl lg:text-[6rem] font-bold tracking-tight text-center leading-[1.1]",
                !sayNow ? "text-muted-foreground/20 font-normal" : "text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]"
              )}
            >
              {sayNow || "Escuchando"}
            </motion.h1>
          </AnimatePresence>
        </div>
      </div>

      {/* AVOID SECTION */}
      <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center justify-center space-y-3">
        <span className="text-[10px] sm:text-xs text-muted-foreground font-mono tracking-[0.3em]">
          EVITA
        </span>
        <div className="h-8 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={avoid || "empty-avoid"}
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {avoid ? (
                <span className="text-destructive font-mono text-sm sm:text-base uppercase tracking-widest font-semibold drop-shadow-[0_0_8px_rgba(220,38,38,0.3)]">
                  {avoid}
                </span>
              ) : (
                <span className="text-xs font-mono text-muted-foreground/30 uppercase tracking-widest">
                  ...
                </span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      
    </div>
  );
}
