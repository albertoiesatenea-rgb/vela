import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TacticalDisplayProps {
  sayNow: string;
  reading?: string;
  avoid?: string;
  isPending?: boolean;
  isListening?: boolean;
}

const fade = {
  initial: { opacity: 0, filter: "blur(4px)", y: 8 },
  animate: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.45, ease: "easeOut" } },
  exit:    { opacity: 0, filter: "blur(4px)", y: -8, transition: { duration: 0.25, ease: "easeIn" } },
};

export function TacticalDisplay({ sayNow, reading, avoid, isPending, isListening }: TacticalDisplayProps) {
  const [readingOpen, setReadingOpen] = useState(false);

  // Reset when a new command arrives
  useEffect(() => { setReadingOpen(false); }, [sayNow]);

  const canToggle = !!(reading && sayNow);

  return (
    <div className="h-full w-full flex flex-col">

      {/* ── DI AHORA — clickable to reveal/hide reading ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-5">
        <AnimatePresence mode="wait">
          <motion.p
            key={sayNow || "empty-say"}
            variants={fade}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={() => canToggle && setReadingOpen(p => !p)}
            className={cn(
              "text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-center leading-tight select-none",
              sayNow ? "text-white" : "text-zinc-700 font-normal text-3xl sm:text-4xl",
              canToggle && "cursor-pointer active:opacity-80 transition-opacity",
            )}
          >
            {sayNow || (isListening ? "Escuchando" : "—")}
          </motion.p>
        </AnimatePresence>

        {/* ── NOTA TÁCTICA — visible solo al hacer click en el comando ── */}
        <div
          className="overflow-hidden w-full flex justify-center"
          style={{
            maxHeight: readingOpen && reading ? "120px" : "0px",
            opacity: readingOpen && reading ? 1 : 0,
            transition: "max-height 0.28s ease, opacity 0.22s ease",
          }}
        >
          <p className="text-[13px] font-mono text-zinc-400 text-center leading-relaxed max-w-lg px-4">
            {reading}
          </p>
        </div>
      </div>

      {/* ── EVITA — solo si hay algo crítico ────────── */}
      <AnimatePresence>
        {avoid ? (
          <motion.div
            key="evita"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: { duration: 0.3 } }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
            className="flex items-center justify-center pt-4 pb-10 shrink-0 overflow-hidden"
          >
            <AnimatePresence mode="wait">
              <motion.div key={avoid} variants={fade} initial="initial" animate="animate" exit="exit">
                <span className="text-2xl font-mono text-red-500 uppercase tracking-wide font-semibold text-center">
                  {avoid}
                </span>
              </motion.div>
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>

    </div>
  );
}
