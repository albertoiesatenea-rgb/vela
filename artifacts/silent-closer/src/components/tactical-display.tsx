import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TacticalDisplayProps {
  sayNow: string;
  hint?: string;
  avoid?: string;
  isPending?: boolean;
  isListening?: boolean;
}

const fade = {
  initial: { opacity: 0, filter: "blur(4px)", y: 8 },
  animate: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.45, ease: "easeOut" } },
  exit:    { opacity: 0, filter: "blur(4px)", y: -8, transition: { duration: 0.25, ease: "easeIn" } },
};

const fadeSlow = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut", delay: 0.15 } },
  exit:    { opacity: 0, y: -4, transition: { duration: 0.2 } },
};

export function TacticalDisplay({ sayNow, hint, avoid, isPending, isListening }: TacticalDisplayProps) {
  return (
    <div className="h-full w-full flex flex-col">

      {/* ── DI AHORA ────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
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
            {sayNow || (isListening ? "Escuchando" : "—")}
          </motion.p>
        </AnimatePresence>

        {/* ── HINT — nota táctica debajo del comando ── */}
        <AnimatePresence mode="wait">
          {hint && sayNow && (
            <motion.p
              key={hint}
              variants={fadeSlow}
              initial="initial"
              animate="animate"
              exit="exit"
              className="text-[13px] font-mono text-zinc-400 text-center leading-relaxed max-w-md"
            >
              {hint}
            </motion.p>
          )}
        </AnimatePresence>
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
