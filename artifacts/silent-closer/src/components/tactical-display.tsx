import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface TacticalDisplayProps {
  sayNow: string;
  reading?: string;
  avoid?: string;
  detailOpen?: boolean;
  onCloseDetail?: () => void;
  isPending?: boolean;
  isListening?: boolean;
  lang?: "es" | "en";
}

const fade = {
  initial: { opacity: 0, filter: "blur(4px)", y: 8 },
  animate: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.45, ease: "easeOut" } },
  exit:    { opacity: 0, filter: "blur(4px)", y: -8, transition: { duration: 0.25, ease: "easeIn" } },
};

export function TacticalDisplay({
  sayNow, reading, avoid, detailOpen, onCloseDetail, isPending, isListening, lang = "es",
}: TacticalDisplayProps) {
  const [readingOpen, setReadingOpen] = useState(false);

  // Close reading when detail opens (they're mutually exclusive)
  useEffect(() => { if (detailOpen) setReadingOpen(false); }, [detailOpen]);

  const canAct = !!(sayNow);

  const handleClick = () => {
    if (!canAct) return;
    if (detailOpen) {
      // Detail is open → close it, don't open reading
      onCloseDetail?.();
    } else {
      // Toggle reading + evita inline
      setReadingOpen(p => !p);
    }
  };

  const showInline = readingOpen && !detailOpen && (reading || avoid);

  return (
    <div className="h-full w-full flex flex-col">

      {/* ── DI AHORA — always clickable ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-6">
        <AnimatePresence mode="wait">
          <motion.p
            key={sayNow || "empty-say"}
            variants={fade}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={handleClick}
            className={cn(
              "text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-center leading-tight select-none",
              sayNow ? "text-white" : "text-zinc-700 font-normal text-3xl sm:text-4xl",
              canAct && "cursor-pointer active:opacity-70 transition-opacity",
            )}
          >
            {sayNow || (isListening ? (lang === "en" ? "Listening" : "Escuchando") : "—")}
          </motion.p>
        </AnimatePresence>

        {/* ── LECTURA + EVITA inline — toggled by click ── */}
        <div
          className="overflow-hidden w-full flex flex-col items-center gap-4"
          style={{
            maxHeight: showInline ? "200px" : "0px",
            opacity: showInline ? 1 : 0,
            transition: "max-height 0.3s ease, opacity 0.22s ease",
          }}
        >
          {reading && (
            <p className="text-[14px] font-mono text-sky-200 text-center leading-relaxed max-w-lg px-4">
              {reading}
            </p>
          )}
          {avoid && (
            <p className="text-[18px] font-mono text-red-500 uppercase tracking-wide font-semibold text-center">
              {avoid}
            </p>
          )}
        </div>
      </div>

    </div>
  );
}
