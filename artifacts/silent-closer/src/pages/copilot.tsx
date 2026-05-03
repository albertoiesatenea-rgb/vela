import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Mic, Keyboard, Loader2, AlertCircle, ExternalLink, ChevronDown, Info, List } from "lucide-react";
import { analyzeConversation } from "@workspace/api-client-react";
import { useSpeech } from "@/hooks/use-speech";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { TacticalDisplay } from "@/components/tactical-display";
import { ContextSetup, SessionBar, VelaIcon } from "@/components/context-panel";
import type { ArenaConfig, AppMode, StructuredContext } from "@/components/context-panel";
import { Arena } from "@/pages/arena";
import type { ArenaRole } from "@/pages/arena";
import { cn } from "@/lib/utils";
import { buildCopilotAuditLog, triggerAuditLogDownload, BRAND_NAME } from "@/lib/audit-log";
import { SpeakerAttributionSession, type SpeakerResult, type SpeakerQualityLevel, type SpeakerLabel } from "@/lib/speaker-session";
import { DebugPanel } from "@/components/debug-panel";

// ── Overlay brand header used in end-of-call screens ────────────────────────
function WizardOverlayHeader() {
  return (
    <div className="flex items-center gap-2 mb-1">
      <VelaIcon className="w-5 h-5 text-zinc-400 shrink-0" />
      <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-zinc-400">
        VELA
      </span>
    </div>
  );
}

// ── Live Transcript Drawer ────────────────────────────────────────────────────
// Slide-in right panel showing the reconstructed conversation in real-time.
// Each turn shows: speaker badge (YO/CLI/?), confidence dot, ↺ repair indicator.
// Multi-segment turns (normalized_fragment with \n) rendered as sub-lines.
function LiveTranscriptDrawer({
  isOpen,
  onClose,
  turnLog,
  lang,
}: {
  isOpen: boolean;
  onClose: () => void;
  turnLog: TurnLogEntry[];
  lang: Lang;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isOpen, turnLog.length]);

  const repairedCount = turnLog.filter(t => t.auto_repaired).length;

  return (
    <div
      className={cn(
        "fixed top-0 right-0 h-full w-[280px] bg-zinc-950 border-l border-zinc-800/70 z-40 flex flex-col",
        "transition-transform duration-200 ease-out",
        isOpen ? "translate-x-0" : "translate-x-full",
      )}
      aria-hidden={!isOpen}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <VelaIcon className="w-3 h-3 text-zinc-600 shrink-0" />
          <span className="text-[9px] font-mono tracking-[0.18em] uppercase text-zinc-500">
            {lang === "es" ? "Conversación" : "Conversation"}
          </span>
          {turnLog.length > 0 && (
            <span className="text-[9px] font-mono text-zinc-700">({turnLog.length})</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-zinc-700 hover:text-zinc-300 text-xs font-mono transition-colors leading-none px-1 py-0.5"
          type="button"
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>

      {/* Legend bar */}
      {turnLog.length > 0 && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-1.5 border-b border-zinc-800/30">
          <div className="flex items-center gap-1">
            <span className="text-[7px] font-mono border border-teal-800/60 text-teal-400 bg-teal-950/40 px-1 py-[1px] rounded leading-none">YO</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[7px] font-mono border border-sky-800/60 text-sky-400 bg-sky-950/40 px-1 py-[1px] rounded leading-none">CLI</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[7px] font-mono border border-zinc-700/60 text-zinc-500 bg-zinc-900/40 px-1 py-[1px] rounded leading-none">?</span>
            <span className="text-[7px] font-mono text-zinc-700">{lang === "es" ? "desconocido" : "unknown"}</span>
          </div>
          {repairedCount > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[7px] font-mono text-amber-500">↺</span>
              <span className="text-[7px] font-mono text-zinc-700">{repairedCount}</span>
            </div>
          )}
        </div>
      )}

      {/* Turns */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-1">
        {turnLog.length === 0 ? (
          <div className="flex flex-col items-center gap-2 mt-10 px-4">
            <p className="text-[10px] font-mono text-zinc-700 text-center leading-relaxed">
              {lang === "es"
                ? "La conversación aparecerá aquí mientras VELA escucha."
                : "The conversation will appear here as VELA listens."}
            </p>
          </div>
        ) : (
          turnLog.map((entry, idx) => {
            const isMe = entry.inferred_speaker === "YO";
            const isClient = entry.inferred_speaker === "CLIENTE";
            const badgeClass = isMe
              ? "border-teal-800/60 text-teal-400 bg-teal-950/40"
              : isClient
              ? "border-sky-800/60 text-sky-400 bg-sky-950/40"
              : "border-zinc-700/60 text-zinc-500 bg-zinc-900/40";
            const badgeLabel = isMe
              ? (lang === "es" ? "YO" : "ME")
              : isClient ? "CLI" : "?";

            const conf = entry.speaker_confidence ?? 0;
            const dotClass =
              entry.speaker_mode !== "auto" ? "bg-zinc-600"
              : conf >= 0.65 ? "bg-teal-500"
              : conf >= 0.35 ? "bg-amber-500"
              : "bg-zinc-600";

            const rawLines = entry.normalized_fragment.split("\n").map(l => l.trim()).filter(Boolean);
            const displayLines = rawLines.length > 0 ? rawLines : [entry.raw_fragment.slice(0, 140)];

            return (
              <div
                key={entry.turn_index}
                className={cn(
                  "flex flex-col px-3 py-2 border-b last:border-0 border-zinc-800/20",
                  entry.auto_repaired && "bg-amber-950/8",
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-[8px] font-mono tracking-wider px-1.5 py-[2px] rounded border leading-none", badgeClass)}>
                      {badgeLabel}
                    </span>
                    {entry.speaker_mode === "auto" && (
                      <div
                        className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotClass)}
                        title={`conf ${Math.round((entry.speaker_confidence ?? 0) * 100)}%`}
                      />
                    )}
                    {entry.auto_repaired && (
                      <span
                        className="text-[8px] font-mono text-amber-500/80 leading-none"
                        title={lang === "es" ? "Revisado por VELA" : "Revised by VELA"}
                      >
                        ↺{(entry.repair_count ?? 0) > 1 ? entry.repair_count : ""}
                      </span>
                    )}
                    {entry.response_status === "pending" && (
                      <span className="text-[7px] font-mono text-zinc-500 leading-none animate-pulse" title="analyzing...">·</span>
                    )}
                    {entry.response_status === "error" && (
                      <span className="text-[7px] font-mono text-red-600 leading-none" title="analysis error">✗</span>
                    )}
                  </div>
                  <span className="text-[8px] font-mono text-zinc-700">{idx + 1}</span>
                </div>

                <div className="flex flex-col gap-0.5">
                  {displayLines.map((line, j) => {
                    const lineIsMe = line.startsWith("[YO]") || line.startsWith("[ME]");
                    const lineIsClient = line.startsWith("[CLIENTE]") || line.startsWith("[CLIENT]");
                    const lineColor = lineIsMe
                      ? "text-teal-300/70"
                      : lineIsClient
                      ? "text-sky-300/70"
                      : isMe ? "text-teal-300/50"
                      : isClient ? "text-sky-300/50"
                      : "text-zinc-500";
                    return (
                      <p key={j} className={cn("text-[10px] font-mono leading-relaxed break-words", lineColor)}>
                        {line}
                      </p>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-zinc-800/60 px-4 py-2">
        <p className="text-[8px] font-mono text-zinc-700 tracking-widest uppercase">
          {lang === "es" ? "VELA · interpreta en tiempo real" : "VELA · real-time interpretation"}
        </p>
      </div>
    </div>
  );
}

type InputMode = "listen" | "simulate";
type SpeakerMode = "auto" | "client" | "me";
type Lang = "es" | "en";

const LANG_KEY = "sc_lang";
function loadLang(): Lang {
  try { return (localStorage.getItem(LANG_KEY) as Lang) || "es"; } catch { return "es"; }
}
function saveLang(l: Lang) {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
}

const SPEAKER_LABELS_MAP: Record<Lang, Record<SpeakerMode, string>> = {
  es: { auto: "AUTO", client: "CLIENTE", me: "YO" },
  en: { auto: "AUTO", client: "CLIENT",  me: "ME" },
};
const SPEAKER_ORDER: SpeakerMode[] = ["auto", "client", "me"];

// ── UI text translations ───────────────────────────────────────────────────
const T = {
  es: {
    LISTEN: "ESCUCHAR", TYPE: "ESCRIBIR", ANALYZING: "Analizando",
    LISTENING: "Escuchando", PAUSED: "Pausado",
    START: "Iniciar escucha", PAUSE: "Pausar", AVOID: "EVITA",
    START_LISTENING: "Iniciar escucha",
    MODE_LISTEN: "ESCUCHAR", MODE_WRITE: "ESCRIBIR",
    PASTE_PLACEHOLDER: "Pega un fragmento de la conversación...",
    ANALYZE: "Analizar",
    DETAIL: "Detalle",
    OR_SIMULATE: "O usa el modo Simular para probar la IA ahora",
    KBD: "← → cambia hablante · espacio cicla",
    autoHint: (l: string) => `último · ${l} (auto) · ← → cambia`,
    OPEN_TAB: "Abrir en pestaña separada",
    NO_SPEECH: "Tu navegador no soporta reconocimiento de voz.\nUsa Chrome o Edge.",
    EXIT: "← Salir",
    // End-of-call flow
    OUTCOME_Q: "¿Cómo terminó la llamada?",
    OUTCOME_CLOSED: "Cerrada",
    OUTCOME_NEXT: "Siguiente paso acordado",
    OUTCOME_FOLLOW: "Seguimiento",
    OUTCOME_LOST: "Perdida",
    OUTCOME_UNCLEAR: "No claro",
    SKIP_ANALYSIS: "Saltar análisis y cerrar",
    CALL_RESULT: "RESULTADO DE LLAMADA",
    CALL_SCORE: "PUNTUACIÓN",
    CALL_STATE: "ESTADO",
    STRENGTHS: "PUNTOS FUERTES",
    IMPROVEMENTS: "PUNTOS A MEJORAR",
    GEN_REPORT: "Generar reporte completo",
    COPY_SUMMARY: "Copiar resumen",
    COPY_REPORT: "Copiar reporte",
    CLOSE_SESSION: "Cerrar sesión",
    FULL_REPORT: "REPORTE COMPLETO",
    ANALYZING_CALL: "Analizando llamada...",
    BACK_SUMMARY: "← Volver al resumen",
    COPIED: "¡Copiado!",
    NO_MEMORY: "No hay datos suficientes de la llamada para generar un análisis completo.",
    DOWNLOAD_AUDIT: "Descargar audit log (.md) ↓",
  },
  en: {
    LISTEN: "LISTEN", TYPE: "TYPE", ANALYZING: "Analyzing",
    LISTENING: "Listening", PAUSED: "Paused",
    START: "Start listening", PAUSE: "Pause", AVOID: "AVOID",
    START_LISTENING: "Start listening",
    MODE_LISTEN: "LISTEN", MODE_WRITE: "WRITE",
    PASTE_PLACEHOLDER: "Paste a conversation snippet...",
    ANALYZE: "Analyze",
    DETAIL: "Detail",
    OR_SIMULATE: "Or use Simulate mode to test the AI now",
    KBD: "← → change speaker · space cycles",
    autoHint: (l: string) => `last · ${l} (auto) · ← → change`,
    OPEN_TAB: "Open in separate tab",
    NO_SPEECH: "Your browser does not support speech recognition.\nUse Chrome or Edge.",
    EXIT: "← Exit",
    // End-of-call flow
    OUTCOME_Q: "How did the call end?",
    OUTCOME_CLOSED: "Closed",
    OUTCOME_NEXT: "Next step agreed",
    OUTCOME_FOLLOW: "Follow-up",
    OUTCOME_LOST: "Lost",
    OUTCOME_UNCLEAR: "Unclear",
    SKIP_ANALYSIS: "Skip analysis and close",
    CALL_RESULT: "CALL RESULT",
    CALL_SCORE: "SCORE",
    CALL_STATE: "STATE",
    STRENGTHS: "STRENGTHS",
    IMPROVEMENTS: "IMPROVEMENTS",
    GEN_REPORT: "Generate full report",
    COPY_SUMMARY: "Copy summary",
    COPY_REPORT: "Copy report",
    CLOSE_SESSION: "Close session",
    FULL_REPORT: "FULL REPORT",
    ANALYZING_CALL: "Analyzing call...",
    BACK_SUMMARY: "← Back to summary",
    COPIED: "Copied!",
    NO_MEMORY: "Not enough call data to generate a complete analysis.",
    DOWNLOAD_AUDIT: "Download audit log (.md) ↓",
  },
};

interface Detail {
  reading?: string;
  mission?: string;
  next_move?: string;
  support?: string;
}

interface Journey {
  past: string;
  now: string;
  next: string;
}

type Momentum = "red" | "amber" | "green" | undefined;
type EndStep = "none" | "outcome" | "summary" | "report";
type CallOutcome = "closed" | "next_step" | "follow_up" | "lost" | "unclear";

interface CallSummary {
  score: number;
  globalState: string;
  resultLabel: string;
  strengths: string[];
  improvements: string[];
  fullReport?: string;
  debriefReliable?: boolean;
  speakerLowConf?: boolean;
}

interface BrutalAudit {
  verdict: string;
  what_worked: string[];
  what_failed: string[];
  failure_owner: string[];
  missed_closes: string[];
  rules_violated: string[];
  priority_changes: string[];
  prompt_patch: string | null;
  prompt_for_replit: string | null;
  what_i_would_have_done: string;
  perfect_conversation?: string | null;
}

interface VelaAudit {
  verdict: string;
  reliability_level: "high" | "medium" | "low";
  reliability_explanation: string;
  speaker_attribution_quality: string;
  say_now_quality: string;
  loops_detected: boolean;
  loop_explanation: string | null;
  audit_confidence: "high" | "medium" | "low";
  technical_failures: string[];
  system_recommendations: string[];
}

function AuditList({ label, items, bullet, color }: { label: string; items: string[]; bullet: string; color: string }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">{label}</p>
      <div className="flex flex-col gap-1">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <span className={`${color} font-mono text-[10px] shrink-0 mt-px`}>{bullet}</span>
            <p className="text-[11px] font-mono text-zinc-300 leading-relaxed">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TurnLogEntry {
  turn_index: number;
  timestamp: string;
  source_mode: "listen" | "simulate";
  speaker_mode: "auto" | "client" | "me";
  raw_fragment: string;
  normalized_fragment: string;
  inferred_speaker: "CLIENTE" | "YO" | "UNKNOWN";
  memory_before: string[];
  system_output: {
    signal: string;
    say_now: string;
    avoid: string | null;
    detail: { reading: string; mission: string; next_move: string; support: string };
    journey: { past: string; now: string; next: string };
    call_memory: string[];
    momentum: string;
  } | null;
  memory_after: string[];
  response_status: "ok" | "error" | "partial" | "pending";
  parse_error: string | null;
  notes: string | null;
  speaker_confidence?: number;
  speaker_source?: "rule" | "carryover" | "manual" | "unknown";
  auto_repaired: boolean;
  repair_count: number;
  aiReclassified?: boolean;
}

interface TacticalState {
  sayNow: string;
  avoid?: string;
  detail: Detail | null;
  journey: Journey | null;
  callMemory: string[];
  momentum: Momentum;
}

const EMPTY_STATE: TacticalState = { sayNow: "", avoid: undefined, detail: null, journey: null, callMemory: [], momentum: undefined };

const SESSION_KEY = "sc_session_context";
const LABEL_KEY   = "sc_context_label";

function loadSession(): string | null {
  // Always start from the setup screen — never restore a previous session
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  return null;
}
function loadLabel(): string {
  try { return localStorage.getItem(LABEL_KEY) ?? ""; } catch { return ""; }
}
function saveLabel(l: string) {
  try {
    if (!l) localStorage.removeItem(LABEL_KEY);
    else localStorage.setItem(LABEL_KEY, l);
  } catch { /* ignore */ }
}

// ── Color config per detail field — colorblind-safe (blue / teal / white / amber)
const FIELD_CONFIG = {
  LECTURA:   { label: "text-sky-400",   content: "text-sky-200",   size: "text-[20px]" },
  MISION:    { label: "text-teal-400",  content: "text-teal-200",  size: "text-[20px]" },
  SIGUIENTE: { label: "text-white",     content: "text-white",     size: "text-[26px]" },
  APOYO:     { label: "text-amber-400", content: "text-amber-200", size: "text-[20px]" },
} as const;

const FIELD_LABELS: Record<Lang, Record<keyof typeof FIELD_CONFIG, string>> = {
  es: { LECTURA: "LECTURA ·", MISION: "MISIÓN ·", SIGUIENTE: "MOVIMIENTO ·", APOYO: "APOYO ·" },
  en: { LECTURA: "READING ·", MISION: "MISSION ·", SIGUIENTE: "MOVE ·",       APOYO: "SUPPORT ·" },
};

type FieldKey = keyof typeof FIELD_CONFIG;

function DetailField({ fieldKey, value, prefix }: { fieldKey: FieldKey; value?: string; prefix: string }) {
  if (!value) return null;
  const cfg = FIELD_CONFIG[fieldKey];
  return (
    <p className={cn("font-mono leading-relaxed w-full text-center", cfg.size, cfg.content,
      fieldKey === "SIGUIENTE" && "font-semibold"
    )}>
      <span className={cn("text-[9px] tracking-[0.2em] uppercase align-middle mr-2 font-normal", cfg.label)}>
        {prefix}
      </span>
      {value}
    </p>
  );
}

// ── Detail panel — inline labels, full width, big text; EVITA at the bottom
function DetailPanel({ detail, avoid, lang }: { detail: Detail; avoid?: string; lang: Lang }) {
  const labels = FIELD_LABELS[lang];
  const tx = T[lang];
  return (
    <div className="px-6 py-8 flex flex-col gap-9 w-full">
      {detail.reading   && <DetailField fieldKey="LECTURA"   value={detail.reading}   prefix={labels.LECTURA} />}
      {detail.mission   && <DetailField fieldKey="MISION"    value={detail.mission}   prefix={labels.MISION} />}
      {detail.next_move && <DetailField fieldKey="SIGUIENTE" value={detail.next_move} prefix={labels.SIGUIENTE} />}
      {detail.support   && <DetailField fieldKey="APOYO"     value={detail.support}   prefix={labels.APOYO} />}
      {avoid && (
        <p className="font-mono w-full text-center text-[21px] font-semibold uppercase tracking-wide text-orange-400">
          <span className="text-[9px] tracking-[0.2em] uppercase align-middle mr-2 font-normal text-orange-600">
            {tx.AVOID} ·
          </span>
          {avoid}
        </p>
      )}
    </div>
  );
}

// ── Memory bullets — scannable list for expanded journey view
function MemoryBullets({ lines }: { lines: string[] }) {
  const visible = lines.slice(-8);
  return (
    <ul className="px-5 py-3 space-y-2">
      {visible.map((line, i) => {
        const text = line.replace(/^[-–—]\s*/, "");
        const isLast = i === visible.length - 1;
        return (
          <li key={i} className="flex items-start gap-3">
            <span className={cn(
              "shrink-0 mt-[5px] w-1.5 h-1.5 rounded-full",
              isLast ? "bg-zinc-200" : "bg-zinc-600"
            )} />
            <span className={cn(
              "text-[12px] font-mono leading-snug",
              isLast ? "text-zinc-200 font-medium" : "text-zinc-500"
            )}>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Conversation timeline — 3-state cycling on each click
// State 0: only NOW (default) → State 1: 3 nodes → State 2: full memory → back to 0
function ConversationTimeline({ journey, memoryLines }: { journey: Journey; memoryLines: string[] }) {
  const [view, setView] = useState<0 | 1 | 2>(0);
  const cycle = () => setView(v => ((v + 1) % 3) as 0 | 1 | 2);

  return (
    <div className="shrink-0">
      <button onClick={cycle} className="w-full group">

        {/* STATE 0 — only NOW, centered pill box */}
        {view === 0 && (
          <div className="flex justify-center pt-6 pb-3 px-6">
            <div className="border border-white/25 rounded px-5 py-2 group-hover:border-white/40 transition-colors">
              <span className="text-[14px] font-mono text-white uppercase tracking-wide font-semibold text-center leading-snug">
                {journey.now}
              </span>
            </div>
          </div>
        )}

        {/* STATE 1 — 3 nodes, constrained max-width so nodes stay readable and close */}
        {view === 1 && (
          <div className="flex items-start pt-6 pb-3 px-4 max-w-xl mx-auto w-full gap-0">
            {/* ANTES — flex-1 */}
            <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full bg-zinc-500 group-hover:bg-zinc-400 transition-colors mt-0.5" />
              <span className="text-[11px] font-mono text-zinc-200 uppercase tracking-wider text-center leading-tight">
                {journey.past}
              </span>
            </div>
            {/* Left connector */}
            <div className="h-px w-6 bg-zinc-600 mt-[5px] shrink-0" />
            {/* AHORA — slightly wider */}
            <div className="flex-[1.3] flex flex-col items-center gap-2 min-w-0 px-1">
              <div className="w-3 h-3 rounded-full bg-white group-hover:bg-zinc-100 transition-colors" />
              <span className="text-[13px] font-mono text-white uppercase tracking-wide text-center leading-tight font-semibold">
                {journey.now}
              </span>
            </div>
            {/* Right connector */}
            <div className="h-px w-6 bg-zinc-600 mt-[5px] shrink-0" />
            {/* DESPUÉS — flex-1, legible white tone */}
            <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full border border-zinc-400 bg-transparent mt-0.5" />
              <span className="text-[11px] font-mono text-zinc-200 uppercase tracking-wider text-center leading-tight">
                {journey.next}
              </span>
            </div>
          </div>
        )}

        {/* STATE 2 — full session memory (shown below, trigger row stays compact) */}
        {view === 2 && (
          <div className="flex items-center justify-center gap-2 pt-6 pb-3 px-6">
            <div className="w-2 h-2 rounded-full bg-zinc-400 group-hover:bg-zinc-300 transition-colors shrink-0" />
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider text-center leading-snug">
              Historial completo
            </span>
          </div>
        )}

      </button>

      {/* Memory bullets — shown in state 2 */}
      <div
        className="overflow-hidden border-t border-white/5"
        style={{
          maxHeight: view === 2 && memoryLines.length > 0 ? "220px" : "0px",
          transition: "max-height 0.22s ease",
        }}
      >
        <MemoryBullets lines={memoryLines} />
      </div>
    </div>
  );
}

// ── Session persistence ───────────────────────────────────────────────────────
const SESSION_PERSIST_KEY = "vela_session_v1";
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

interface PersistedSession {
  savedAt: number;
  conversationLog: string[];
  turnLog: TurnLogEntry[];
  tacticalState: TacticalState;
  sessionContext: string;
  contextLabel: string;
  sessionId: string;
  lang: Lang;
  analyzeErrorCount: number;
}

function loadSavedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > SESSION_MAX_AGE_MS) {
      localStorage.removeItem(SESSION_PERSIST_KEY);
      return null;
    }
    if (!parsed.conversationLog?.length && !parsed.turnLog?.length) {
      localStorage.removeItem(SESSION_PERSIST_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearSavedSession() {
  try { localStorage.removeItem(SESSION_PERSIST_KEY); } catch { /* ignore */ }
}

// ── Local tactical fallback — pure function, no API call ─────────────────────
// Called when analyze fails to ensure the seller is never left completely blind.
// Only updates sayNow — previous memory, journey, and momentum are preserved.
function computeLocalFallback(fragment: string, lang: "es" | "en"): string {
  const f = fragment.toLowerCase();
  const isClient = f.includes("[cliente]") || f.includes("[client]");
  const isMe = f.includes("[yo]") || f.includes("[me]");

  if (isClient) {
    const hasTechnicalObjES = /renta|alquiler|€|precio|garantía|contrato|subida|derrama|ocupación|rentabilidad|tipo|hipoteca|coste|gasto/.test(f);
    const hasTechnicalObjEN = /rent|lease|price|guarantee|contract|increase|yield|rate|cost|expense|mortgage/.test(f);
    const hasComparisonES = /comparar|frente a|respecto a|versus|otros|otra propuesta|alternativa/.test(f);
    const hasComparisonEN = /compar|versus|vs|alternative|other proposal|another option/.test(f);
    const hasTimeOut = /me tengo que ir|no tengo tiempo|tiempo|me voy|gotta go|have to go|in a hurry/.test(f);

    if (hasTechnicalObjES || hasTechnicalObjEN) {
      return lang === "en"
        ? "Address the concrete technical objection — separate confirmed from unknown data"
        : "Responde la objeción técnica concreta — separa dato confirmado de dato pendiente";
    }
    if (hasComparisonES || hasComparisonEN) {
      return lang === "en"
        ? "Stay on this asset — isolate what criterion is not being met"
        : "Quédate en este activo — aísla qué criterio no se está cumpliendo";
    }
    if (hasTimeOut) {
      return lang === "en"
        ? "Set a concrete next step before they go — date or deliverable"
        : "Asegura siguiente paso concreto antes de que se vaya — fecha o entregable";
    }
    return lang === "en"
      ? "Listen fully — then respond to the specific concern"
      : "Escucha todo — luego responde la duda específica";
  }

  if (isMe) {
    return lang === "en"
      ? "Wait for client reaction before next move"
      : "Espera reacción del cliente antes de tu siguiente jugada";
  }

  return lang === "en"
    ? "Address client's last point directly"
    : "Responde el último punto del cliente directamente";
}

export default function CopilotPage() {
  const [inputMode, setInputMode] = useState<InputMode>("listen");
  const [speakerMode, setSpeakerMode] = useState<SpeakerMode>("auto");
  const [simulateText, setSimulateText] = useState("");
  const [sessionContext, setSessionContext] = useState<string | null>(loadSession);
  const [structuredContext, setStructuredContext] = useState<StructuredContext | undefined>(undefined);
  const [arenaRole, setArenaRole] = useState<ArenaRole | null>(null);
  const [arenaConfig, setArenaConfig] = useState<ArenaConfig>({});
  const [arenaKey, setArenaKey] = useState(0);
  const [initMode, setInitMode] = useState<AppMode | undefined>(undefined);
  const [initRole, setInitRole] = useState<ArenaRole | undefined>(undefined);
  const [tacticalState, setTacticalState] = useState<TacticalState>(EMPTY_STATE);
  const [contextLabel, setContextLabel] = useState<string>(loadLabel);

  // Panel state
  const [detailOpen, setDetailOpen] = useState(false);

  // End-of-call flow
  const [endStep, setEndStep] = useState<EndStep>("none");
  const [callOutcome, setCallOutcome] = useState<CallOutcome | null>(null);
  const [callSummary, setCallSummary] = useState<CallSummary | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [brutalAudit, setBrutalAudit] = useState<BrutalAudit | null>(null);
  const [brutalAuditLoading, setBrutalAuditLoading] = useState(false);
  const [brutalAuditOpen, setBrutalAuditOpen] = useState(false);
  const [brutalAuditError, setBrutalAuditError] = useState(false);
  const [retropassDone, setRetropassDone] = useState(false);
  const [retropassRunning, setRetropassRunning] = useState(false);
  const [whisperTranscript, setWhisperTranscript] = useState<string>("");
  const [humanNotes, setHumanNotes] = useState("");
  const [importedTranscript, setImportedTranscript] = useState("");
  const [importTranscriptOpen, setImportTranscriptOpen] = useState(false);
  const [velaAudit, setVelaAudit] = useState<VelaAudit | null>(null);
  const [velaAuditLoading, setVelaAuditLoading] = useState(false);
  const [velaAuditOpen, setVelaAuditOpen] = useState(false);
  const [velaAuditError, setVelaAuditError] = useState(false);
  const lastSayNowsRef = useRef<string[]>([]);
  const maxSayNowLoopRef = useRef(0);
  const [analyzeErrorCount, setAnalyzeErrorCount] = useState(0);
  const analyzeErrorCountRef = useRef(0);
  // Persists the total number of turns reclassified by the AI retropass across all
  // trigger points in this session (handleSelectOutcome, handleLoadVelaAudit,
  // handleDownloadAuditLog). Used so the audit log shows the correct count even
  // when the download runs after the retropass has already fixed all UNKNOWN turns.
  const aiRetropassReclassifiedRef = useRef(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [liveTranscriptOpen, setLiveTranscriptOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [turnLog, setTurnLog] = useState<TurnLogEntry[]>([]);
  // conversationLog is DERIVED from turnLog — single source of truth.
  // Any repair to turnLog.normalized_fragment instantly propagates to
  // coaching context, debrief, VELA audit, and transcript display.
  // DO NOT add a separate useState here — that was the root cause of stale exports.
  const conversationLog = useMemo(
    () => turnLog.map(t => t.normalized_fragment),
    [turnLog],
  );
  const [sessionId, setSessionId] = useState<string>("");
  const [recoveredSession, setRecoveredSession] = useState<PersistedSession | null>(() => loadSavedSession());

  // Stable listening-session flag — true from "Iniciar escucha" to "Pausar".
  // Unlike isListening from the hook (which flickers during segment restarts),
  // this only changes when the user explicitly toggles the mic.
  const [isSessionListening, setIsSessionListening] = useState(false);

  // AUTO inference state
  const [inferredAutoLabel, setInferredAutoLabel] = useState<string>("");
  const [speakerQualityLevel, setSpeakerQualityLevel] = useState<SpeakerQualityLevel>("normal");
  const speakerSessionRef = useRef<SpeakerAttributionSession>(new SpeakerAttributionSession("es"));

  // ── Feed session context into speaker session for turn-length calibration ──
  // This enables data-driven length-based attribution after enough turns are
  // established, without relying on fragile vocab parsing.
  useEffect(() => {
    if (sessionContext) speakerSessionRef.current.setContext(sessionContext);
  }, [sessionContext]);

  // Language
  const [lang, setLang] = useState<Lang>(loadLang);
  const langRef = useRef(lang);
  langRef.current = lang;

  const sessionActive = sessionContext !== null;
  // True only once at least one analysis has run (call_memory gets populated)
  // Robust check — uses turnLog (populated on both success AND error analyze calls)
  // so a session where all analyze calls failed still shows as "real conversation".
  // Fallback to callMemory for backwards compat if turnLog is somehow empty.
  const hasRealConversation = turnLog.length > 0 || tacticalState.callMemory.length > 0 || conversationLog.length > 0;
  const speakerModeRef = useRef(speakerMode);
  speakerModeRef.current = speakerMode;

  const isPending = useMemo(() => turnLog.some(t => t.response_status === "pending"), [turnLog]);

  const callMemoryRef = useRef(tacticalState.callMemory);
  callMemoryRef.current = tacticalState.callMemory;

  const turnLogRef = useRef<TurnLogEntry[]>([]);
  turnLogRef.current = turnLog;

  const inputModeRef = useRef<"listen" | "simulate">(inputMode === "listen" ? "listen" : "simulate");
  inputModeRef.current = inputMode === "listen" ? "listen" : "simulate";

  const turnCountRef = useRef(0);
  const turnsSinceRetropassRef = useRef(0);
  const aiSpeakerRetropassRef = useRef<(log: TurnLogEntry[]) => Promise<TurnLogEntry[]>>(async log => log);

  const handleAnalysis = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const speaker = speakerModeRef.current;
      const capturedInputMode = inputModeRef.current;
      const capturedSpeakerMode = speakerModeRef.current;
      const timestamp = new Date().toISOString();
      const turnIndex = turnCountRef.current++;

      let inferredSpeaker: "CLIENTE" | "YO" | "UNKNOWN" = "UNKNOWN";
      let speakerConfidence = 1.0;
      let speakerSource: SpeakerResult["source"] = "manual";
      let fullText = "";

      if (speaker === "client") {
        inferredSpeaker = "CLIENTE";
        const cleaned = text.replace(/^\s*\[(YO|CLIENTE|ME|CLIENT)\]:\s*/i, "").trimStart();
        fullText = "[CLIENTE]: " + cleaned;
      } else if (speaker === "me") {
        inferredSpeaker = "YO";
        const cleaned = text.replace(/^\s*\[(YO|CLIENTE|ME|CLIENT)\]:\s*/i, "").trimStart();
        fullText = "[YO]: " + cleaned;
      } else {
        // AUTO mode — conversational reconstruction pipeline.
        // classifySequence() splits the blob into mini-turns at probable speaker-switch
        // boundaries, attributes each segment independently with history-based alternation
        // bias flowing naturally between them, and records all to session history.
        speakerSessionRef.current.setLang(langRef.current);
        const sequence = speakerSessionRef.current.classifySequence(text, turnIndex);

        // Advance turnCountRef for any extra segments beyond the first.
        // (turnIndex already consumed the first slot via turnCountRef.current++)
        if (sequence.length > 1) turnCountRef.current += sequence.length - 1;

        // Per-segment debug log (AUTO mode only)
        if (capturedInputMode === "listen") {
          for (const { text: seg, result, turnIdx: tidx } of sequence) {
            const sp = result.speaker === "client" ? "CLIENTE"
              : result.speaker === "me" ? "YO" : "UNKNOWN";
            console.debug(
              `[vela:analyze] turn=${tidx} mode=listen ` +
              `speaker=${sp} source=${result.source} conf=${result.confidence.toFixed(2)} ` +
              `chars=${seg.length}` +
              (sequence.length > 1 ? " [mini-turn]" : "") +
              (seg.length > 300 ? " [WARN: still long]" : ""),
            );
          }
        }

        // Dominant speaker for UI state: last confident segment wins, or last overall
        const lastConf = [...sequence].reverse()
          .find(s => s.result.speaker !== "unknown" && s.result.confidence >= 0.45);
        const dominant = lastConf?.result ?? sequence[sequence.length - 1]!.result;
        speakerConfidence = sequence.reduce((sum, s) => sum + s.result.confidence, 0) / sequence.length;
        speakerSource = dominant.source;

        if (dominant.speaker === "client") {
          setInferredAutoLabel(dominant.label);
          inferredSpeaker = "CLIENTE";
        } else if (dominant.speaker === "me") {
          setInferredAutoLabel(dominant.label);
          inferredSpeaker = "YO";
        } else {
          setInferredAutoLabel("");
        }
        setSpeakerQualityLevel(speakerSessionRef.current.getQualityLevel());

        // Build structured transcript — each mini-turn gets its own speaker prefix.
        // Single-segment blobs (no split found) use the compact single-prefix format.
        if (sequence.length === 1) {
          const seg = sequence[0]!;
          const prefix = seg.result.speaker === "client" ? "[CLIENTE]: "
            : seg.result.speaker === "me" ? "[YO]: " : "";
          const cleaned = seg.text.replace(/^\s*\[(YO|CLIENTE|ME|CLIENT)\]:\s*/i, "").trimStart();
          fullText = prefix + cleaned;
        } else {
          fullText = sequence.map(({ text: seg, result }) => {
            const prefix = result.speaker === "client" ? "[CLIENTE]: "
              : result.speaker === "me" ? "[YO]: " : "";
            const cleaned = seg.replace(/^\s*\[(YO|CLIENTE|ME|CLIENT)\]:\s*/i, "").trimStart();
            return prefix + cleaned;
          }).join("\n");
        }
      }
      // Build enriched conversation history: dialogue + VELA coaching interleaved.
      // This lets the API see both what was said AND what VELA already recommended,
      // which dramatically reduces say_now loops and improves contextual coaching.
      const HISTORY_MAX_TURNS = 10;
      const HISTORY_TRIGGER_TURNS = 14;
      const prevTurns = turnLogRef.current;
      const recentTurns = prevTurns.slice(-HISTORY_MAX_TURNS);
      const enrichedHistory: string[] = [];
      for (const t of recentTurns) {
        enrichedHistory.push(t.normalized_fragment);
        if (t.system_output?.say_now) {
          enrichedHistory.push(`[VELA→]: ${t.system_output.say_now}`);
        }
      }
      enrichedHistory.push(fullText);
      let conversationHistoryPayload: string[];
      if (prevTurns.length > HISTORY_TRIGGER_TURNS) {
        const olderCount = prevTurns.length - HISTORY_MAX_TURNS;
        const summaryLine = langRef.current === "es"
          ? `[Resumen: ${olderCount} intercambio${olderCount !== 1 ? "s" : ""} anteriores]`
          : `[Summary: ${olderCount} earlier exchange${olderCount !== 1 ? "s" : ""}]`;
        conversationHistoryPayload = [summaryLine, ...enrichedHistory];
      } else {
        conversationHistoryPayload = enrichedHistory;
      }

      // Snapshot memory before this turn
      const memoryBefore = callMemoryRef.current.slice();

      // keep call_memory string for fallback / backward compat (used in summarize endpoint)
      const memLines = callMemoryRef.current;
      const memoryStr = memLines.length > 0
        ? memLines.map(l => `- ${l}`).join("\n")
        : undefined;

      // ── say_now loop detection — count consecutive identical say_nows ────────
      const recentSayNows = lastSayNowsRef.current;
      let sayNowLoopCount = 0;
      if (recentSayNows.length >= 2) {
        const last = recentSayNows[recentSayNows.length - 1].toLowerCase().trim();
        for (let i = recentSayNows.length - 2; i >= 0; i--) {
          if (recentSayNows[i].toLowerCase().trim() === last) sayNowLoopCount++;
          else break;
        }
        sayNowLoopCount++; // include the "last" itself as first in the run
      }

      // ── listen reliability — computed from error rate + speaker quality ───────
      const totalTurnsSoFar = Math.max(turnCountRef.current, 1);
      const errorRate = analyzeErrorCountRef.current / totalTurnsSoFar;
      const qualLevel = speakerModeRef.current === "auto" ? speakerSessionRef.current.getQualityLevel() : "normal";
      const unknownMetrics = speakerModeRef.current === "auto" ? speakerSessionRef.current.getMetrics() : null;
      const unknownRate = unknownMetrics?.unknown_rate ?? 0;
      const listenReliability: "high" | "medium" | "low" =
        (unknownRate > 0.5 || errorRate > 0.3 || sayNowLoopCount >= 5 || qualLevel === "low")
          ? "low"
          : (unknownRate > 0.25 || errorRate > 0.1 || sayNowLoopCount >= 3 || qualLevel === "watch")
            ? "medium"
            : "high";

      // ── Listen-mode debug log (manual speaker modes only) ────────────────
      // AUTO mode emits per-segment logs inside the classifySequence block above.
      if (capturedInputMode === "listen" && capturedSpeakerMode !== "auto") {
        console.debug(
          `[vela:analyze] turn=${turnIndex} mode=listen ` +
          `speaker=${inferredSpeaker} source=${speakerSource} conf=${speakerConfidence.toFixed(2)} ` +
          `chars=${fullText.length}`,
        );
      }

      // ── Enrich context with detected speaker names ──────────────────────
      // When speaker session has parsed names from context, append them as
      // explicit identifiers so the AI can use them for per-turn attribution
      // even when the frontend classifier returned UNKNOWN.
      let apiContext: string | undefined = sessionContext ?? undefined;
      if (apiContext && capturedSpeakerMode === "auto") {
        const names = speakerSessionRef.current.getDetectedNames();
        if (names.vendor || names.client) {
          const nameHints = [
            names.vendor ? `[YO]=${names.vendor}` : null,
            names.client ? `[CLIENTE]=${names.client}` : null,
          ].filter(Boolean).join(", ");
          apiContext = `${apiContext}\n[IDENTIFICACIÓN DE SPEAKERS: ${nameHints}]`;
        }
      }

      // ── ADD TURN TO TRANSCRIPT IMMEDIATELY (pending status) ─────────────────
      // Text appears the instant audio is captured — NOT after the API responds.
      // onSuccess / onError update this entry in-place by turn_index.
      const pendingBase = {
        turn_index: turnIndex,
        timestamp,
        source_mode: capturedInputMode,
        speaker_mode: capturedSpeakerMode,
        raw_fragment: text,
        normalized_fragment: fullText,
        inferred_speaker: inferredSpeaker,
        memory_before: memoryBefore,
        system_output: null,
        memory_after: memoryBefore,
        response_status: "pending" as const,
        parse_error: null,
        notes: null,
        speaker_confidence: capturedSpeakerMode === "auto" ? speakerConfidence : undefined,
        speaker_source: capturedSpeakerMode === "auto" ? (speakerSource as "rule" | "carryover" | "manual" | "unknown") : undefined,
        auto_repaired: false,
        repair_count: 0,
      };
      setTurnLog(prev => [...prev, pendingBase]);

      // Direct fetch — each turn gets its own independent promise.
      // Using useMutation's mutate() caused per-call callbacks to be silently
      // dropped when multiple concurrent calls overlapped (API takes 5-8s,
      // interval is 3s). A plain promise guarantees onSuccess/onError always fire.
      analyzeConversation({
        text: fullText,
        ...(apiContext ? { context: apiContext } : {}),
        ...(memoryStr ? { call_memory: memoryStr } : {}),
        conversation_history: conversationHistoryPayload,
        ...(structuredContext ? { structured_context: structuredContext } : {}),
        lang: langRef.current,
        ...(capturedSpeakerMode === "auto" && speakerConfidence < 1.0
          ? { speaker_confidence: speakerConfidence }
          : {}),
        ...(sayNowLoopCount >= 3 ? { say_now_loop_count: sayNowLoopCount } : {}),
        ...(listenReliability !== "high" ? { listen_reliability: listenReliability } : {}),
      } as any)
        .then((res: any) => {
          // ── Runtime error path ──────────────────────────────────────────────
          if (res._runtime_error) {
            setAnalyzeErrorCount(c => { analyzeErrorCountRef.current = c + 1; return c + 1; });
            const fallbackSayNow = computeLocalFallback(fullText, langRef.current);
            setTacticalState(prev => ({ ...prev, sayNow: fallbackSayNow }));
            setTurnLog(prev => prev.map(t => t.turn_index !== turnIndex ? t : {
              ...t,
              response_status: "error" as const,
              parse_error: "API runtime error — local fallback applied",
              notes: `local_fallback: ${fallbackSayNow}`,
            }));
            return;
          }
          // ── Normal success path ──────────────────────────────────────────────
          const rawLines = res.call_memory?.summary_lines ?? [];
          const memoryAfter = rawLines.length > 0 ? rawLines : callMemoryRef.current.slice();
          // ── Track say_now for loop detection ──────────────────────────────
          const isFallbackResponse = res.signal === "análisis recuperándose" || res.signal === "analysis recovering";
          if (res.say_now && !isFallbackResponse) {
            const updated = [...lastSayNowsRef.current, res.say_now].slice(-10);
            lastSayNowsRef.current = updated;
            let runLen = 1;
            const last = updated[updated.length - 1].toLowerCase().trim();
            for (let i = updated.length - 2; i >= 0; i--) {
              if (updated[i].toLowerCase().trim() === last) runLen++;
              else break;
            }
            if (runLen > maxSayNowLoopRef.current) maxSayNowLoopRef.current = runLen;
          }
          setTacticalState({
            sayNow: res.say_now,
            avoid: res.avoid || undefined,
            detail: res.detail ?? null,
            journey: res.journey ?? null,
            callMemory: memoryAfter,
            momentum: res.momentum as Momentum,
          });
          setTurnLog(prev => {
            const withUpdate = prev.map(t => {
              if (t.turn_index !== turnIndex) return t;
              return {
                ...t,
                system_output: {
                  signal: res.signal ?? "",
                  say_now: res.say_now,
                  avoid: res.avoid ?? null,
                  detail: {
                    reading: res.detail?.reading ?? "",
                    mission: res.detail?.mission ?? "",
                    next_move: res.detail?.next_move ?? "",
                    support: res.detail?.support ?? "",
                  },
                  journey: {
                    past: res.journey?.past ?? "",
                    now: res.journey?.now ?? "",
                    next: res.journey?.next ?? "",
                  },
                  call_memory: memoryAfter,
                  momentum: res.momentum ?? "amber",
                },
                memory_after: memoryAfter,
                response_status: "ok" as const,
                parse_error: null,
              };
            });
            if (capturedSpeakerMode === "auto") {
              const currentResult: SpeakerResult = {
                speaker: inferredSpeaker === "CLIENTE" ? "client" : inferredSpeaker === "YO" ? "me" : "unknown",
                confidence: speakerConfidence,
                source: speakerSource,
                label: "",
              };
              const repairs = speakerSessionRef.current.retrospectiveRepair(currentResult);
              if (repairs.size > 0) {
                return withUpdate.map(entry => {
                  const repair = repairs.get(entry.turn_index);
                  if (!repair) return entry;
                  const newSpeakerLabel = repair.speaker === "client" ? "CLIENTE" : "YO";
                  const newPrefix = repair.speaker === "client" ? "[CLIENTE]: " : "[YO]: ";
                  const cleanRaw = entry.raw_fragment.replace(/^\s*\[(YO|CLIENTE|ME|CLIENT)\]:\s*/i, "").trimStart();
                  return {
                    ...entry,
                    inferred_speaker: newSpeakerLabel as "CLIENTE" | "YO" | "UNKNOWN",
                    normalized_fragment: newPrefix + cleanRaw,
                    speaker_confidence: repair.confidence,
                    auto_repaired: true,
                    repair_count: (entry.repair_count ?? 0) + 1,
                  };
                });
              }
            }
            return withUpdate;
          });
          // ── Mid-session AI retropass every 7 confirmed turns in AUTO mode ──
          if (capturedSpeakerMode === "auto") {
            turnsSinceRetropassRef.current++;
            if (turnsSinceRetropassRef.current >= 7) {
              turnsSinceRetropassRef.current = 0;
              const currentLog = turnLogRef.current;
              aiSpeakerRetropassRef.current(currentLog).then(updated => {
                if (updated !== currentLog) setTurnLog(updated);
              }).catch(() => { /* silent fail */ });
            }
          }
        })
        .catch(() => {
          setAnalyzeErrorCount(c => { analyzeErrorCountRef.current = c + 1; return c + 1; });
          setTurnLog(prev => prev.map(t => t.turn_index !== turnIndex ? t : {
            ...t,
            response_status: "error" as const,
            parse_error: "API call failed",
          }));
        });
    },
    [sessionContext]
  );

  const { isSupported, isListening, error: speechError, interimText, startListening, stopListening } =
    useSpeech({ onAnalyzeReady: handleAnalysis, analysisIntervalMs: 8000, lang });
  const { startRecording, stopRecording } = useAudioRecorder();

  // Keyboard shortcuts
  useEffect(() => {
    if (!sessionActive) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "button") return;
      const idx = SPEAKER_ORDER.indexOf(speakerModeRef.current);
      if (e.key === "ArrowLeft") { e.preventDefault(); setSpeakerMode(SPEAKER_ORDER[Math.max(0, idx - 1)]); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setSpeakerMode(SPEAKER_ORDER[Math.min(SPEAKER_ORDER.length - 1, idx + 1)]); }
      else if (e.key === " ") { e.preventDefault(); setSpeakerMode(SPEAKER_ORDER[(idx + 1) % SPEAKER_ORDER.length]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionActive]);

  const handleContextReady = (context: string, sc?: StructuredContext) => {
    setSessionContext(context);
    setStructuredContext(sc);
    setTacticalState(EMPTY_STATE);
    setContextLabel("");
    saveLabel("");
    setDetailOpen(false);
    setTurnLog([]);
    turnCountRef.current = 0;
    setSessionId(Date.now().toString(36));
    // Generate short context label in background
    void fetch("/api/copilot/context-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, lang: langRef.current }),
    })
      .then(r => r.json())
      .then(({ label }: { label: string }) => {
        if (label) { setContextLabel(label); saveLabel(label); }
      })
      .catch(() => {});
  };

  const handleArenaReady = (context: string, role: ArenaRole, config: ArenaConfig) => {
    setSessionContext(context);
    setArenaRole(role);
    setArenaConfig(config);
    setContextLabel("");
    saveLabel("");
    // Generate short label for the top bar
    void fetch("/api/copilot/context-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, lang: langRef.current }),
    })
      .then(r => r.json())
      .then(({ label }: { label: string }) => {
        if (label) { setContextLabel(label); saveLabel(label); }
      })
      .catch(() => {});
  };

  // ── Save session to localStorage on every new turn ───────────────────────────
  useEffect(() => {
    if (!sessionContext || (turnLog.length === 0 && conversationLog.length === 0)) return;
    const toSave: PersistedSession = {
      savedAt: Date.now(),
      conversationLog,
      turnLog,
      tacticalState,
      sessionContext,
      contextLabel: contextLabel || "",
      sessionId,
      lang,
      analyzeErrorCount,
    };
    try { localStorage.setItem(SESSION_PERSIST_KEY, JSON.stringify(toSave)); } catch { /* ignore */ }
  }, [turnLog.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Restore core state from a persisted session ──────────────────────────
  const applyRecoveredSession = (s: PersistedSession) => {
    setTurnLog(s.turnLog); // conversationLog is derived from turnLog — no separate restore needed
    setTacticalState(s.tacticalState);
    setSessionContext(s.sessionContext);
    setContextLabel(s.contextLabel);
    saveLabel(s.contextLabel);
    setSessionId(s.sessionId);
    setLang(s.lang);
    setAnalyzeErrorCount(s.analyzeErrorCount);
    analyzeErrorCountRef.current = s.analyzeErrorCount;
    setRecoveredSession(null);
    clearSavedSession();
  };

  // Continue mid-call: restore everything and return to active session
  const handleRecoverAndContinue = () => {
    if (!recoveredSession) return;
    applyRecoveredSession(recoveredSession);
    // endStep stays "none" — user lands back in the active session UI
  };

  // Post-call review: restore and jump straight to the outcome / audit flow
  const handleRecoverAndFinish = () => {
    if (!recoveredSession) return;
    applyRecoveredSession(recoveredSession);
    setEndStep("outcome");
  };

  const handleActuallyClearSession = () => {
    clearSavedSession();
    setRecoveredSession(null);
    setEndStep("none");
    setCallOutcome(null);
    setCallSummary(null);
    setSessionContext(null);
    setArenaRole(null);
    setTacticalState(EMPTY_STATE);
    setContextLabel("");
    saveLabel("");
    setDetailOpen(false);
    setLiveTranscriptOpen(false);
    stopListening();
    setIsSessionListening(false);
    setInputMode("listen");
    setSpeakerMode("auto");
    setTurnLog([]);
    setSessionId("");
    turnCountRef.current = 0;
    setInitMode(undefined);
    setInitRole(undefined);
    setBrutalAudit(null);
    setBrutalAuditOpen(false);
    setBrutalAuditError(false);
    setVelaAudit(null);
    setVelaAuditOpen(false);
    setVelaAuditError(false);
    setImportedTranscript("");
    setImportTranscriptOpen(false);
    setAnalyzeErrorCount(0);
    analyzeErrorCountRef.current = 0;
    aiRetropassReclassifiedRef.current = 0;
    turnsSinceRetropassRef.current = 0;
    lastSayNowsRef.current = [];
    maxSayNowLoopRef.current = 0;
    setTranscriptOpen(false);
    speakerSessionRef.current.reset();
    setSpeakerQualityLevel("normal");
  };

  const handleGoArena = () => {
    handleActuallyClearSession();
    setInitMode("arena");
  };

  const handleGoArenaRole = () => {
    handleActuallyClearSession();
    setInitMode("arena");
    setInitRole(arenaRole ?? undefined);
  };

  const handleClearSession = async () => {
    stopListening();
    setIsSessionListening(false);
    const audioBlob = await stopRecording();
    if (audioBlob) {
      const formData = new FormData();
      const ext = audioBlob.type.includes("ogg") ? "ogg" : "webm";
      formData.append("audio", audioBlob, `session.${ext}`);
      formData.append("context", sessionContext || "");
      try {
        const res = await fetch("/api/copilot/transcribe", { method: "POST", body: formData });
        const data = await res.json();
        if (data.transcript) {
          console.log("[vela:whisper] transcript ready", data.transcript.slice(0, 100));
          setWhisperTranscript(data.transcript);
        }
      } catch (e) {
        console.error("[vela:whisper] transcription failed", e);
      }
    }
    // If no real conversation happened, just exit — no scoring, no outcome picker
    if (!hasRealConversation) {
      handleActuallyClearSession();
      return;
    }
    setEndStep("outcome");
  };

  const computeSpeakerUncertainty = () => {
    if (speakerMode !== "auto" || turnLog.length === 0) return undefined;
    const unknownTurns = turnLog.filter(t => t.inferred_speaker === "UNKNOWN").length;
    const rate = unknownTurns / turnLog.length;
    return { high: rate > 0.4, rate, unknown_turns: unknownTurns, total_turns: turnLog.length };
  };

  const buildClosingExcerpt = (maxTurns = 10) => {
    if (turnLog.length === 0) return [];
    const useful = turnLog.filter(t => t.normalized_fragment?.trim().length > 0);
    return useful.slice(-maxTurns).map(t => ({
      turn: t.turn_index,
      speaker: t.inferred_speaker,
      text: t.normalized_fragment,
    }));
  };

  const buildAuditHintsPack = () => {
    const isNextStepOutcome = callOutcome === "next_step";
    const isLostOutcome = callOutcome === "lost";
    const closingText = buildClosingExcerpt(12).map(t => t.text).join(" ").toLowerCase();
    const memText = (tacticalState.callMemory ?? []).join(" ").toLowerCase();
    const combinedText = memText + " " + closingText;

    const dtTerms = ["fecha", "lunes", "martes", "miércoles", "jueves", "viernes", "mañana", "próxima semana", "monday", "tuesday", "wednesday", "thursday", "friday", "tomorrow", "next week", ":00", " am ", " pm ", "a las "];
    const chTerms = ["videollamada", "zoom", "teams", "meet", "correo", "email", "reunión", "meeting", "llamada", "enlace"];
    const dlTerms = ["propuesta", "contrato", "resumen", "documentación", "información", "proposal", "contract", "summary", "documentation", "presupuesto", "oferta"];
    const decTerms = ["criterio", "condición", "criterion", "acordad", "agreed", "compromi"];

    const hasDt = dtTerms.some(t => combinedText.includes(t));
    const hasCh = chTerms.some(t => combinedText.includes(t));
    const hasDl = dlTerms.some(t => combinedText.includes(t));
    const hasDec = decTerms.some(t => combinedText.includes(t));
    const hasOp = hasDt || hasCh || hasDl;

    const nextStepQuality = isNextStepOutcome
      ? (hasOp && hasDec ? "strong" : hasOp ? "useful" : "weak")
      : null;

    const suspectedSoftNextStep = isNextStepOutcome && nextStepQuality === "weak" ? "yes" : "no";
    const likelyPrimaryFailure = isLostOutcome ? "seller" : "none";

    return {
      likely_primary_failure: likelyPrimaryFailure,
      suspected_soft_next_step: suspectedSoftNextStep,
      next_step_quality: nextStepQuality,
    };
  };

  /**
   * Apply a full retroactive speaker repair pass using the current session state.
   *
   * Returns the REPAIRED TurnLogEntry array synchronously — safe to use immediately
   * in the same handler tick without waiting for React state to update.
   * Also queues a setTurnLog() call so the UI reflects the repairs.
   *
   * Call this before any post-call export: summarize, VELA audit, brutal audit, download.
   * No-op (returns current log) when speakerMode is not "auto" or no repairs apply.
   */
  const applyRetroRepairs = useCallback((): TurnLogEntry[] => {
    const current = turnLogRef.current;
    if (speakerMode !== "auto") return current;
    const entries = current.map(t => ({
      turnIndex: t.turn_index,
      text: t.raw_fragment,
      currentSpeaker: (t.inferred_speaker === "CLIENTE" ? "client" : t.inferred_speaker === "YO" ? "me" : "unknown") as SpeakerLabel,
      currentConf: t.speaker_confidence ?? 0,
    }));
    const repairs = speakerSessionRef.current.fullRetroPass(entries);
    if (repairs.size === 0) return current;
    const repaired = current.map(entry => {
      const repair = repairs.get(entry.turn_index);
      if (!repair) return entry;
      const newSpeakerLabel = repair.speaker === "client" ? "CLIENTE" : "YO";
      const newPrefix = repair.speaker === "client" ? "[CLIENTE]: " : "[YO]: ";
      const cleanRaw = entry.raw_fragment
        .replace(/^\s*\[(YO|CLIENTE|ME|CLIENT)\]:\s*/i, "")
        .trimStart();
      return {
        ...entry,
        inferred_speaker: newSpeakerLabel as "CLIENTE" | "YO" | "UNKNOWN",
        normalized_fragment: newPrefix + cleanRaw,
        speaker_confidence: repair.confidence,
        auto_repaired: true,
        repair_count: (entry.repair_count ?? 0) + 1,
      };
    });
    setTurnLog(repaired);  // queue UI update
    return repaired;
  }, [speakerMode]);

  // ── In-session retroactive repair when speaker names are newly learned ───────
  // Each time a turn is added, check whether learnNamesFromSpeech() discovered
  // a new speaker name inside that turn. If yes, re-classify ALL previous turns
  // that were low-confidence or UNKNOWN using the newly available name signal.
  // This is what makes "soy Alberto" in turn 1 retroactively fix turns 0-N.
  useEffect(() => {
    if (speakerMode !== "auto" || turnLog.length === 0) return;
    const learned = speakerSessionRef.current.getAndResetLearnCount();
    if (learned > 0) {
      applyRetroRepairs();
    }
  }, [turnLog.length, speakerMode, applyRetroRepairs]);

  /**
   * Fix C — AI-powered semantic retropass (post-call only).
   *
   * Sends UNKNOWN / low-confidence turns to gpt-4o-mini with the session context
   * and asks it to classify each as VENDOR or CLIENT by content, not just heuristics.
   * This is the last-resort layer that runs AFTER the heuristic retropass.
   *
   * Returns the updated TurnLogEntry array. Never throws — silently returns the
   * input log unchanged if the API call fails.
   *
   * Call only post-call (never during live session).
   */
  const aiSpeakerRetropass = useCallback(async (log: TurnLogEntry[], forceAll = false): Promise<TurnLogEntry[]> => {
    if (speakerMode !== "auto") return log;
    if (log.length === 0) return log;

    // Only retropass confirmed turns — pending ones haven't finished their own API call yet.
    const confirmedLog = forceAll
      ? log
      : log.filter(t => t.response_status !== "pending");
    if (confirmedLog.length === 0) return log;

    // Collect candidate indices. forceAll=true (used at end-of-call) includes every
    // turn so the final audit gets the best possible speaker attribution.
    const candidateIndices = new Set(
      confirmedLog
        .filter(t => forceAll || t.inferred_speaker === "UNKNOWN" || (t.speaker_confidence ?? 0) < 0.85)
        .map(t => t.turn_index),
    );

    // Skip only when every turn is high-confidence — medium-conf turns still benefit
    // from the model seeing the full transcript context even if they aren't candidates.
    const hasLowConfTurns = forceAll || confirmedLog.some(t => (t.speaker_confidence ?? 0) < 0.85);
    if (!hasLowConfTurns) return log;

    const { vendor, client } = speakerSessionRef.current.getDetectedNames();
    try {
      const res = await fetch("/api/copilot/speaker-retropass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Send confirmed turns only — pending entries don't have final text yet.
          turns: confirmedLog.map(t => ({ index: t.turn_index, text: t.raw_fragment })),
          setup_context: sessionContext ?? undefined,
          vendor_name: vendor,
          client_name: client,
          lang,
        }),
      });
      if (!res.ok) return log;
      const data = await res.json() as { classifications: Record<string, string> };
      const classMap = data.classifications ?? {};
      console.log('[vela:retropass] classifications received:', JSON.stringify(classMap));
      console.log('[vela:retropass] candidates:', JSON.stringify([...candidateIndices]));
      if (Object.keys(classMap).length === 0) return log;

      let reclassifiedCount = 0;
      const updated = log.map(entry => {
        const cls = classMap[String(entry.turn_index)];
        if (!cls || cls === "UNKNOWN") return entry;

        // Fix B: only apply corrections to candidate turns.
        // High-confidence turns (>= 0.65, not in candidateIndices) are respected
        // even when the model disagrees.
        const isCandidate = candidateIndices.has(entry.turn_index);
        if (!isCandidate) return entry;

        const newSpeaker = cls === "VENDOR" ? "YO" as const : "CLIENTE" as const;
        if (entry.inferred_speaker === newSpeaker) return entry;

        reclassifiedCount++;
        const prefix = lang === "es"
          ? (newSpeaker === "YO" ? "[YO]: " : "[CLIENTE]: ")
          : (newSpeaker === "YO" ? "[ME]: " : "[CLIENT]: ");
        const cleanRaw = entry.raw_fragment
          .replace(/^\s*\[(YO|CLIENTE|ME|CLIENT)\]:\s*/i, "")
          .trimStart();
        return {
          ...entry,
          inferred_speaker: newSpeaker,
          normalized_fragment: prefix + cleanRaw,
          aiReclassified: true,
          auto_repaired: true,
          repair_count: (entry.repair_count ?? 0) + 1,
        };
      });

      if (reclassifiedCount > 0) {
        aiRetropassReclassifiedRef.current += reclassifiedCount;
        console.debug(`[vela:speaker] aiSpeakerRetropass reclassified ${reclassifiedCount} turn(s) (session total: ${aiRetropassReclassifiedRef.current})`);
        setTurnLog(updated);
      }
      return updated;
    } catch {
      return log;
    }
  }, [speakerMode, sessionContext, lang]);
  aiSpeakerRetropassRef.current = aiSpeakerRetropass;

  const handleSelectOutcome = async (outcome: CallOutcome) => {
    setCallOutcome(outcome);
    setEndStep("summary");
    setIsSummarizing(true);
    const memory = tacticalState.callMemory;
    const speakerUncertainty = computeSpeakerUncertainty();
    // Run heuristic retropass (synchronous). AI retropass is user-triggered via button in results.
    const heuristicLog = applyRetroRepairs();
    setRetropassDone(false);
    const convExcerpt = heuristicLog.map(t => t.normalized_fragment).slice(-12);
    const postRepairUnknownRate = speakerMode === "auto"
      ? heuristicLog.filter(t => t.inferred_speaker === "UNKNOWN").length / Math.max(heuristicLog.length, 1)
      : 0;
    const speakerLowConf = speakerMode === "auto" && postRepairUnknownRate > 0.35;
    try {
      const res = await fetch("/api/copilot/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_memory: memory,
          outcome,
          lang: langRef.current,
          analyze_failure_count: analyzeErrorCountRef.current,
          conversation_excerpt: convExcerpt.length > 0 ? convExcerpt : undefined,
          imported_transcript: importedTranscript.trim() || undefined,
          ...(speakerUncertainty ? { speaker_uncertainty: speakerUncertainty } : {}),
        }),
      });
      const data = await res.json() as {
        score: number; global_state: string; result_label: string;
        strengths: string[]; improvements: string[]; full_report?: string;
        debrief_reliable?: boolean;
      };
      setCallSummary({
        score: data.score,
        globalState: data.global_state,
        resultLabel: data.result_label,
        strengths: data.strengths ?? [],
        improvements: data.improvements ?? [],
        debriefReliable: data.debrief_reliable,
        speakerLowConf,
      });
    } catch {
      setCallSummary({
        score: analyzeErrorCountRef.current > 0 ? 3 : 5,
        globalState: analyzeErrorCountRef.current > 0
          ? (langRef.current === "en" ? "unreliable" : "no fiable")
          : (langRef.current === "en" ? "workable" : "trabajable"),
        resultLabel: outcome,
        strengths: [],
        improvements: analyzeErrorCountRef.current > 0
          ? [langRef.current === "en"
              ? `⚠ Debrief unreliable — ${analyzeErrorCountRef.current} analysis failure(s)`
              : `⚠ Debrief no fiable — ${analyzeErrorCountRef.current} fallo(s) de análisis`]
          : [],
        debriefReliable: analyzeErrorCountRef.current === 0,
        speakerLowConf,
      });
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleGenerateReport = async () => {
    setIsGeneratingReport(true);
    const speakerUncertainty = computeSpeakerUncertainty();
    const repairedLog = applyRetroRepairs();
    const convExcerpt = repairedLog.map(t => t.normalized_fragment).slice(-12);
    try {
      const res = await fetch("/api/copilot/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_memory: tacticalState.callMemory,
          outcome: callOutcome,
          lang: langRef.current,
          full_report: true,
          analyze_failure_count: analyzeErrorCountRef.current,
          conversation_excerpt: convExcerpt.length > 0 ? convExcerpt : undefined,
          ...(speakerUncertainty ? { speaker_uncertainty: speakerUncertainty } : {}),
        }),
      });
      const data = await res.json() as { full_report?: string };
      setCallSummary(prev => prev ? { ...prev, fullReport: data.full_report } : prev);
      setEndStep("report");
    } catch { /* ignore */ } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleCopyText = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleLoadBrutalAudit = async (force = false) => {
    if (!force && (brutalAudit || brutalAuditLoading)) return;
    setBrutalAuditLoading(true);
    setBrutalAuditError(false);
    const speakerUncertainty = computeSpeakerUncertainty();
    const closingExcerpt = buildClosingExcerpt(10);
    const hintsPack = buildAuditHintsPack();
    try {
      const res = await fetch("/api/copilot/audit-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_memory: tacticalState.callMemory,
          outcome: callOutcome ?? "unclear",
          context: sessionContext ?? undefined,
          lang,
          closing_excerpt: closingExcerpt.length > 0 ? closingExcerpt : undefined,
          imported_transcript: importedTranscript.trim() || undefined,
          session_summary: callSummary ? {
            score: callSummary.score,
            global_state: callSummary.globalState,
            result_label: callSummary.resultLabel,
            strengths: callSummary.strengths,
            improvements: callSummary.improvements,
          } : undefined,
          audit_hints_pack: hintsPack,
          human_notes: humanNotes.trim() || undefined,
          ...(speakerUncertainty ? { speaker_uncertainty: speakerUncertainty } : {}),
          ...(whisperTranscript ? { whisper_transcript: whisperTranscript } : {}),
        }),
      });
      if (!res.ok) throw new Error("audit failed");
      const data = await res.json() as BrutalAudit;
      setBrutalAudit(data);
    } catch {
      setBrutalAuditError(true);
    } finally {
      setBrutalAuditLoading(false);
    }
  };

  const handleLoadVelaAudit = async (force = false) => {
    if (!force && (velaAudit || velaAuditLoading)) return;
    setVelaAuditLoading(true);
    setVelaAuditError(false);
    // Heuristic retropass first, then AI semantic retropass
    const heuristicLog = applyRetroRepairs();
    const repairedLog = await aiSpeakerRetropass(heuristicLog);
    const speakerMetrics = speakerMode === "auto" ? speakerSessionRef.current.getMetrics() : null;
    const unknownRate = speakerMetrics?.unknown_rate ?? 0;
    const totalTurns = repairedLog.length;
    const errorRate = analyzeErrorCount / Math.max(totalTurns, 1);
    const listenReliability: "high" | "medium" | "low" =
      (unknownRate > 0.5 || errorRate > 0.3 || maxSayNowLoopRef.current >= 5)
        ? "low"
        : (unknownRate > 0.25 || errorRate > 0.1 || maxSayNowLoopRef.current >= 3)
          ? "medium"
          : "high";
    const velaSuggestions = repairedLog
      .filter(t => t.system_output?.say_now)
      .map(t => t.system_output!.say_now);
    const finalMemory = repairedLog.length > 0
      ? repairedLog[repairedLog.length - 1].memory_after
      : tacticalState.callMemory;
    const memoryStr = finalMemory.length > 0 ? finalMemory.map(l => `- ${l}`).join("\n") : undefined;
    const repairedConvLog = repairedLog.map(t => t.normalized_fragment);
    try {
      const res = await fetch("/api/copilot/audit-report-vela", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lang,
          session_metrics: {
            analyze_error_count: analyzeErrorCount,
            speaker_unknown_rate: unknownRate || undefined,
            say_now_loop_count: maxSayNowLoopRef.current || undefined,
            total_turns: totalTurns || undefined,
            listen_reliability: listenReliability,
          },
          auto_transcript: repairedConvLog.length > 0 ? repairedConvLog : undefined,
          imported_transcript: importedTranscript.trim() || undefined,
          vela_suggestions: velaSuggestions.length > 0 ? velaSuggestions : undefined,
          call_memory: memoryStr,
          outcome: callOutcome ?? undefined,
          ...(whisperTranscript ? { whisper_transcript: whisperTranscript } : {}),
        }),
      });
      if (!res.ok) throw new Error("vela audit failed");
      const data = await res.json() as VelaAudit;
      setVelaAudit(data);
    } catch {
      setVelaAuditError(true);
    } finally {
      setVelaAuditLoading(false);
    }
  };

  const handleRefreshAnalysis = async () => {
    if (!callOutcome) return;
    // Reset all post-call outputs and close panels
    setBrutalAudit(null);
    setBrutalAuditError(false);
    setBrutalAuditOpen(false);
    setVelaAudit(null);
    setVelaAuditError(false);
    setVelaAuditOpen(false);
    // Re-run summarize with current transcript source (apply retro repairs first)
    setIsSummarizing(true);
    const speakerUncertainty = computeSpeakerUncertainty();
    const repairedLog = applyRetroRepairs();
    const convExcerpt = repairedLog.map(t => t.normalized_fragment).slice(-12);
    try {
      const res = await fetch("/api/copilot/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_memory: tacticalState.callMemory,
          outcome: callOutcome,
          lang: langRef.current,
          analyze_failure_count: analyzeErrorCountRef.current,
          conversation_excerpt: convExcerpt.length > 0 ? convExcerpt : undefined,
          imported_transcript: importedTranscript.trim() || undefined,
          ...(speakerUncertainty ? { speaker_uncertainty: speakerUncertainty } : {}),
        }),
      });
      const data = await res.json() as {
        score: number; global_state: string; result_label: string;
        strengths: string[]; improvements: string[]; debrief_reliable?: boolean;
      };
      setCallSummary({
        score: data.score,
        globalState: data.global_state,
        resultLabel: data.result_label,
        strengths: data.strengths ?? [],
        improvements: data.improvements ?? [],
        debriefReliable: data.debrief_reliable,
      });
    } catch { /* keep existing summary if re-fetch fails */ } finally {
      setIsSummarizing(false);
    }
  };

  const handleModeSwitch = (newMode: InputMode) => {
    if (newMode === "simulate") { stopListening(); setIsSessionListening(false); }
    setInputMode(newMode);
  };

  const handleMicToggle = () => {
    if (isSessionListening) { stopListening(); setIsSessionListening(false); }
    else { startListening(); setIsSessionListening(true); startRecording(); }
  };

  const handleSimulateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAnalysis(simulateText);
    setSimulateText("");
  };

  // Setup screen
  if (sessionContext === null) {
    // ── Recovery screen — shown when a recent session was interrupted ────────
    if (recoveredSession !== null) {
      const ageMin = Math.round((Date.now() - recoveredSession.savedAt) / 60000);
      const ageLabel = ageMin < 60
        ? (lang === "es" ? `hace ${ageMin} min` : `${ageMin} min ago`)
        : (lang === "es" ? `hace ${Math.round(ageMin / 60)} h` : `${Math.round(ageMin / 60)}h ago`);
      const turns = recoveredSession.conversationLog.length || recoveredSession.turnLog.length;
      const shortContext = (recoveredSession.contextLabel || recoveredSession.sessionContext || "")
        .split("\n")[0].slice(0, 60);
      return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-sm flex flex-col gap-5">
            {/* Header */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 mb-3">
                <VelaIcon className="w-3 h-3 text-zinc-400" />
                <span className="text-[9px] font-mono tracking-[0.25em] uppercase text-zinc-400">VELA</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                <p className="text-[10px] font-mono tracking-widest uppercase text-amber-400">
                  {lang === "es" ? "Sesión anterior guardada" : "Previous session found"}
                </p>
              </div>
            </div>

            {/* Session card */}
            <div className="border border-amber-900/50 bg-amber-950/20 rounded-xl px-4 py-4 flex flex-col gap-2">
              <p className="text-xs font-mono text-white leading-snug">
                {shortContext || (lang === "es" ? "Sesión sin título" : "Untitled session")}
              </p>
              <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500">
                <span>{turns} {lang === "es" ? "turnos" : "turns"}</span>
                <span>·</span>
                <span>{ageLabel}</span>
                {recoveredSession.analyzeErrorCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-amber-600">{recoveredSession.analyzeErrorCount} {lang === "es" ? "fallos de análisis" : "analysis errors"}</span>
                  </>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              {/* Primary — continue mid-call */}
              <button
                onClick={handleRecoverAndContinue}
                className="w-full flex items-center justify-center gap-2 bg-white text-black text-xs font-mono font-bold py-3.5 rounded-xl hover:bg-zinc-100 active:scale-[0.98] transition-all"
              >
                {lang === "es" ? "Continuar sesión" : "Continue session"}
              </button>
              {/* Secondary — go straight to audit/results */}
              <button
                onClick={handleRecoverAndFinish}
                className="w-full flex items-center justify-center gap-2 border border-white/15 text-white text-xs font-mono font-semibold py-3 rounded-xl hover:bg-white/5 active:scale-[0.98] transition-all"
              >
                {lang === "es" ? "La llamada ya terminó — ver resultados" : "Call is over — see results"}
              </button>
              {/* Tertiary — discard */}
              <button
                onClick={() => { clearSavedSession(); setRecoveredSession(null); }}
                className="w-full text-center text-[10px] font-mono text-zinc-500 hover:text-zinc-300 py-2 transition-colors"
              >
                {lang === "es" ? "Descartar y empezar nueva sesión" : "Discard and start new session"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        <ContextSetup
          onContextReady={handleContextReady}
          onArenaReady={handleArenaReady}
          lang={lang}
          onLangChange={(l) => { setLang(l); saveLang(l); }}
          initialMode={initMode}
          initialRole={initRole}
        />
        <DebugPanel sessionId={null} />
      </>
    );
  }

  if (arenaRole !== null) {
    // Arena already renders its own DebugPanel internally — do NOT add a second one here.
    return (
      <Arena
        key={arenaKey}
        context={sessionContext}
        contextLabel={contextLabel}
        role={arenaRole}
        lang={lang}
        arenaConfig={arenaConfig}
        onExit={handleActuallyClearSession}
        onGoArena={handleGoArena}
        onGoArenaRole={handleGoArenaRole}
        onRetry={() => setArenaKey(k => k + 1)}
      />
    );
  }

  // Derived panel data
  const hasDetail = !!(tacticalState.detail && Object.values(tacticalState.detail).some(Boolean));
  const hasJourney = !!tacticalState.journey;
  const memoryLines = tacticalState.callMemory;
  const handleToggleDetail = () => setDetailOpen(p => !p);

  // Helper: build copy text for summary
  const buildSummaryText = () => {
    if (!callSummary) return "";
    const isEs = lang === "es";
    const lines = [
      BRAND_NAME,
      "",
      `${isEs ? "Resultado" : "Result"}: ${callSummary.resultLabel}`,
      `Score: ${(callSummary.score ?? 0).toFixed(1)} / 10`,
      `${isEs ? "Estado" : "State"}: ${callSummary.globalState.toUpperCase()}`,
      "",
      `${isEs ? "Puntos fuertes" : "Strengths"}:`,
      ...callSummary.strengths.map(s => `→ ${s}`),
      "",
      `${isEs ? "Puntos a mejorar" : "Improvements"}:`,
      ...callSummary.improvements.map(s => `△ ${s}`),
    ];
    return lines.join("\n");
  };

  // Helper: build copy text for full report (prepends stats header)
  const buildFullReportText = () => {
    if (!callSummary?.fullReport) return "";
    const isEs = lang === "es";
    const header = [
      BRAND_NAME,
      "",
      `${isEs ? "Resultado" : "Result"}: ${callSummary.resultLabel}`,
      `Score: ${(callSummary.score ?? 0).toFixed(1)} / 10`,
      `${isEs ? "Estado" : "State"}: ${callSummary.globalState.toUpperCase()}`,
      "",
      "──────────────",
      "",
    ].join("\n");
    return header + callSummary.fullReport;
  };

  const handleDownloadAuditLog = async () => {
    // Fix C: heuristic retropass → AI semantic retropass before building the .md
    const heuristicLog = applyRetroRepairs();
    const finalLog = await aiSpeakerRetropass(heuristicLog);
    const finalMemory = finalLog.length > 0
      ? finalLog[finalLog.length - 1].memory_after
      : tacticalState.callMemory;
    // Use the session-accumulated ref — not a recount from finalLog — so the
    // count reflects ALL retropass calls this session, not just this download call.
    const aiReclassifiedCount = aiRetropassReclassifiedRef.current;
    const baseMetrics = speakerMode === "auto" ? speakerSessionRef.current.getMetrics() : undefined;
    const speakerSessionMetrics = baseMetrics
      ? { ...baseMetrics, ai_retropass_reclassified_count: aiReclassifiedCount }
      : undefined;
    const log = buildCopilotAuditLog({
      sessionId: sessionId || null,
      lang,
      sessionContext,
      contextLabel: contextLabel || null,
      speakerMode,
      inputModeUsed: "auto",
      callOutcome,
      callSummary: callSummary ?? null,
      turnLog: finalLog,
      finalMemory,
      structuredContext,
      speakerSessionMetrics,
    });
    triggerAuditLogDownload(log, sessionId || null);
  };

  const OUTCOME_OPTS: { key: CallOutcome; label: string }[] = [
    { key: "closed",    label: T[lang].OUTCOME_CLOSED },
    { key: "next_step", label: T[lang].OUTCOME_NEXT },
    { key: "follow_up", label: T[lang].OUTCOME_FOLLOW },
    { key: "lost",      label: T[lang].OUTCOME_LOST },
    { key: "unclear",   label: T[lang].OUTCOME_UNCLEAR },
  ];

  // Active session layout
  return (
    <div className="fixed inset-0 bg-black text-foreground flex flex-col overflow-hidden font-sans">

      {/* ── End-of-call overlay ─────────────────────────── */}
      {endStep !== "none" && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto flex flex-col items-center px-6 py-8 pb-28">

            {/* ── Outcome picker ── */}
            {endStep === "outcome" && (
              <div className="w-full max-w-sm flex flex-col gap-6 my-auto">
                <div className="flex flex-col gap-1">
                  <WizardOverlayHeader />
                  <p className="text-base font-mono font-semibold text-white tracking-tight mt-4">
                    {T[lang].OUTCOME_Q}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {OUTCOME_OPTS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => void handleSelectOutcome(opt.key)}
                      className="w-full text-left px-5 py-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-mono text-white hover:bg-zinc-800 hover:border-zinc-600 active:scale-[0.98] transition-all"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleActuallyClearSession}
                  className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors text-center"
                >
                  {T[lang].SKIP_ANALYSIS}
                </button>
              </div>
            )}

            {/* ── Summary screen ── */}
            {(endStep === "summary" || endStep === "report") && (
              <div className="w-full max-w-sm flex flex-col gap-5 my-auto">
                {isSummarizing ? (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
                    <p className="text-xs font-mono text-zinc-400 tracking-widest uppercase">{T[lang].ANALYZING_CALL}</p>
                  </div>
                ) : callSummary ? (
                  <>
                    {/* ── SUMMARY step ── */}
                    {endStep === "summary" && (
                      <>
                        {/* Brand + result header */}
                        <div className="flex flex-col gap-0.5">
                          <WizardOverlayHeader />
                          <p className="text-[10px] font-mono tracking-widest uppercase text-zinc-400 mt-3">{T[lang].CALL_RESULT}</p>
                          <p className="text-lg font-mono font-bold text-white leading-tight">{callSummary.resultLabel}</p>
                        </div>

                        {/* Score + State row */}
                        <div className="flex items-center gap-4 border-t border-white/5 pt-3">
                          <div className="flex flex-col">
                            <p className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">{T[lang].CALL_SCORE}</p>
                            <p className={cn("text-3xl font-mono font-bold leading-none mt-0.5", callSummary.speakerLowConf ? "text-amber-400" : "text-white")}>
                              {(callSummary.score ?? 0).toFixed(1)}<span className={cn("text-lg", callSummary.speakerLowConf ? "text-amber-600" : "text-zinc-500")}> / 10{callSummary.speakerLowConf ? "*" : ""}</span>
                            </p>
                            {callSummary.speakerLowConf && (
                              <p className="text-[9px] font-mono text-amber-600 mt-0.5">
                                {lang === "en" ? "* uncertain attribution — indicative" : "* atribución incierta — orientativo"}
                              </p>
                            )}
                          </div>
                          <div className="h-8 w-px bg-white/8 shrink-0" />
                          <div className="flex flex-col">
                            <p className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">{T[lang].CALL_STATE}</p>
                            <p className="text-sm font-mono font-semibold text-white uppercase tracking-widest mt-0.5">{callSummary.globalState}</p>
                          </div>
                        </div>

                        {/* ── Reliability warning — shown when analyze had failures ── */}
                        {callSummary.debriefReliable === false && (
                          <div className="flex items-start gap-3 border border-amber-900/60 bg-amber-950/30 rounded-xl px-4 py-3">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-0.5">
                              <p className="text-[10px] font-mono font-semibold text-amber-400 tracking-widest uppercase">
                                {lang === "en" ? "Debrief unreliable" : "Debrief no fiable"}
                              </p>
                              <p className="text-[10px] font-mono text-amber-600 leading-relaxed">
                                {lang === "en"
                                  ? `${analyzeErrorCount} analysis turn(s) failed during the call — VELA had insufficient data. Score and observations may be misleading.`
                                  : `${analyzeErrorCount} turno(s) de análisis fallaron durante la llamada — VELA tuvo datos insuficientes. La puntuación y observaciones pueden ser engañosas.`}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Strengths */}
                        {callSummary.strengths.length > 0 && (
                          <div className="flex flex-col gap-1.5 border-t border-white/5 pt-3">
                            <p className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">{T[lang].STRENGTHS}</p>
                            {callSummary.strengths.map((s, i) => (
                              <p key={i} className="text-xs font-mono text-zinc-300 leading-relaxed">
                                <span className="text-green-600 mr-1.5">→</span>{s}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Improvements */}
                        {callSummary.improvements.length > 0 && (
                          <div className="flex flex-col gap-1.5 border-t border-white/5 pt-3">
                            <p className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">{T[lang].IMPROVEMENTS}</p>
                            {callSummary.improvements.map((s, i) => (
                              <p key={i} className="text-xs font-mono text-zinc-300 leading-relaxed">
                                <span className="text-amber-600 mr-1.5">△</span>{s}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* ── Transcript — collapsible view of the raw conversation ── */}
                        {conversationLog.length > 0 && (
                          <div className="border border-zinc-800/60 rounded-xl overflow-hidden">
                            <button
                              onClick={() => setTranscriptOpen(o => !o)}
                              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/3 transition-colors"
                              type="button"
                            >
                              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">
                                {lang === "en" ? "Conversation transcript" : "Transcripción de la conversación"}
                                <span className="ml-2 text-zinc-700">({conversationLog.length} {lang === "en" ? "turns" : "turnos"})</span>
                              </p>
                              <span className={cn("text-zinc-600 text-xs font-mono transition-transform duration-200", transcriptOpen ? "rotate-180" : "")}>▾</span>
                            </button>
                            {transcriptOpen && (
                              <div className="border-t border-zinc-800/60 px-4 pb-4 pt-3 max-h-72 overflow-y-auto">
                                {conversationLog.map((turn, i) => {
                                  const isClient = turn.startsWith("[CLIENTE]") || turn.startsWith("[CLIENT]");
                                  const isMe = turn.startsWith("[YO]") || turn.startsWith("[ME]");
                                  const labelColor = isClient ? "text-sky-500" : isMe ? "text-teal-400" : "text-zinc-500";
                                  return (
                                    <div key={i} className="flex gap-2 py-1 border-b border-zinc-800/30 last:border-0">
                                      <span className="text-[9px] font-mono text-zinc-700 shrink-0 mt-[3px]">{i + 1}</span>
                                      <p className={cn("text-[10px] font-mono leading-relaxed", labelColor)}>{turn}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── AI attribution correction — optional, only in AUTO mode ── */}
                        {speakerMode === "auto" && (
                          <button
                            type="button"
                            disabled={retropassDone || retropassRunning}
                            onClick={async () => {
                              setRetropassRunning(true);
                              try {
                                const corrected = await aiSpeakerRetropass(turnLog, true);
                                setTurnLog(corrected);
                                setRetropassDone(true);
                              } finally {
                                setRetropassRunning(false);
                              }
                            }}
                            className={cn(
                              "w-full flex items-center justify-center gap-2 border rounded-lg py-2.5 text-[11px] font-mono font-semibold transition-all",
                              retropassDone
                                ? "border-teal-900/50 text-teal-600 bg-teal-950/20 cursor-default"
                                : retropassRunning
                                  ? "border-zinc-700 text-zinc-400 bg-zinc-900/40 cursor-wait"
                                  : "border-zinc-700 text-zinc-300 bg-zinc-900 hover:bg-zinc-800 hover:border-zinc-500 active:scale-[0.98]",
                            )}
                          >
                            {retropassRunning ? (
                              <><Loader2 className="w-3 h-3 animate-spin" />{lang === "en" ? "Correcting attribution..." : "Corrigiendo atribución..."}</>
                            ) : retropassDone ? (
                              <>{lang === "en" ? "✦ Attribution corrected" : "✦ Atribución corregida"}</>
                            ) : (
                              <>{lang === "en" ? "✦ Correct attribution with AI" : "✦ Corregir atribución con IA"}</>
                            )}
                          </button>
                        )}

                        {/* ── Human notes — optional, feeds the brutal audit ── */}
                        <div className="border border-zinc-800/60 rounded-xl overflow-hidden">
                          <div className="w-full flex items-center justify-between px-4 py-2.5">
                            <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">
                              {lang === "en" ? "Post-call notes (optional)" : "Notas post-llamada (opcional)"}
                            </p>
                            <span className="text-[9px] font-mono text-zinc-700 italic">
                              {lang === "en" ? "feeds audit" : "alimenta la auditoría"}
                            </span>
                          </div>
                          <div className="px-4 pb-3">
                            <textarea
                              value={humanNotes}
                              onChange={e => setHumanNotes(e.target.value)}
                              placeholder={lang === "en"
                                ? "What really happened — client already decided, comparing A vs B, spouse validates, real close target, anything the transcript missed..."
                                : "Qué pasó de verdad — cliente ya decidido, comparaba A vs B, esposa valida, objetivo real del cierre, cualquier matiz que la transcripción no captó..."}
                              rows={3}
                              className="w-full bg-transparent text-[11px] font-mono text-zinc-300 placeholder:text-zinc-700 resize-none outline-none border-0 leading-relaxed"
                            />
                          </div>
                        </div>

                        {/* ── Import transcript + Refresh ── */}
                        <div className="border border-zinc-800/60 rounded-xl overflow-hidden">
                          <button
                            onClick={() => setImportTranscriptOpen(o => !o)}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/3 transition-colors"
                            type="button"
                          >
                            <div className="flex items-center gap-2">
                              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">
                                {lang === "en" ? "Use better transcript" : "Usar transcript mejor"}
                              </p>
                              {importedTranscript.trim() && <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />}
                            </div>
                            <span className={cn("text-zinc-600 text-xs font-mono transition-transform duration-200", importTranscriptOpen ? "rotate-180" : "")}>▾</span>
                          </button>
                          {importTranscriptOpen && (
                            <div className="border-t border-zinc-800/60 px-4 pb-3 pt-2 flex flex-col gap-2">
                              <p className="text-[9px] font-mono text-zinc-600 leading-relaxed">
                                {lang === "en"
                                  ? "Paste a better transcript and refresh. Leave empty to use the auto-captured one."
                                  : "Pega un transcript mejor y refresca. Déjalo vacío para usar el automático."}
                              </p>
                              <textarea
                                value={importedTranscript}
                                onChange={e => setImportedTranscript(e.target.value)}
                                placeholder={lang === "en"
                                  ? "Paste full transcript here..."
                                  : "Pega la transcripción completa aquí..."}
                                rows={4}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] font-mono text-zinc-300 placeholder:text-zinc-700 resize-none outline-none leading-relaxed"
                              />
                              <button
                                onClick={() => void handleRefreshAnalysis()}
                                disabled={isSummarizing}
                                className="w-full flex items-center justify-center gap-2 bg-zinc-900 border border-zinc-700 text-white text-[11px] font-mono font-semibold py-2.5 rounded-lg hover:bg-zinc-800 hover:border-zinc-500 active:scale-[0.98] transition-all disabled:opacity-40"
                              >
                                {isSummarizing
                                  ? <><Loader2 className="w-3 h-3 animate-spin" />{lang === "en" ? "Refreshing..." : "Refrescando..."}</>
                                  : (lang === "en" ? "↻ Refresh analysis" : "↻ Refrescar análisis")}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* ── Auditoría Brutal — VENDEDOR ── */}
                        <div className="border border-zinc-800 rounded-xl overflow-hidden">
                          <button
                            onClick={() => {
                              if (!brutalAuditOpen && !brutalAudit && !brutalAuditLoading) {
                                void handleLoadBrutalAudit();
                              }
                              setBrutalAuditOpen(o => !o);
                            }}
                            onMouseDown={e => e.preventDefault()}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/3 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">
                                {lang === "en" ? "Brutal audit — Seller" : "Auditoría brutal — Vendedor"}
                              </p>
                              {brutalAuditLoading && <Loader2 className="w-3 h-3 text-zinc-500 animate-spin" />}
                            </div>
                            <span className={cn("text-zinc-600 text-xs font-mono transition-transform duration-200", brutalAuditOpen ? "rotate-180" : "")}>▾</span>
                          </button>
                          {brutalAuditOpen && (
                            <div className="border-t border-zinc-800/60 px-4 pb-4 pt-3 flex flex-col gap-3">
                              {brutalAuditLoading && (
                                <div className="flex items-center gap-2 py-1">
                                  <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
                                  <p className="text-[10px] font-mono text-zinc-500">{lang === "en" ? "Analyzing session..." : "Analizando sesión..."}</p>
                                </div>
                              )}
                              {brutalAuditError && !brutalAudit && (
                                <div className="flex items-center gap-3">
                                  <p className="text-[10px] font-mono text-zinc-500">{lang === "en" ? "Error generating audit." : "Error al generar la auditoría."}</p>
                                  <button onClick={() => { setBrutalAuditError(false); void handleLoadBrutalAudit(); }} className="text-[10px] font-mono text-zinc-400 hover:text-white underline">{lang === "en" ? "Retry" : "Reintentar"}</button>
                                </div>
                              )}
                              {brutalAudit && (
                                <>
                                  <div className="flex flex-col gap-1">
                                    <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">{lang === "en" ? "Verdict" : "Veredicto"}</p>
                                    <p className="text-xs font-mono text-zinc-200 leading-relaxed">{brutalAudit.verdict}</p>
                                  </div>
                                  <AuditList label={lang === "en" ? "What worked" : "Lo que funcionó"} items={brutalAudit.what_worked} bullet="+" color="text-teal-500" />
                                  <AuditList label={lang === "en" ? "What failed" : "Lo que falló"} items={brutalAudit.what_failed} bullet="✗" color="text-amber-500" />
                                  <AuditList label={lang === "en" ? "Failure owner" : "Responsable"} items={brutalAudit.failure_owner} bullet="→" color="text-zinc-500" />
                                  <AuditList label={lang === "en" ? "Missed closes" : "Cierres perdidos"} items={brutalAudit.missed_closes} bullet="◇" color="text-sky-500" />
                                  <AuditList label={lang === "en" ? "Rules violated" : "Reglas violadas"} items={brutalAudit.rules_violated} bullet="!" color="text-amber-400" />
                                  <AuditList label={lang === "en" ? "Priority changes" : "Cambios prioritarios"} items={brutalAudit.priority_changes} bullet="→" color="text-white" />
                                  <div className="flex flex-col gap-1 border-t border-zinc-800 pt-2">
                                    <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">{lang === "en" ? "What I would have done" : "Lo que yo habría hecho"}</p>
                                    <p className="text-[11px] font-mono text-zinc-300 leading-relaxed italic">{brutalAudit.what_i_would_have_done}</p>
                                  </div>
                                  {brutalAudit.perfect_conversation && (
                                    <div className="flex flex-col gap-1 border-t border-zinc-800 pt-2">
                                      <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">{lang === "en" ? "Perfect conversation" : "Conversación perfecta"}</p>
                                      <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">{brutalAudit.perfect_conversation}</p>
                                    </div>
                                  )}
                                  {brutalAudit.prompt_patch && (
                                    <div className="flex flex-col gap-1 border-t border-zinc-800 pt-2">
                                      <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">{lang === "en" ? "Prompt patch" : "Patch de prompt"}</p>
                                      <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">{brutalAudit.prompt_patch}</p>
                                    </div>
                                  )}
                                  {brutalAudit.prompt_for_replit && (
                                    <div className="flex flex-col gap-1 border-t border-zinc-800 pt-2">
                                      <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">{lang === "en" ? "Prompt for Replit" : "Prompt para Replit"}</p>
                                      <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">{brutalAudit.prompt_for_replit}</p>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        {/* ── Auditoría Brutal — VELA (self-audit) ── */}
                        <div className="border border-zinc-700/60 rounded-xl overflow-hidden">
                          <button
                            onClick={() => {
                              if (!velaAuditOpen && !velaAudit && !velaAuditLoading) {
                                void handleLoadVelaAudit();
                              }
                              setVelaAuditOpen(o => !o);
                            }}
                            onMouseDown={e => e.preventDefault()}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/3 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <VelaIcon className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
                              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">
                                {lang === "en" ? "Brutal audit — VELA" : "Auditoría brutal — VELA"}
                              </p>
                              {velaAuditLoading && <Loader2 className="w-3 h-3 text-zinc-500 animate-spin" />}
                            </div>
                            <span className={cn("text-zinc-600 text-xs font-mono transition-transform duration-200", velaAuditOpen ? "rotate-180" : "")}>▾</span>
                          </button>
                          {velaAuditOpen && (
                            <div className="border-t border-zinc-800/60 px-4 pb-4 pt-3 flex flex-col gap-3">
                              {velaAuditLoading && (
                                <div className="flex items-center gap-2 py-1">
                                  <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
                                  <p className="text-[10px] font-mono text-zinc-500">{lang === "en" ? "VELA self-analysis..." : "Auto-análisis VELA..."}</p>
                                </div>
                              )}
                              {velaAuditError && !velaAudit && (
                                <div className="flex items-center gap-3">
                                  <p className="text-[10px] font-mono text-zinc-500">{lang === "en" ? "Error generating VELA audit." : "Error al generar la auditoría VELA."}</p>
                                  <button onClick={() => { setVelaAuditError(false); void handleLoadVelaAudit(); }} className="text-[10px] font-mono text-zinc-400 hover:text-white underline">{lang === "en" ? "Retry" : "Reintentar"}</button>
                                </div>
                              )}
                              {velaAudit && (
                                <>
                                  <div className="flex items-center gap-2">
                                    <span className={cn(
                                      "text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded border",
                                      velaAudit.audit_confidence === "high" ? "border-teal-800 text-teal-500 bg-teal-950/30" :
                                      velaAudit.audit_confidence === "medium" ? "border-amber-800 text-amber-500 bg-amber-950/30" :
                                      "border-red-900 text-red-500 bg-red-950/30"
                                    )}>
                                      {lang === "en" ? `Confidence: ${velaAudit.audit_confidence}` : `Confianza: ${velaAudit.audit_confidence}`}
                                    </span>
                                    <span className={cn(
                                      "text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded border",
                                      velaAudit.reliability_level === "high" ? "border-teal-800 text-teal-500 bg-teal-950/30" :
                                      velaAudit.reliability_level === "medium" ? "border-amber-800 text-amber-500 bg-amber-950/30" :
                                      "border-red-900 text-red-500 bg-red-950/30"
                                    )}>
                                      {lang === "en" ? `Signal: ${velaAudit.reliability_level}` : `Señal: ${velaAudit.reliability_level}`}
                                    </span>
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">{lang === "en" ? "Verdict" : "Veredicto"}</p>
                                    <p className="text-xs font-mono text-zinc-200 leading-relaxed">{velaAudit.verdict}</p>
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">{lang === "en" ? "Reliability explanation" : "Explicación de fiabilidad"}</p>
                                    <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">{velaAudit.reliability_explanation}</p>
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">{lang === "en" ? "Say-now quality" : "Calidad de say-now"}</p>
                                    <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">{velaAudit.say_now_quality}</p>
                                  </div>
                                  {velaAudit.loops_detected && velaAudit.loop_explanation && (
                                    <div className="flex flex-col gap-1">
                                      <p className="text-[9px] font-mono tracking-widest uppercase text-amber-700">{lang === "en" ? "Loop detected" : "Loop detectado"}</p>
                                      <p className="text-[11px] font-mono text-amber-500 leading-relaxed">{velaAudit.loop_explanation}</p>
                                    </div>
                                  )}
                                  <div className="flex flex-col gap-1">
                                    <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">{lang === "en" ? "Speaker attribution" : "Atribución de hablante"}</p>
                                    <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">{velaAudit.speaker_attribution_quality}</p>
                                  </div>
                                  <AuditList label={lang === "en" ? "Technical failures" : "Fallos técnicos"} items={velaAudit.technical_failures} bullet="✗" color="text-amber-500" />
                                  <AuditList label={lang === "en" ? "System recommendations" : "Recomendaciones de sistema"} items={velaAudit.system_recommendations} bullet="→" color="text-zinc-400" />
                                </>
                              )}
                            </div>
                          )}
                        </div>

                      </>
                    )}

                    {/* ── REPORT step ── */}
                    {endStep === "report" && callSummary.fullReport && (
                      <>
                        {/* Compact stats header — score/result/state always visible */}
                        <div className="flex items-center gap-3 pb-3 border-b border-white/8">
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-400">{T[lang].CALL_RESULT}</p>
                            <p className="text-xs font-mono font-semibold text-white truncate">{callSummary.resultLabel}</p>
                          </div>
                          <div className="shrink-0 text-center">
                            <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-400">{T[lang].CALL_SCORE}</p>
                            <p className={cn("text-xl font-mono font-bold leading-none", callSummary.speakerLowConf ? "text-amber-400" : "text-white")}>
                              {(callSummary.score ?? 0).toFixed(1)}<span className={cn("text-xs", callSummary.speakerLowConf ? "text-amber-600" : "text-zinc-500")}> /10{callSummary.speakerLowConf ? "*" : ""}</span>
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-400">{T[lang].CALL_STATE}</p>
                            <p className="text-xs font-mono font-semibold text-white uppercase">{callSummary.globalState}</p>
                          </div>
                        </div>

                        {/* Full report text */}
                        <div className="flex flex-col gap-2">
                          <p className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">{T[lang].FULL_REPORT}</p>
                          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 max-h-80 overflow-y-auto">
                            <p className="text-xs font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap">{callSummary.fullReport}</p>
                          </div>
                        </div>

                        {/* Back to summary — kept in scrollable area */}
                        <button
                          onClick={() => setEndStep("summary")}
                          className="w-full text-center text-[10px] font-mono text-zinc-500 hover:text-zinc-200 py-1 transition-colors"
                        >
                          {T[lang].BACK_SUMMARY}
                        </button>
                      </>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </div>

          {/* ── Sticky action bar — always visible without scroll ── */}
          {(endStep === "summary" || endStep === "report") && callSummary && !isSummarizing && (
            <div className="shrink-0 border-t border-white/8 bg-black px-5 pt-3 pb-4">
              <div className="w-full max-w-sm mx-auto flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopyText(endStep === "report" ? buildFullReportText() : buildSummaryText())}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-white text-black text-[11px] font-mono font-bold py-2.5 rounded-xl hover:bg-zinc-100 active:scale-[0.98] transition-all"
                  >
                    {copied ? T[lang].COPIED : (endStep === "report" ? T[lang].COPY_REPORT : T[lang].COPY_SUMMARY)}
                  </button>
                  <button
                    onClick={handleActuallyClearSession}
                    className="flex-1 flex items-center justify-center bg-zinc-900 border border-zinc-700 text-white text-[11px] font-mono font-semibold py-2.5 rounded-xl hover:bg-zinc-800 hover:border-zinc-500 active:scale-[0.98] transition-all"
                  >
                    {T[lang].CLOSE_SESSION}
                  </button>
                </div>
                <button
                  onClick={handleDownloadAuditLog}
                  className="w-full text-center text-[10px] font-mono text-zinc-600 hover:text-zinc-300 py-0.5 transition-colors"
                >
                  {T[lang].DOWNLOAD_AUDIT}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Compact session bar */}
      <SessionBar sessionContext={sessionContext} contextLabel={contextLabel} onClearSession={handleClearSession} lang={lang} momentum={tacticalState.momentum} endLabel={!hasRealConversation ? T[lang].EXIT : undefined} />

      {/* Status pill — top right */}
      <div className="absolute top-10 right-5 flex items-center gap-3 z-10">
        {isPending && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[10px] font-mono tracking-widest uppercase">{T[lang].ANALYZING}</span>
          </div>
        )}
        {inputMode === "listen" && !speechError && (
          <div
            onClick={handleMicToggle}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-full transition-colors cursor-pointer",
              isSessionListening ? "bg-sky-500/10 text-sky-400" : "text-muted-foreground"
            )}
          >
            <div className={cn("w-2 h-2 rounded-full", isSessionListening ? "bg-sky-400 animate-pulse" : "bg-zinc-600")} />
            <span className="text-[10px] font-mono tracking-widest uppercase">
              {isSessionListening ? T[lang].LISTENING : T[lang].PAUSED}
            </span>
          </div>
        )}
      </div>


      {/* ── Main HUD — flexible, shrinks to give panel room ── */}
      <div className="flex-1 min-h-[220px] relative flex flex-col">

        {/* Journey timeline — compact 3-node, only when data exists */}
        {hasJourney && (
          <ConversationTimeline
            journey={tacticalState.journey!}
            memoryLines={memoryLines}
          />
        )}

        {/* Tactical display takes remaining space */}
        <div className="flex-1 relative">
        <TacticalDisplay
          sayNow={tacticalState.sayNow}
          reading={tacticalState.detail?.reading}
          avoid={tacticalState.avoid}
          detailOpen={detailOpen}
          onCloseDetail={handleToggleDetail}
          isPending={isPending}
          isListening={isSessionListening}
          lang={lang}
        />

        {/* Mic error overlay */}
        {inputMode === "listen" && speechError && (
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
                {T[lang].OPEN_TAB}
              </button>
              <p className="text-[10px] text-zinc-200 font-mono text-center">
                {T[lang].OR_SIMULATE}
              </p>
            </div>
          </div>
        )}

        {/* Browser not supported */}
        {inputMode === "listen" && !isSupported && !speechError && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-5 max-w-sm w-full">
              <p className="text-xs font-mono text-zinc-200 text-center leading-relaxed">
                {T[lang].NO_SPEECH.split("\n").map((l, i) => <span key={i}>{l}{i === 0 && <br />}</span>)}
              </p>
            </div>
          </div>
        )}
        </div>{/* end flex-1 relative (tactical display) */}

      {/* Interim transcript — own row, well below main text */}
      <div className="shrink-0 h-8 flex items-center justify-center px-6 pointer-events-none">
        {inputMode === "listen" && isSessionListening && interimText && (
          <p className="text-[11px] text-zinc-400 font-mono truncate max-w-xl w-full text-center">
            {interimText}
          </p>
        )}
      </div>

      </div>{/* end HUD flex-col */}

      {/* ── Detail panel — CSS transitions only, no layout bounce ── */}
      {hasDetail && (
        <div className="shrink-0">

          {/* Badge — cross-fades out as panel opens */}
          <div
            className="overflow-hidden border-t border-white/5"
            style={{
              maxHeight: detailOpen ? "0px" : "48px",
              opacity: detailOpen ? 0 : 1,
              transition: "max-height 0.22s ease, opacity 0.14s ease",
              pointerEvents: detailOpen ? "none" : "auto",
            }}
          >
            <div className="flex items-center justify-center py-2">
              <button
                onClick={handleToggleDetail}
                className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/8 text-zinc-500 hover:text-zinc-200 hover:bg-white/8 hover:border-white/15 text-[10px] font-mono tracking-widest uppercase transition-colors"
              >
                <Info className="w-3 h-3" />
                {T[lang].DETAIL}
              </button>
            </div>
          </div>

          {/* Full content — slides down when open, click anywhere to close */}
          <div
            onClick={handleToggleDetail}
            className="overflow-hidden border-t border-white/5 cursor-pointer select-none"
            style={{
              maxHeight: detailOpen ? "500px" : "0px",
              transition: "max-height 0.22s ease",
            }}
          >
            <div className="flex items-center justify-center py-1.5 text-zinc-500">
              <ChevronDown className="w-3.5 h-3.5" />
            </div>
            <div className="overflow-y-auto border-t border-white/5" style={{ maxHeight: "460px" }}>
              <DetailPanel detail={tacticalState.detail!} avoid={tacticalState.avoid} lang={lang} />
            </div>
          </div>

        </div>
      )}

      {/* ── Controls — bottom bar ─────────────────── */}
      <div className="shrink-0 border-t border-white/5 bg-black px-6 py-4 flex flex-col items-center gap-3">

        {/* Simulate textarea */}
        {inputMode === "simulate" && (
          <form onSubmit={handleSimulateSubmit} className="w-full max-w-2xl flex items-stretch gap-2">
            <textarea
              value={simulateText}
              onChange={(e) => setSimulateText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAnalysis(simulateText);
                  setSimulateText("");
                }
              }}
              placeholder={T[lang].PASTE_PLACEHOLDER}
              rows={2}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors font-mono resize-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={!simulateText.trim() || isPending}
              className="bg-white text-black px-5 rounded-xl font-mono text-xs font-semibold tracking-widest uppercase hover:bg-zinc-200 active:scale-95 disabled:opacity-40 transition-all flex items-center justify-center gap-2 min-w-[90px]"
            >
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : T[lang].ANALYZE}
            </button>
          </form>
        )}

        {/* Listen mic button */}
        {inputMode === "listen" && isSupported && !speechError && (
          <button
            onClick={handleMicToggle}
            className={cn(
              "px-6 py-2.5 rounded-full font-mono text-xs font-semibold tracking-widest uppercase transition-all flex items-center gap-2",
              isSessionListening
                ? "bg-sky-500/15 text-sky-400 border border-sky-500/25 hover:bg-sky-500/25"
                : "bg-white/8 text-white border border-white/15 hover:bg-white/15"
            )}
          >
            {isSessionListening
              ? <><div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />{T[lang].PAUSE}</>
              : <><Mic className="w-3.5 h-3.5" />{T[lang].START_LISTENING}</>}
          </button>
        )}

        {/* Bottom row: mode toggle + speaker mode + lang */}
        <div className="flex items-center justify-center gap-3 w-full">

          {/* Language toggle */}
          <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/8 text-[9px] font-mono overflow-hidden">
            {(["es", "en"] as Lang[]).map(l => (
              <button
                key={l}
                onClick={() => { setLang(l); saveLang(l); }}
                className={cn(
                  "px-3 py-1.5 rounded-full uppercase tracking-widest transition-all font-medium",
                  lang === l ? "bg-white text-black shadow" : "text-zinc-400 hover:text-white"
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Input mode toggle */}
          <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/8">
            <button
              onClick={() => handleModeSwitch("listen")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono font-medium transition-all",
                inputMode === "listen" ? "bg-white text-black shadow" : "text-zinc-300 hover:text-white"
              )}
            >
              {isSessionListening ? <Mic className="w-3 h-3 text-sky-400" /> : <Mic className="w-3 h-3" />}
              {T[lang].MODE_LISTEN}
            </button>
            <button
              onClick={() => handleModeSwitch("simulate")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono font-medium transition-all",
                inputMode === "simulate" ? "bg-white text-black shadow" : "text-zinc-300 hover:text-white"
              )}
            >
              <Keyboard className="w-3 h-3" />
              {T[lang].MODE_WRITE}
            </button>
          </div>

          {/* Transcript toggle — always visible once session is active */}
          <button
            onClick={() => setLiveTranscriptOpen(o => !o)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-mono font-medium tracking-widest uppercase transition-all border",
              liveTranscriptOpen
                ? "bg-zinc-800 text-white border-zinc-600"
                : "bg-white/5 text-zinc-400 border-white/8 hover:text-zinc-200 hover:bg-white/8",
            )}
            type="button"
          >
            <List className="w-3 h-3" />
            {lang === "es" ? "Conv" : "Conv"}
            {turnLog.some(t => t.auto_repaired) && (
              <span className="text-amber-500 text-[8px] leading-none">↺</span>
            )}
          </button>

          {/* End call — visible once real conversation starts */}
          {hasRealConversation && (
            <button
              onClick={handleClearSession}
              className="px-3 py-1.5 rounded-full text-[10px] font-mono font-semibold tracking-widest uppercase text-orange-400 border border-orange-500/30 bg-orange-950/20 hover:bg-orange-950/40 hover:border-orange-500/50 transition-all active:scale-95"
            >
              {lang === "es" ? "Fin" : "End"}
            </button>
          )}

          {/* Speaker mode toggle */}
          <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/8">
            {SPEAKER_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSpeakerMode(s);
                  if (s !== "auto") {
                    setInferredAutoLabel("");
                    aiRetropassReclassifiedRef.current = 0;
                    speakerSessionRef.current.reset();
                    setSpeakerQualityLevel("normal");
                  }
                }}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[10px] font-mono tracking-widest transition-all",
                  speakerMode === s ? "bg-white/15 text-white" : "text-zinc-200 hover:text-zinc-100"
                )}
              >
                {s === "auto" && speakerMode === "auto" ? (
                  <span className="flex flex-col items-center leading-none gap-[2px]">
                    <span className="flex items-center gap-0.5 tracking-widest">
                      AUTO
                      {speakerQualityLevel === "watch" && <span className="text-amber-400 text-[8px] leading-none">△</span>}
                      {speakerQualityLevel === "low" && <span className="text-red-400 text-[8px] leading-none">▲</span>}
                    </span>
                    {inferredAutoLabel && (
                      <span className="text-[7px] tracking-normal normal-case text-zinc-400 font-normal">{inferredAutoLabel}</span>
                    )}
                  </span>
                ) : SPEAKER_LABELS_MAP[lang][s]}
              </button>
            ))}
          </div>

        </div>

        {/* Keyboard hint */}
        <p className="text-[9px] font-mono text-zinc-400 tracking-widest">
          {speakerMode === "auto" && inferredAutoLabel
            ? T[lang].autoHint(inferredAutoLabel)
            : T[lang].KBD}
        </p>

        {/* Speaker quality level warning — auto mode */}
        {speakerMode === "auto" && speakerQualityLevel === "low" && (
          <p className="text-[9px] font-mono text-red-400 tracking-widest">
            {lang === "es"
              ? "▲ AUTO: baja fiabilidad — considera YO/CLIENTE"
              : "▲ AUTO: low reliability — switch to ME/CLIENT"}
          </p>
        )}
        {speakerMode === "auto" && speakerQualityLevel === "watch" && (
          <p className="text-[9px] font-mono text-amber-400 tracking-widest">
            {lang === "es"
              ? "△ AUTO: fiabilidad moderada — lecturas pueden variar"
              : "△ AUTO: moderate reliability — reads may vary"}
          </p>
        )}
      </div>

      {/* ── Live Transcript Drawer — slide in from right during active session ── */}
      <LiveTranscriptDrawer
        isOpen={liveTranscriptOpen}
        onClose={() => setLiveTranscriptOpen(false)}
        turnLog={turnLog}
        lang={lang}
      />

      <DebugPanel sessionId={sessionId || null} />
    </div>
  );
}
