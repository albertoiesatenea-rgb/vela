import { useState, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, Keyboard, Loader2, AlertCircle, ExternalLink, ChevronDown, Info } from "lucide-react";
import { useAnalyzeConversation } from "@workspace/api-client-react";
import { useSpeech } from "@/hooks/use-speech";
import { TacticalDisplay } from "@/components/tactical-display";
import { ContextSetup, SessionBar } from "@/components/context-panel";
import { cn } from "@/lib/utils";

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
    OR_TYPE: "O usa el modo Escribir para probar la IA ahora",
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
    OR_TYPE: "Or use Type mode to test the AI now",
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

interface TacticalState {
  sayNow: string;
  avoid?: string;
  detail: Detail | null;
  journey: Journey | null;
  callMemory: string[];
}

const EMPTY_STATE: TacticalState = { sayNow: "", avoid: undefined, detail: null, journey: null, callMemory: [] };

const SESSION_KEY = "sc_session_context";
const LABEL_KEY   = "sc_context_label";

function loadSession(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}
function saveSession(ctx: string | null) {
  try {
    if (ctx === null) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, ctx);
  } catch { /* ignore */ }
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
        <p className="font-mono w-full text-center text-[21px] font-semibold uppercase tracking-wide text-red-500">
          <span className="text-[9px] tracking-[0.2em] uppercase align-middle mr-2 font-normal text-red-700">
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

// ── Auto speaker inference ─────────────────────────────────────────────────
// Returns the most likely speaker using language heuristics + turn alternation.
// Prefers prudence: only makes a call when there is a clear signal (score diff ≥ 3).
function inferSpeaker(
  text: string,
  lastSpeaker: "client" | "me" | null,
  lang: Lang,
): { speaker: "client" | "me" | "uncertain"; label: string } {
  const t = text.toLowerCase();
  let cs = 0; // client score
  let vs = 0; // vendor score

  if (lang === "en") {
    // ── English signals ───────────────────────────────────────
    const clientHigh = [
      "i don't see it", "i'm not convinced", "i'm worried", "i don't know",
      "that seems expensive", "i don't want to make a mistake", "i trust", "explain it to me",
      "why should i", "i'm not sure", "i have doubts", "i'm afraid",
      "i don't trust", "seems risky", "i'd rather", "what guarantees",
      "what if it goes wrong", "i don't understand", "that's too much",
    ];
    const clientMid = [
      "but", "although", "however", "what if", "yes but",
      "still", "i mean", "i don't know",
    ];
    const vendorHigh = [
      "i understand your", "i understand that", "if you'd like", "the idea here",
      "what we're looking for", "let me explain", "what matters is",
      "actually", "precisely", "what you have here", "this means",
      "let's break it down", "let me ask you", "imagine if",
      "what i'm proposing", "the key here", "think of it this way",
    ];
    const vendorMid = [
      "exactly", "of course", "that is", "in that case", "makes sense",
    ];
    for (const s of clientHigh) if (t.includes(s)) cs += 3;
    for (const s of clientMid)  if (t.includes(s)) cs += 1;
    for (const s of vendorHigh) if (t.includes(s)) vs += 3;
    for (const s of vendorMid)  if (t.includes(s)) vs += 1;
  } else {
    // ── Spanish signals ───────────────────────────────────────
    const clientHigh = [
      "no lo veo", "no me convence", "me preocupa", "no conozco", "me parece caro",
      "no quiero equivocarme", "me da más", "explícame", "por qué debería",
      "no sé si", "tengo dudas", "no estoy seguro", "me da miedo",
      "no me fío", "no confío", "parece arriesgado", "prefiero",
      "me gusta más", "qué garantías", "y si sale mal", "no lo entiendo",
      "eso es demasiado", "es que no", "no lo veo claro",
    ];
    const clientMid = [
      "pero", "aunque", "sin embargo", "¿y si", "claro pero",
      "sí pero", "es que", "a ver", "no sé",
    ];
    const vendorHigh = [
      "entiendo tu", "entiendo que", "si te parece", "la idea aquí",
      "lo que buscamos", "te explico", "lo importante es",
      "de hecho", "precisamente", "lo que tienes", "esto significa",
      "bajemos", "concretemos", "dime una cosa", "pregunto",
      "imagina que", "te propongo", "lo que te ofrezco",
      "la clave aquí", "piénsalo así",
    ];
    const vendorMid = [
      "exacto", "claro", "por supuesto", "es decir",
      "en ese caso", "tiene sentido",
    ];
    for (const s of clientHigh) if (t.includes(s)) cs += 3;
    for (const s of clientMid)  if (t.includes(s)) cs += 1;
    for (const s of vendorHigh) if (t.includes(s)) vs += 3;
    for (const s of vendorMid)  if (t.includes(s)) vs += 1;
  }

  // Turn alternation as a mild (not decisive) tiebreaker
  if (lastSpeaker === "me")     cs += 1;
  if (lastSpeaker === "client") vs += 1;

  const diff = Math.abs(cs - vs);
  if (diff < 3) return { speaker: "uncertain", label: "" };

  if (cs > vs) return {
    speaker: "client",
    label: lang === "en" ? "client" : "cliente",
  };
  return {
    speaker: "me",
    label: lang === "en" ? "me" : "yo",
  };
}

export default function CopilotPage() {
  const [inputMode, setInputMode] = useState<InputMode>("simulate");
  const [speakerMode, setSpeakerMode] = useState<SpeakerMode>("auto");
  const [simulateText, setSimulateText] = useState("");
  const [sessionContext, setSessionContext] = useState<string | null>(loadSession);
  const [tacticalState, setTacticalState] = useState<TacticalState>(EMPTY_STATE);
  const [contextLabel, setContextLabel] = useState<string>(loadLabel);

  // Panel state
  const [detailOpen, setDetailOpen] = useState(false);

  // Stable listening-session flag — true from "Iniciar escucha" to "Pausar".
  // Unlike isListening from the hook (which flickers during segment restarts),
  // this only changes when the user explicitly toggles the mic.
  const [isSessionListening, setIsSessionListening] = useState(false);

  // AUTO inference state
  const [inferredAutoLabel, setInferredAutoLabel] = useState<string>("");
  const lastAutoSpeakerRef = useRef<"client" | "me" | null>(null);

  // Language
  const [lang, setLang] = useState<Lang>(loadLang);
  const langRef = useRef(lang);
  langRef.current = lang;

  const sessionActive = sessionContext !== null;
  const speakerModeRef = useRef(speakerMode);
  speakerModeRef.current = speakerMode;

  const { mutate: analyze, isPending } = useAnalyzeConversation();

  const callMemoryRef = useRef(tacticalState.callMemory);
  callMemoryRef.current = tacticalState.callMemory;

  const handleAnalysis = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const speaker = speakerModeRef.current;

      let speakerPrefix = "";
      if (speaker === "client") {
        speakerPrefix = "[CLIENTE]: ";
      } else if (speaker === "me") {
        speakerPrefix = "[YO]: ";
      } else {
        // AUTO mode — infer from text + turn memory
        const { speaker: inferred, label } = inferSpeaker(text, lastAutoSpeakerRef.current, langRef.current);
        if (inferred === "client") {
          speakerPrefix = "[CLIENTE]: ";
          lastAutoSpeakerRef.current = "client";
          setInferredAutoLabel(label);
        } else if (inferred === "me") {
          speakerPrefix = "[YO]: ";
          lastAutoSpeakerRef.current = "me";
          setInferredAutoLabel(label);
        } else {
          // Uncertain — send without prefix, reset label
          setInferredAutoLabel("");
        }
      }

      const fullText = speakerPrefix + text;

      // Serialize call_memory array to bulleted string for the API
      const memLines = callMemoryRef.current;
      const memoryStr = memLines.length > 0
        ? memLines.map(l => `- ${l}`).join("\n")
        : undefined;

      analyze(
        {
          data: {
            text: fullText,
            ...(sessionContext ? { context: sessionContext } : {}),
            ...(memoryStr ? { call_memory: memoryStr } : {}),
            lang: langRef.current,
          },
        },
        {
          onSuccess: (res) => {
            setTacticalState({
              sayNow: res.say_now,
              avoid: res.avoid || undefined,
              detail: res.detail ?? null,
              journey: res.journey ?? null,
              callMemory: res.call_memory?.summary_lines ?? [],
            });
          },
        }
      );
    },
    [analyze, sessionContext]
  );

  const { isSupported, isListening, error: speechError, interimText, startListening, stopListening } =
    useSpeech({ onAnalyzeReady: handleAnalysis, analysisIntervalMs: 8000, lang });

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

  const handleContextReady = (context: string) => {
    setSessionContext(context);
    saveSession(context);
    setTacticalState(EMPTY_STATE);
    setContextLabel("");
    saveLabel("");
    setDetailOpen(false);
    // Generate short context label in background
    void fetch("/api/copilot/context-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    })
      .then(r => r.json())
      .then(({ label }: { label: string }) => {
        if (label) { setContextLabel(label); saveLabel(label); }
      })
      .catch(() => {});
  };

  const handleClearSession = () => {
    setSessionContext(null);
    saveSession(null);
    setTacticalState(EMPTY_STATE);
    setContextLabel("");
    saveLabel("");
    setDetailOpen(false);
    stopListening();
    setIsSessionListening(false);
    setInputMode("simulate");
    setSpeakerMode("auto");
  };

  const handleModeSwitch = (newMode: InputMode) => {
    if (newMode === "simulate") { stopListening(); setIsSessionListening(false); }
    setInputMode(newMode);
  };

  const handleMicToggle = () => {
    if (isSessionListening) { stopListening(); setIsSessionListening(false); }
    else { startListening(); setIsSessionListening(true); }
  };

  const handleSimulateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAnalysis(simulateText);
    setSimulateText("");
  };

  // Setup screen
  if (sessionContext === null) {
    return <ContextSetup onContextReady={handleContextReady} />;
  }

  // Derived panel data
  const hasDetail = !!(tacticalState.detail && Object.values(tacticalState.detail).some(Boolean));
  const hasJourney = !!tacticalState.journey;
  const memoryLines = tacticalState.callMemory;
  const handleToggleDetail = () => setDetailOpen(p => !p);

  // Active session layout
  return (
    <div className="fixed inset-0 bg-black text-foreground flex flex-col overflow-hidden font-sans">

      {/* Compact session bar */}
      <SessionBar sessionContext={sessionContext} contextLabel={contextLabel} onClearSession={handleClearSession} />

      {/* Status pill — top right */}
      <div className="absolute top-10 right-5 flex items-center gap-3 z-10">
        {/* Language toggle */}
        <div className="flex items-center bg-white/5 rounded-full border border-white/8 text-[9px] font-mono overflow-hidden">
          {(["es", "en"] as Lang[]).map(l => (
            <button
              key={l}
              onClick={() => { setLang(l); saveLang(l); }}
              className={cn(
                "px-2.5 py-1 uppercase tracking-widest transition-all",
                lang === l ? "bg-white/15 text-white" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {l}
            </button>
          ))}
        </div>

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
              isSessionListening ? "bg-red-500/10 text-red-400" : "text-muted-foreground"
            )}
          >
            <div className={cn("w-2 h-2 rounded-full", isSessionListening ? "bg-red-500 animate-pulse" : "bg-zinc-600")} />
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
        />

        {/* Interim speech text */}
        {inputMode === "listen" && isSessionListening && interimText && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-xl w-full px-6 text-center pointer-events-none">
            <p className="text-[11px] text-zinc-200 font-mono truncate">{interimText}</p>
          </div>
        )}

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
            <div className="flex items-center justify-center py-1.5 text-zinc-700">
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
                  handleSimulateSubmit(e as any);
                }
              }}
              placeholder={T[lang].PASTE_PLACEHOLDER}
              rows={2}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono resize-none"
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
                ? "bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25"
                : "bg-white/8 text-white border border-white/15 hover:bg-white/15"
            )}
          >
            {isSessionListening
              ? <><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />{T[lang].PAUSE}</>
              : <><Mic className="w-3.5 h-3.5" />{T[lang].START_LISTENING}</>}
          </button>
        )}

        {/* Bottom row: mode toggle + speaker mode */}
        <div className="flex items-center justify-center gap-3 w-full">

          {/* Input mode toggle */}
          <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/8">
            <button
              onClick={() => handleModeSwitch("listen")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono font-medium transition-all",
                inputMode === "listen" ? "bg-white text-black shadow" : "text-zinc-300 hover:text-white"
              )}
            >
              {isSessionListening ? <Mic className="w-3 h-3 text-red-500" /> : <Mic className="w-3 h-3" />}
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

          {/* Speaker mode toggle */}
          <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/8">
            {SPEAKER_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSpeakerMode(s);
                  if (s !== "auto") {
                    setInferredAutoLabel("");
                    lastAutoSpeakerRef.current = null;
                  }
                }}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[10px] font-mono tracking-widest transition-all",
                  speakerMode === s ? "bg-white/15 text-white" : "text-zinc-200 hover:text-zinc-100"
                )}
              >
                {s === "auto" && speakerMode === "auto" && inferredAutoLabel ? (
                  <span className="flex flex-col items-center leading-none gap-[2px]">
                    <span className="tracking-widest">AUTO</span>
                    <span className="text-[7px] tracking-normal normal-case text-zinc-400 font-normal">{inferredAutoLabel}</span>
                  </span>
                ) : SPEAKER_LABELS_MAP[lang][s]}
              </button>
            ))}
          </div>

        </div>

        {/* Keyboard hint */}
        <p className="text-[9px] font-mono text-zinc-500 tracking-widest">
          {speakerMode === "auto" && inferredAutoLabel
            ? T[lang].autoHint(inferredAutoLabel)
            : T[lang].KBD}
        </p>
      </div>
    </div>
  );
}
