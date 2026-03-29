import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Detail {
  reading?: string;
  argument?: string;
  talk_track?: string;
  question?: string;
  risk?: string;
  support?: string;
}

interface TacticalDisplayProps {
  signal: string;
  sayNow: string;
  avoid: string;
  detail?: Detail | null;
  callMemory?: string;
  isPending?: boolean;
}

const fade = {
  initial: { opacity: 0, filter: "blur(4px)", y: 8 },
  animate: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.45, ease: "easeOut" } },
  exit:    { opacity: 0, filter: "blur(4px)", y: -8, transition: { duration: 0.25, ease: "easeIn" } },
};

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-mono tracking-[0.25em] uppercase text-zinc-400">{label}</span>
      <p className="text-xs font-mono text-zinc-200 leading-snug">{value}</p>
    </div>
  );
}

export function TacticalDisplay({ signal, sayNow, avoid, detail, callMemory, isPending }: TacticalDisplayProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);

  const hasDetail = detail && Object.values(detail).some(Boolean);
  const memoryLines = callMemory
    ? callMemory.split("\\n").filter(Boolean)
    : [];
  const hasMemory = memoryLines.length > 0;

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
      <div className="flex-1 flex flex-col items-center justify-center px-6 min-h-0">
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

      {/* ── PANELS: DETAIL + MEMORY ────────────────── */}
      {(hasDetail || hasMemory) && (
        <div className="shrink-0 border-t border-white/5 mx-4 mb-2">

          {/* Toggle row */}
          <div className="flex items-center justify-center gap-6 py-2">
            {hasDetail && (
              <button
                onClick={() => { setDetailOpen(v => !v); setMemoryOpen(false); }}
                className="flex items-center gap-1 text-[10px] font-mono tracking-widest uppercase text-zinc-400 hover:text-white transition-colors"
              >
                {detailOpen ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                Ver detalle
              </button>
            )}
            {hasMemory && (
              <button
                onClick={() => { setMemoryOpen(v => !v); setDetailOpen(false); }}
                className="flex items-center gap-1 text-[10px] font-mono tracking-widest uppercase text-zinc-400 hover:text-white transition-colors"
              >
                {memoryOpen ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                Memoria
              </button>
            )}
          </div>

          {/* Detail panel */}
          <AnimatePresence>
            {detailOpen && hasDetail && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 pt-1 border-t border-white/5">
                  <DetailRow label="Lectura" value={detail?.reading} />
                  <DetailRow label="Enfoque" value={detail?.argument} />
                  {detail?.talk_track && (
                    <div className="sm:col-span-2 flex flex-col gap-0.5">
                      <span className="text-[9px] font-mono tracking-[0.25em] uppercase text-zinc-400">Guion</span>
                      <p className="text-xs font-mono text-zinc-200 leading-snug italic">{detail.talk_track}</p>
                    </div>
                  )}
                  <DetailRow label="Pregunta" value={detail?.question} />
                  <DetailRow label="Riesgo" value={detail?.risk} />
                  <DetailRow label="Apoyo" value={detail?.support} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Memory panel */}
          <AnimatePresence>
            {memoryOpen && hasMemory && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="pb-3 pt-1 border-t border-white/5">
                  <ul className="space-y-1.5">
                    {memoryLines.map((line, i) => (
                      <li key={i} className="text-[11px] font-mono text-zinc-300 leading-snug">
                        {line.startsWith("-") ? line : `- ${line}`}
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      )}

    </div>
  );
}
