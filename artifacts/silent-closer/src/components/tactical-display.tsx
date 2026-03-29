import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TacticalDisplayProps {
  signal: string;
  sayNow: string;
  avoid: string;
  isPending?: boolean;
}

const fade = {
  initial: { opacity: 0, filter: "blur(4px)", y: 8 },
  animate: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.45, ease: "easeOut" } },
  exit:    { opacity: 0, filter: "blur(4px)", y: -8, transition: { duration: 0.25, ease: "easeIn" } },
};

export function TacticalDisplay({ signal, sayNow, avoid, isPending }: TacticalDisplayProps) {
  return (
    <div className="h-full w-full flex flex-col">

      {/* ── SEÑAL ──────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center gap-2 py-5 shrink-0">
        <span className="text-[10px] font-mono tracking-[0.3em] text-zinc-300 uppercase">SEÑAL</span>
        <div className="h-7 flex items-center">
          <AnimatePresence mode="wait">
            <motion.div key={signal || "empty-signal"} variants={fade} initial="initial" animate="animate" exit="exit">
              {signal ? (
                <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-md text-xs font-mono text-zinc-300 uppercase tracking-widest">
                  {signal}
                </span>
              ) : (
                <span className="text-xs font-mono text-zinc-600 uppercase tracking-widest">
                  {isPending ? "Analizando..." : "—"}
                </span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ── DI AHORA ────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <span className="text-[10px] font-mono tracking-[0.3em] text-zinc-300 uppercase mb-6">DI AHORA</span>
        <AnimatePresence mode="wait">
          <motion.p
            key={sayNow || "empty-say"}
            variants={fade}
            initial="initial"
            animate="animate"
            exit="exit"
            className={cn(
              "text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-center leading-tight",
              sayNow ? "text-white" : "text-zinc-700 font-normal text-3xl sm:text-4xl"
            )}
          >
            {sayNow || "Escuchando"}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* ── EVITA ──────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center gap-2 py-5 shrink-0">
        <span className="text-[10px] font-mono tracking-[0.3em] text-zinc-300 uppercase">EVITA</span>
        <div className="h-7 flex items-center">
          <AnimatePresence mode="wait">
            <motion.div key={avoid || "empty-avoid"} variants={fade} initial="initial" animate="animate" exit="exit">
              {avoid ? (
                <span className="text-sm font-mono text-red-500 uppercase tracking-widest font-semibold">
                  {avoid}
                </span>
              ) : (
                <span className="text-xs font-mono text-zinc-700 uppercase tracking-widest">—</span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

    </div>
  );
}
