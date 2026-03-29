import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TacticalDisplayProps {
  sayNow: string;
  reading?: string;
  detailOpen?: boolean;
  isPending?: boolean;
  isListening?: boolean;
}

const fade = {
  initial: { opacity: 0, filter: "blur(4px)", y: 8 },
  animate: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.45, ease: "easeOut" } },
  exit:    { opacity: 0, filter: "blur(4px)", y: -8, transition: { duration: 0.25, ease: "easeIn" } },
};

export function TacticalDisplay({ sayNow, reading, detailOpen, isPending, isListening }: TacticalDisplayProps) {
  const [readingOpen, setReadingOpen] = useState(false);

  // Close reading when a new command arrives
  useEffect(() => { setReadingOpen(false); }, [sayNow]);

  // Close reading when detail panel opens
  useEffect(() => { if (detailOpen) setReadingOpen(false); }, [detailOpen]);

  const canToggle = !!(reading && sayNow);

  return (
    <div className="h-full w-full flex flex-col">

      {/* ── DI AHORA — click to reveal/hide reading ── */}
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
              canToggle && "cursor-pointer active:opacity-70 transition-opacity",
            )}
          >
            {sayNow || (isListening ? "Escuchando" : "—")}
          </motion.p>
        </AnimatePresence>

        {/* ── LECTURA — visible on tap, sky-blue ── */}
        <div
          className="overflow-hidden w-full flex justify-center"
          style={{
            maxHeight: readingOpen && reading ? "140px" : "0px",
            opacity: readingOpen && reading ? 1 : 0,
            transition: "max-height 0.28s ease, opacity 0.22s ease",
          }}
        >
          <p className="text-[14px] font-mono text-sky-200 text-center leading-relaxed max-w-lg px-4">
            {reading}
          </p>
        </div>
      </div>

    </div>
  );
}
