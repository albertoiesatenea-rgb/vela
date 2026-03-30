import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Sun, Moon, Sparkles, Trophy, TrendingUp, StickyNote, GraduationCap, Download } from "lucide-react";
import { WizardIcon } from "@/components/context-panel";
import { cn } from "@/lib/utils";
import { buildArenaAuditLog, triggerAuditLogDownload } from "@/lib/audit-log";
import { useTheme } from "@/hooks/use-theme";

// ── Types ─────────────────────────────────────────────────────────────────────
export type ArenaRole = "seller" | "client";
type Lang = "es" | "en";
type ConversationState = "favorable" | "tense" | "critical";
export type ArenaOutcome = "closed" | "next_step" | "lost" | "broken" | "manual_stop" | "none";
type FinalOutcome = Exclude<ArenaOutcome, "none">;

interface ArenaMessage {
  index: number;
  speaker: "user" | "ai" | "note";
  message: string;
}

interface ArenaDebrief {
  score: number;
  critique: string[];
}

type JourneyStatus = "done" | "current" | "upcoming";
type StageId = "context" | "problem" | "blocker" | "fit" | "advance" | "close";

interface JourneyData {
  stages: Record<StageId, JourneyStatus>;
  now_help: string;
  next_help: string;
  premature_close_risk: "low" | "medium" | "high";
}

interface CoachLite {
  explanation: string;
  journey?: JourneyData;
}

interface ArenaSummary {
  role: ArenaRole;
  context: string;
  lang: Lang;
  totalTurns: number;
  userTurns: number;
  createdAt: string;
  closedAt: string;
  outcome: FinalOutcome;
  debrief?: ArenaDebrief | null;
}

// ── Conversation state heuristic ──────────────────────────────────────────────
const CRITICAL_KEYWORDS = {
  es: [
    "no me interesa", "no puedo", "absolutamente no", "imposible", "demasiado caro",
    "no estoy dispuesto", "ya tengo proveedor", "no es para mí", "no voy a",
    "no tiene sentido", "no lo necesito", "no gracias", "no me convence",
    "ya tenemos solución", "descartado",
  ],
  en: [
    "not interested", "absolutely not", "impossible", "way too expensive",
    "already have", "not for me", "won't do", "doesn't make sense",
    "don't need it", "no thanks", "not convinced", "we already have a solution",
    "ruled out", "can't do this",
  ],
};

const FAVORABLE_KEYWORDS = {
  es: [
    "interesante", "me gusta", "podría funcionar", "cuéntame más", "¿cuándo",
    "de acuerdo", "vamos adelante", "suena bien", "me parece bien", "perfecto",
    "podría ser", "hay posibilidad", "vale, explícame", "seguimos hablando",
    "me llama la atención", "podemos avanzar",
  ],
  en: [
    "interesting", "i like", "could work", "tell me more", "when can",
    "agreed", "let's go", "sounds good", "that works", "perfect",
    "that could be", "there's a possibility", "okay, explain", "keep talking",
    "catches my attention", "we can move forward",
  ],
};

function inferState(text: string, lang: Lang): ConversationState {
  const lower = text.toLowerCase();
  if (CRITICAL_KEYWORDS[lang].some(kw => lower.includes(kw))) return "critical";
  if (FAVORABLE_KEYWORDS[lang].some(kw => lower.includes(kw))) return "favorable";
  return "tense";
}

// ── CoachLite loading messages ────────────────────────────────────────────────
const COACH_LOADING: Record<Lang, string[]> = {
  es: [
    "detectando señal principal...",
    "evaluando si la objeción es real...",
    "eligiendo el mejor movimiento...",
    "preparando respuesta táctica...",
  ],
  en: [
    "detecting main signal...",
    "evaluating whether objection is real...",
    "choosing the best move...",
    "preparing tactical response...",
  ],
};

// ── Translations ──────────────────────────────────────────────────────────────
const T = {
  es: {
    ARENA: "ARENA",
    YOU: "TÚ",
    AI_AS_CLIENT: "CLIENTE",
    AI_AS_SELLER: "VENDEDOR",
    ROLE_TAG_SELLER: "Eres el vendedor",
    ROLE_TAG_CLIENT: "Eres el cliente",
    PLACEHOLDER: "Escribe tu mensaje...",
    SEND: "Enviar",
    END: "Terminar sesión",
    STARTING: "Iniciando arena...",
    SENDING: "Respondiendo...",
    SUMMARY_TITLE: "SESIÓN TERMINADA",
    TURNS: "Turnos del usuario",
    TOTAL: "Turnos totales",
    ROLE_USED: "Tu rol",
    ROLE_SELLER: "Vendedor",
    ROLE_CLIENT: "Cliente",
    EXPORT: "Descargar audit log (.md) ↓",
    CLOSE: "Cerrar y volver",
    EXIT: "← Salir",
    STATE_FAVORABLE: "Favorable",
    STATE_TENSE: "Tensa",
    STATE_CRITICAL: "Crítica",
    // Outcomes
    OUTCOME_CLOSED: "Sesión ganada",
    OUTCOME_NEXT_STEP: "Avance conseguido",
    OUTCOME_LOST: "Sesión perdida",
    OUTCOME_BROKEN: "Conversación rota",
    OUTCOME_MANUAL_STOP: "Parada manual",
    // Modal
    MODAL_DETECT: "Arena detecta",
    MODAL_CONFIRM: "Confirmar y cerrar",
    MODAL_CONTINUE: "Seguir conversando",
    MODAL_CORRECT: "Corregir resultado",
    MODAL_CORRECT_PROMPT: "¿Cuál fue el resultado real?",
    // Client mode outcome buttons
    CLIENT_SOLD: "Trato hecho ✓",
    CLIENT_ACCEPT: "Ok, sigue",
    CLIENT_OBJECTION: "No estoy de acuerdo",
    CLIENT_ACCEPT_MSG: "Ok, cuéntame más.",
    CLIENT_OBJECTION_MSG: "No, eso no me convence.",
    CLIENT_END_CHAT: "Terminar chat",
    CLIENT_EXIT_TITLE: "Resultado",
    CLIENT_EXIT_CONVINCED: "Me has convencido",
    CLIENT_EXIT_LOST: "Me has perdido",
    CLIENT_EXIT_QUIT: "Solo quería acabar",
    CLIENT_EXIT_REASON_TITLE: "¿Por qué te han perdido?",
    CLIENT_EXIT_REASON_PH: "Escribe el motivo (opcional)",
    CLIENT_EXIT_CONFIRM: "Confirmar",
    CLIENT_EXIT_BACK: "← Volver",
    CLIENT_EXIT_NOTE_LABEL: "MOTIVO DE SALIDA",
    // Summary
    OUTCOME_LABEL: "RESULTADO",
    // Debrief
    DEBRIEF_SCORE: "PUNTUACIÓN",
    DEBRIEF_CRITIQUE: "QUÉ MEJORAR",
    DEBRIEF_RETRY: "Intentar de nuevo",
    CLIENT_RETRY: "Repetir",
    DEBRIEF_LOADING: "Analizando sesión...",
    // Manual end modal
    MANUAL_END_TITLE: "¿Cómo fue la sesión?",
    MANUAL_END_CONFIRM: "Cerrar sesión",
    TRANSCRIPT_LABEL: "CONVERSACIÓN",
  },
  en: {
    ARENA: "ARENA",
    YOU: "YOU",
    AI_AS_CLIENT: "CLIENT",
    AI_AS_SELLER: "SELLER",
    ROLE_TAG_SELLER: "You are the seller",
    ROLE_TAG_CLIENT: "You are the client",
    PLACEHOLDER: "Type your message...",
    SEND: "Send",
    END: "End session",
    STARTING: "Starting arena...",
    SENDING: "Responding...",
    SUMMARY_TITLE: "SESSION ENDED",
    TURNS: "Your turns",
    TOTAL: "Total turns",
    ROLE_USED: "Your role",
    ROLE_SELLER: "Seller",
    ROLE_CLIENT: "Client",
    EXPORT: "Download audit log (.md) ↓",
    CLOSE: "Close and exit",
    EXIT: "← Exit",
    STATE_FAVORABLE: "Favorable",
    STATE_TENSE: "Tense",
    STATE_CRITICAL: "Critical",
    // Outcomes
    OUTCOME_CLOSED: "Session won",
    OUTCOME_NEXT_STEP: "Next step achieved",
    OUTCOME_LOST: "Session lost",
    OUTCOME_BROKEN: "Conversation broken",
    OUTCOME_MANUAL_STOP: "Manual stop",
    // Modal
    MODAL_DETECT: "Arena detects",
    MODAL_CONFIRM: "Confirm and close",
    MODAL_CONTINUE: "Keep talking",
    MODAL_CORRECT: "Correct outcome",
    MODAL_CORRECT_PROMPT: "What was the actual outcome?",
    // Client mode outcome buttons
    CLIENT_SOLD: "Deal ✓",
    CLIENT_ACCEPT: "OK, keep going",
    CLIENT_OBJECTION: "I disagree",
    CLIENT_ACCEPT_MSG: "OK, tell me more.",
    CLIENT_OBJECTION_MSG: "No, I'm not convinced by that.",
    CLIENT_END_CHAT: "End chat",
    CLIENT_EXIT_TITLE: "Outcome",
    CLIENT_EXIT_CONVINCED: "You convinced me",
    CLIENT_EXIT_LOST: "You lost me",
    CLIENT_EXIT_QUIT: "I just wanted to stop",
    CLIENT_EXIT_REASON_TITLE: "Why did you lose interest?",
    CLIENT_EXIT_REASON_PH: "Write the reason (optional)",
    CLIENT_EXIT_CONFIRM: "Confirm",
    CLIENT_EXIT_BACK: "← Back",
    CLIENT_EXIT_NOTE_LABEL: "EXIT REASON",
    // Summary
    OUTCOME_LABEL: "OUTCOME",
    // Debrief
    DEBRIEF_SCORE: "SCORE",
    DEBRIEF_CRITIQUE: "POINTS TO IMPROVE",
    DEBRIEF_RETRY: "Try again",
    CLIENT_RETRY: "Repeat",
    DEBRIEF_LOADING: "Analyzing session...",
    // Manual end modal
    MANUAL_END_TITLE: "How did the session go?",
    MANUAL_END_CONFIRM: "Close session",
    TRANSCRIPT_LABEL: "CONVERSATION",
  },
};

// ── Outcome helpers ───────────────────────────────────────────────────────────
function getOutcomeLabel(outcome: FinalOutcome, t: typeof T["es"]): string {
  const map: Record<FinalOutcome, string> = {
    closed: t.OUTCOME_CLOSED,
    next_step: t.OUTCOME_NEXT_STEP,
    lost: t.OUTCOME_LOST,
    broken: t.OUTCOME_BROKEN,
    manual_stop: t.OUTCOME_MANUAL_STOP,
  };
  return map[outcome];
}

function getOutcomeColor(outcome: FinalOutcome): string {
  const map: Record<FinalOutcome, string> = {
    closed:      "text-emerald-400",
    next_step:   "text-teal-400",
    lost:        "text-amber-400",
    broken:      "text-zinc-400",
    manual_stop: "text-zinc-400",
  };
  return map[outcome];
}

function getOutcomeBg(outcome: FinalOutcome): string {
  const map: Record<FinalOutcome, string> = {
    closed:      "bg-emerald-400/10 border-emerald-400/20",
    next_step:   "bg-teal-400/10 border-teal-400/20",
    lost:        "bg-amber-400/10 border-amber-400/20",
    broken:      "bg-zinc-800/60 border-zinc-700/40",
    manual_stop: "bg-zinc-800/60 border-zinc-700/40",
  };
  return map[outcome];
}

// ── State indicator ───────────────────────────────────────────────────────────
const STATE_DOT: Record<ConversationState, string> = {
  favorable: "bg-teal-400",
  tense: "bg-amber-400",
  critical: "bg-orange-400",
};

const STATE_TEXT: Record<ConversationState, string> = {
  favorable: "text-teal-400",
  tense: "text-amber-400",
  critical: "text-orange-400",
};

function StateIndicator({ state, lang }: { state: ConversationState | null; lang: Lang }) {
  if (!state) return null;
  const t = T[lang];
  const label = state === "favorable" ? t.STATE_FAVORABLE : state === "tense" ? t.STATE_TENSE : t.STATE_CRITICAL;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATE_DOT[state])} />
      <span className={cn("text-[9px] font-mono tracking-widest uppercase", STATE_TEXT[state])}>
        {label}
      </span>
    </div>
  );
}

// ── Outcome confirmation modal (seller mode) ──────────────────────────────────
function OutcomeModal({
  detectedOutcome,
  lang,
  onConfirm,
  onContinue,
}: {
  detectedOutcome?: Exclude<ArenaOutcome, "none" | "manual_stop"> | null;
  lang: Lang;
  onConfirm: (outcome: FinalOutcome) => void;
  onContinue: () => void;
}) {
  const t = T[lang];
  const isManual = !detectedOutcome;
  const [correcting, setCorrecting] = useState(isManual);

  const aiOutcomes: Array<{ key: FinalOutcome; label: string }> = [
    { key: "closed", label: t.OUTCOME_CLOSED },
    { key: "next_step", label: t.OUTCOME_NEXT_STEP },
    { key: "lost", label: t.OUTCOME_LOST },
    { key: "broken", label: t.OUTCOME_BROKEN },
  ];
  const manualOutcomes: Array<{ key: FinalOutcome; label: string }> = [
    ...aiOutcomes,
    { key: "manual_stop", label: t.OUTCOME_MANUAL_STOP },
  ];
  const outcomes = isManual ? manualOutcomes : aiOutcomes;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center px-6 z-50">
      <div className="w-full max-w-xs bg-zinc-950 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-4">
        {!correcting && detectedOutcome ? (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">
                {t.MODAL_DETECT}
              </p>
              <p className={cn("text-base font-mono font-bold", getOutcomeColor(detectedOutcome))}>
                {getOutcomeLabel(detectedOutcome, t)}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => onConfirm(detectedOutcome)}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-mono font-bold hover:bg-zinc-100 active:scale-[0.98] transition-all"
              >
                {t.MODAL_CONFIRM}
              </button>
              <button
                onClick={onContinue}
                className="w-full py-2.5 rounded-xl border border-zinc-800 text-zinc-300 text-xs font-mono hover:border-zinc-600 hover:text-white transition-all"
              >
                {t.MODAL_CONTINUE}
              </button>
              <button
                onClick={() => setCorrecting(true)}
                className="w-full py-1.5 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                {t.MODAL_CORRECT}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">
              {isManual ? t.MANUAL_END_TITLE : t.MODAL_CORRECT_PROMPT}
            </p>
            <div className="flex flex-col gap-2">
              {outcomes.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => onConfirm(key)}
                  className={cn(
                    "w-full py-2.5 rounded-xl border text-xs font-mono transition-all text-left px-3",
                    key === detectedOutcome
                      ? "border-zinc-600 text-white bg-zinc-900"
                      : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  )}
                >
                  {label}
                </button>
              ))}
              {!isManual && (
                <button
                  onClick={() => setCorrecting(false)}
                  className="w-full py-1.5 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  ← {lang === "es" ? "Volver" : "Back"}
                </button>
              )}
              {isManual && (
                <button
                  onClick={onContinue}
                  className="w-full py-1.5 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  ← {lang === "es" ? "Cancelar" : "Cancel"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Profile label translations ────────────────────────────────────────────────
const CLIENT_PROFILE_LABEL: Record<string, Record<"es"|"en", string>> = {
  analytical:  { es: "Analítico",   en: "Analytical" },
  emotional:   { es: "Emocional",   en: "Emotional" },
  skeptical:   { es: "Escéptico",   en: "Skeptical" },
  cautious:    { es: "Cauto",       en: "Cautious" },
  dominant:    { es: "Dominante",   en: "Dominant" },
  indecisive:  { es: "Indeciso",    en: "Indecisive" },
  negotiator:  { es: "Negociador",  en: "Negotiator" },
};
const SELLER_PROFILE_LABEL: Record<string, Record<"es"|"en", string>> = {
  communicative: { es: "Comunicativo",  en: "Communicative" },
  authoritative: { es: "Autoritario",   en: "Authoritative" },
  technical:     { es: "Técnico",       en: "Technical" },
  passive:       { es: "Pasivo",        en: "Passive" },
  aggressive:    { es: "Agresivo",      en: "Aggressive" },
  consultive:    { es: "Consultivo",    en: "Consultive" },
};
const DIFFICULTY_LABEL: Record<string, Record<"es"|"en", string>> = {
  easy:   { es: "Fácil",   en: "Easy" },
  normal: { es: "Normal",  en: "Normal" },
  hard:   { es: "Difícil", en: "Hard" },
  brutal: { es: "Brutal",  en: "Brutal" },
};

// ── Confetti burst ────────────────────────────────────────────────────────────
function Confetti({ active, intensity = "high" }: { active: boolean; intensity?: "high" | "medium" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Colors: white + teal + emerald + sky (colorblind-safe palette)
    const COLORS = ["#ffffff","#ffffff","#2dd4bf","#34d399","#67e8f9","#a78bfa","#fbbf24","#f9a8d4"];
    const COUNT   = intensity === "high" ? 180 : 110;
    const DURATION = 200; // frames

    interface Piece {
      x: number; y: number; vx: number; vy: number;
      w: number; h: number; color: string;
      spin: number; rot: number; opacity: number;
    }

    const pieces: Piece[] = [];

    // Three burst origins across the top third of the screen
    const origins = [
      canvas.width * 0.25,
      canvas.width * 0.50,
      canvas.width * 0.75,
    ];

    for (let i = 0; i < COUNT; i++) {
      const ox = origins[i % 3] + (Math.random() - 0.5) * 60;
      const oy = canvas.height * 0.28;
      // Fan mostly upward: angle from -150° to -30° (in radians)
      const angle = (-Math.PI * 5 / 6) + Math.random() * (Math.PI * 2 / 3);
      const speed = 5 + Math.random() * 9;
      pieces.push({
        x: ox, y: oy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 8,
        h: 3 + Math.random() * 5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        spin: Math.random() * Math.PI * 2,
        rot: (Math.random() - 0.5) * 0.28,
        opacity: 1,
      });
    }

    let frame = 0;
    let raf: number;
    const GRAVITY   = 0.22;
    const FADE_START = Math.floor(DURATION * 0.55);
    const FADE_STEP  = 1 / (DURATION - FADE_START);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;

      for (const p of pieces) {
        p.vy += GRAVITY;
        p.vx *= 0.992; // subtle air resistance
        p.x  += p.vx;
        p.y  += p.vy;
        p.spin += p.rot;
        if (frame > FADE_START) p.opacity = Math.max(0, p.opacity - FADE_STEP);
        if (p.opacity <= 0) continue;

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        // Alternate between rects and tiny circles for variety
        if (p.w > 10) {
          ctx.arc(0, 0, p.w / 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }

      if (frame < DURATION) {
        raf = requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    raf = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [active, intensity]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 9999 }}
    />
  );
}

function CoachNote({ explanation, lang }: { explanation: string; lang: Lang }) {
  return (
    <div className="mt-1 ml-3 pl-2.5 border-l border-teal-500/35">
      <span className="text-[7px] font-mono tracking-[0.25em] uppercase text-teal-400/45 block mb-1">
        coach
      </span>
      <div className="text-[10.5px] text-zinc-500 leading-[1.5] [&_strong]:text-sky-200 [&_strong]:font-medium [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-0.5 [&_li]:flex [&_li]:gap-1.5 [&_li]:items-start">
        <RichText text={explanation} />
      </div>
    </div>
  );
}

// ── CoachNote skeleton ────────────────────────────────────────────────────────
function CoachNoteSkeleton() {
  return (
    <div className="mt-1.5 ml-5 pl-3 border-l-[1.5px] border-teal-500/20">
      <div className="w-10 h-1.5 bg-teal-500/15 rounded animate-pulse mb-2" />
      <div className="flex flex-col gap-1.5">
        <div className="w-28 h-2 bg-zinc-800/70 rounded animate-pulse" />
        <div className="w-full h-1.5 bg-zinc-800/50 rounded animate-pulse" />
        <div className="w-4/5 h-1.5 bg-zinc-800/40 rounded animate-pulse" />
      </div>
    </div>
  );
}

// ── Journey stage labels ───────────────────────────────────────────────────────
const JOURNEY_STAGES: Record<Lang, Array<{ id: StageId; label: string }>> = {
  es: [
    { id: "context",  label: "Contexto" },
    { id: "problem",  label: "Problema" },
    { id: "blocker",  label: "Bloqueo"  },
    { id: "fit",      label: "Encaje"   },
    { id: "advance",  label: "Avance"   },
    { id: "close",    label: "Cierre"   },
  ],
  en: [
    { id: "context",  label: "Context" },
    { id: "problem",  label: "Problem" },
    { id: "blocker",  label: "Blocker" },
    { id: "fit",      label: "Fit"     },
    { id: "advance",  label: "Advance" },
    { id: "close",    label: "Close"   },
  ],
};

// ── JourneyBar component ──────────────────────────────────────────────────────
function JourneyBar({ journey, lang }: { journey: JourneyData; lang: Lang }) {
  const stages = JOURNEY_STAGES[lang];
  const currentIdx = stages.findIndex(s => journey.stages[s.id] === "current");

  return (
    <div className="shrink-0 border-b border-white/4 px-4 py-2.5 bg-black/40">
      <div className="max-w-4xl mx-auto flex flex-col gap-1.5">
        {/* Stage pills row */}
        <div className="flex items-center gap-0">
          {stages.map((stage, i) => {
            const status = journey.stages[stage.id];
            const isCurrent = status === "current";
            const isDone = status === "done";
            const isClose = stage.id === "close";
            return (
              <div key={stage.id} className="flex items-center">
                {i > 0 && (
                  <div className={cn(
                    "w-5 h-px shrink-0",
                    isDone ? "bg-zinc-600" : "bg-zinc-800"
                  )} />
                )}
                <span className={cn(
                  "text-[8px] font-mono tracking-widest uppercase px-2 py-0.5 rounded-full transition-all whitespace-nowrap",
                  isCurrent && "text-teal-300 bg-teal-500/10 border border-teal-500/25",
                  isDone && "text-zinc-600",
                  !isCurrent && !isDone && "text-zinc-800",
                  isClose && journey.premature_close_risk === "high" && isCurrent && "text-amber-300 bg-amber-500/10 border-amber-500/25",
                )}>
                  {isDone ? "· " : ""}{stage.label}
                </span>
              </div>
            );
          })}
          {journey.premature_close_risk === "high" && currentIdx < 4 && (
            <span className="ml-3 text-[8px] font-mono tracking-widest uppercase text-amber-400/80 shrink-0">
              {lang === "es" ? "cierre prematuro" : "early close"}
            </span>
          )}
        </div>
        {/* Context line: what the seller is doing now */}
        {journey.now_help && (
          <p className="text-[9px] text-zinc-500 leading-relaxed tracking-wide">
            {journey.now_help}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Arena component ───────────────────────────────────────────────────────────
export function Arena({
  context,
  contextLabel,
  role,
  lang,
  arenaConfig = {},
  onExit,
  onGoArena,
  onGoArenaRole,
  onRetry,
}: {
  context: string;
  contextLabel: string;
  role: ArenaRole;
  lang: Lang;
  arenaConfig?: { clientProfile?: string; sellerProfile?: string; difficulty?: string };
  onExit: () => void;
  onGoArena?: () => void;
  onGoArenaRole?: () => void;
  onRetry?: () => void;
}) {
  const t = T[lang];
  const { theme, toggleTheme } = useTheme();

  const [arenaSessionId, setArenaSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ArenaMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStarting, setIsStarting] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [summary, setSummary] = useState<ArenaSummary | null>(null);
  const [allTurns, setAllTurns] = useState<ArenaMessage[]>([]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [exitStep, setExitStep] = useState<null | "outcomes" | "reason">(null);
  const [pendingExitReason, setPendingExitReason] = useState("");
  const [exitNote, setExitNote] = useState<{ text: string; outcome: FinalOutcome } | null>(null);
  const [conversationState, setConversationState] = useState<ConversationState | null>(null);
  // Terminal state detection (seller mode)
  const [pendingOutcome, setPendingOutcome] = useState<Exclude<ArenaOutcome, "none" | "manual_stop"> | null>(null);
  // Suggested response
  const [isSuggesting, setIsSuggesting] = useState(false);
  // Early exit prompt (no user turns yet)
  const [showEarlyExit, setShowEarlyExit] = useState(false);
  // Seller notes (client mode only)
  const [noteText, setNoteText] = useState("");
  const [noteCount, setNoteCount] = useState(0);
  const [sellerNotes, setSellerNotes] = useState<string[]>([]);
  // CoachLite (client mode only): coach data per message index, global on/off
  const [coachLiteMap, setCoachLiteMap] = useState<Record<number, CoachLite>>({});
  const [coachOn, setCoachOn] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(0);
  // Journey: latest sales stage data (updated each turn in client mode)
  const [latestJourney, setLatestJourney] = useState<JourneyData | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const aiLabel = role === "seller" ? t.AI_AS_CLIENT : t.AI_AS_SELLER;
  const roleTag = role === "seller" ? t.ROLE_TAG_SELLER : t.ROLE_TAG_CLIENT;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cycle loading phrases while waiting for AI in client mode
  useEffect(() => {
    if (!isSending || role !== "client") { setLoadingPhase(0); return; }
    const id = setInterval(() => setLoadingPhase(p => (p + 1) % COACH_LOADING[lang].length), 1800);
    return () => clearInterval(id);
  }, [isSending, role, lang]);

  // Focus textarea as soon as the session finishes loading
  useEffect(() => {
    if (!isStarting) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isStarting]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/arena/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, lang, context, ...arenaConfig }),
        });
        const data = await res.json() as { arenaSessionId: string; openingMessage: string };
        if (cancelled) return;
        setArenaSessionId(data.arenaSessionId);
        setMessages([{ index: 0, speaker: "ai", message: data.openingMessage }]);
        setConversationState(inferState(data.openingMessage, lang));
      } catch {
        if (!cancelled) {
          setMessages([{ index: 0, speaker: "ai", message: lang === "en" ? "Ready." : "Listo." }]);
          setArenaSessionId("offline-" + Date.now());
        }
      } finally {
        if (!cancelled) setIsStarting(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleEnd = useCallback(async (outcome: FinalOutcome = "manual_stop") => {
    if (!arenaSessionId || isEnding) return;
    setIsEnding(true);
    setPendingOutcome(null);
    try {
      const res = await fetch("/api/arena/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arenaSessionId, outcome }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { turns: ArenaMessage[]; summary: ArenaSummary };
      if (!data.turns || !data.summary) throw new Error("Invalid response");
      setAllTurns(data.turns);
      setSummary(data.summary);
    } catch {
      // Fallback: build summary from local state (handles server restarts, 404s, etc.)
      const localTurns = messages.map((m, i) => ({ ...m, index: i }));
      setAllTurns(localTurns);
      setSummary({
        role,
        context,
        lang,
        totalTurns: messages.length,
        userTurns: messages.filter(m => m.speaker === "user").length,
        createdAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
        outcome,
      });
    } finally {
      setIsEnding(false);
    }
  }, [arenaSessionId, isEnding, messages, role, context, lang]);

  const handleClientExit = useCallback(async (outcome: FinalOutcome) => {
    const reason = pendingExitReason.trim();
    setExitNote({ text: reason, outcome });
    setExitStep(null);
    setPendingExitReason("");
    await handleEnd(outcome);
  }, [pendingExitReason, handleEnd]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isSending || !arenaSessionId) return;

    const userMsg: ArenaMessage = { index: messages.length, speaker: "user", message: text.trim() };
    const expectedAiIndex = messages.length + 1;
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch("/api/arena/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arenaSessionId, userMessage: text.trim() }),
      });
      const data = await res.json() as { aiMessage: string; terminalSignal?: ArenaOutcome; coachLite?: CoachLite };
      setMessages(prev => [...prev, { index: prev.length, speaker: "ai", message: data.aiMessage }]);
      setConversationState(inferState(data.aiMessage, lang));
      if (data.coachLite) {
        setCoachLiteMap(prev => ({ ...prev, [expectedAiIndex]: data.coachLite! }));
        if (data.coachLite.journey) {
          setLatestJourney(data.coachLite.journey);
        }
      }
      if (data.terminalSignal && data.terminalSignal !== "none" && data.terminalSignal !== "manual_stop") {
        setPendingOutcome(data.terminalSignal as Exclude<ArenaOutcome, "none" | "manual_stop">);
      }
    } catch {
      setMessages(prev => [...prev, {
        index: prev.length,
        speaker: "ai",
        message: lang === "en" ? "(Connection error)" : "(Error de conexión)",
      }]);
    } finally {
      setIsSending(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isSending, arenaSessionId, messages.length, lang]);

  // Comodín shortcut: AI generates a contextual client response in the given direction
  const sendShortcut = useCallback(async (direction: "agree" | "object") => {
    if (isSending || !arenaSessionId) return;
    const expectedUserIdx = messages.length;
    const expectedAiIdx = messages.length + 1;

    // Show client message immediately — don't wait for the API
    const immediateMsg = direction === "agree" ? t.CLIENT_ACCEPT_MSG : t.CLIENT_OBJECTION_MSG;
    setMessages(prev => [
      ...prev,
      { index: expectedUserIdx, speaker: "user" as const, message: immediateMsg },
    ]);
    setIsSending(true);

    try {
      const res = await fetch("/api/arena/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arenaSessionId, shortcutDirection: direction }),
      });
      const data = await res.json() as {
        aiMessage: string;
        generatedUserMessage: string;
        terminalSignal?: ArenaOutcome;
        coachLite?: CoachLite;
      };
      // Replace client message with actual generated one, then append vendor message
      setMessages(prev => {
        const updated = [...prev];
        updated[expectedUserIdx] = { index: expectedUserIdx, speaker: "user" as const, message: data.generatedUserMessage };
        return [...updated, { index: expectedAiIdx, speaker: "ai" as const, message: data.aiMessage }];
      });
      setConversationState(inferState(data.aiMessage, lang));
      if (data.coachLite) {
        setCoachLiteMap(prev => ({ ...prev, [expectedAiIdx]: data.coachLite! }));
        if (data.coachLite.journey) setLatestJourney(data.coachLite.journey);
      }
      if (data.terminalSignal && data.terminalSignal !== "none" && data.terminalSignal !== "manual_stop") {
        setPendingOutcome(data.terminalSignal as Exclude<ArenaOutcome, "none" | "manual_stop">);
      }
    } catch {
      setMessages(prev => [...prev, {
        index: prev.length, speaker: "ai" as const,
        message: lang === "en" ? "(Connection error)" : "(Error de conexión)",
      }]);
    } finally {
      setIsSending(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isSending, arenaSessionId, messages.length, lang, t]);

  // Arrow key shortcuts for client mode (↓ = agree comodín, ↑ = object comodín)
  useEffect(() => {
    if (role !== "client" || isStarting || isSending || isEnding) return;
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement === textareaRef.current && input.trim() !== "") return;
      if (exitStep !== null) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        void sendShortcut("agree");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        void sendShortcut("object");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [role, isStarting, isSending, isEnding, exitStep, input, sendShortcut]);

  const handleSend = useCallback(() => {
    void sendMessage(input);
  }, [input, sendMessage]);

  const submitNote = useCallback(async () => {
    const note = noteText.trim();
    if (!note || !arenaSessionId) return;
    // Clear immediately, don't wait for fetch
    setNoteText("");
    setIsSending(true);
    try {
      await fetch("/api/arena/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arenaSessionId, note }),
      });
      setNoteCount(c => c + 1);
      setSellerNotes(prev => [...prev, note]);
      // Insert a visual note marker in the conversation
      setMessages(prev => [
        ...prev,
        { index: -1, speaker: "note", message: note },
      ]);
      // Trigger the seller to repitch with the new constraint
      const res = await fetch("/api/arena/repitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arenaSessionId }),
      });
      const data = await res.json() as { message?: string; index?: number };
      const aiMsg = data.message ?? "";
      if (aiMsg) {
        setMessages(prev => [
          ...prev,
          { index: data.index ?? prev.length, speaker: "ai", message: aiMsg },
        ]);
      }
    } catch { /* silent */ }
    setIsSending(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [noteText, arenaSessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const fetchSuggestion = useCallback(async () => {
    if (!arenaSessionId || isSuggesting || isSending || messages.length < 1) return;
    setIsSuggesting(true);
    try {
      const res = await fetch("/api/arena/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arenaSessionId, lang }),
      });
      const data = await res.json() as { suggestion?: string };
      if (data.suggestion) {
        await sendMessage(data.suggestion);
      }
    } catch {
      // silently ignore
    } finally {
      setIsSuggesting(false);
    }
  }, [arenaSessionId, isSuggesting, isSending, messages.length, lang, sendMessage]);

  const handleExportLog = () => {
    if (!summary) return;
    const log = buildArenaAuditLog({
      sessionId: arenaSessionId,
      lang,
      role,
      context: summary.context,
      outcome: summary.outcome,
      outcomeSource: exitNote ? "user" : "ai",
      totalTurns: summary.totalTurns,
      userTurns: summary.userTurns,
      createdAt: summary.createdAt,
      closedAt: summary.closedAt,
      allMessages: allTurns,
      exitNote: exitNote ?? null,
      debrief: summary.debrief ?? null,
      runtimeInstructions: sellerNotes.length > 0 ? sellerNotes : undefined,
    });
    triggerAuditLogDownload(log, arenaSessionId);
  };

  const handleMidSessionDownload = useCallback(() => {
    // Use live messages (not allTurns — that's only set on session end)
    const liveTurns = messages.filter(m => m.speaker === "user" || m.speaker === "ai");
    if (liveTurns.length === 0) return;
    const now = new Date().toISOString();
    const userTurns = liveTurns.filter(t => t.speaker === "user").length;
    const log = buildArenaAuditLog({
      sessionId: arenaSessionId,
      lang,
      role,
      context,
      outcome: "in_progress",
      outcomeSource: "system",
      totalTurns: liveTurns.length,
      userTurns,
      createdAt: now,
      closedAt: now,
      allMessages: liveTurns,
      exitNote: null,
      debrief: null,
      runtimeInstructions: sellerNotes.length > 0 ? sellerNotes : undefined,
    });
    triggerAuditLogDownload(log, arenaSessionId);
  }, [messages, arenaSessionId, lang, role, context, sellerNotes]);

  const handleDownloadReport = () => {
    if (!summary) return;
    const isEs = lang === "es";
    const date = new Date(summary.closedAt || summary.createdAt).toLocaleString(isEs ? "es-ES" : "en-US");
    const outcomeWord = summary.outcome === "closed"    ? (isEs ? "CERRADO" : "CLOSED")
      : summary.outcome === "next_step" ? (isEs ? "AVANCE" : "PROGRESS")
      : summary.outcome === "lost"      ? (isEs ? "PERDIDO" : "LOST")
      :                                    (isEs ? "PARADO"  : "STOPPED");
    const outcomeLabel = getOutcomeLabel(summary.outcome, t);
    const profileLines: string[] = [];
    if (arenaConfig.clientProfile) profileLines.push(`- ${isEs ? "Perfil de cliente" : "Client profile"}: ${arenaConfig.clientProfile}`);
    if (arenaConfig.sellerProfile) profileLines.push(`- ${isEs ? "Perfil de vendedor" : "Seller profile"}: ${arenaConfig.sellerProfile}`);
    if (arenaConfig.difficulty)    profileLines.push(`- ${isEs ? "Dificultad" : "Difficulty"}: ${arenaConfig.difficulty}`);
    profileLines.push(`- ${isEs ? "Rol practicado" : "Role practiced"}: ${role === "seller" ? (isEs ? "vendedor" : "seller") : (isEs ? "cliente" : "client")}`);
    const transcriptText = allTurns.map(turn => {
      const sp = turn.speaker === "user"
        ? (isEs ? "TÚ" : "YOU")
        : (role === "seller" ? (isEs ? "CLIENTE" : "CLIENT") : (isEs ? "VENDEDOR" : "SELLER"));
      return `**${sp}:** ${turn.message}`;
    }).join("\n\n");
    const critiqueLines = summary.debrief?.critique.map((c, i) => `${i + 1}. ${c}`).join("\n") ?? "";
    const sections: string[] = [
      isEs ? "# Informe de sesión — Closer Wizard Arena" : "# Session Report — Closer Wizard Arena",
      "",
      `**${isEs ? "Fecha" : "Date"}:** ${date}`,
      `**${isEs ? "Contexto" : "Context"}:** ${summary.context || "—"}`,
      "",
      isEs ? "## Resultado" : "## Result",
      `${outcomeWord} — ${outcomeLabel}`,
      ...(summary.debrief ? [`${isEs ? "Puntuación" : "Score"}: **${summary.debrief.score}/10**`] : []),
      "",
      isEs ? "## Perfil de sesión" : "## Session profile",
      ...profileLines,
      "",
      ...(critiqueLines ? [
        isEs ? "## Puntos de mejora" : "## Points to improve",
        critiqueLines,
        "",
        isEs ? "## Ideas para la próxima sesión" : "## Ideas for next session",
        isEs
          ? "_Toma cada punto de mejora y diseña una táctica concreta: ¿Qué dirías? ¿Cómo lo estructurarías? Escríbelo antes de tu próxima práctica._"
          : "_Take each improvement point and design a concrete tactic: What would you say? How would you structure it? Write it down before your next practice._",
        "",
      ] : []),
      isEs ? "## Transcripción completa" : "## Full transcript",
      "",
      transcriptText,
    ];
    const md = sections.join("\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `arena-report-${arenaSessionId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Summary screen ──────────────────────────────────────────────────────────
  if (summary) {
    const roleName = role === "seller" ? t.ROLE_SELLER : t.ROLE_CLIENT;
    const outcomeName = getOutcomeLabel(summary.outcome, t);
    const outcomeColor = getOutcomeColor(summary.outcome);
    const outcomeBg = getOutcomeBg(summary.outcome);
    const debrief = summary.debrief;

    const isWin = summary.outcome === "closed" || summary.outcome === "next_step";
    const isClosed = summary.outcome === "closed";

    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center px-6 overflow-y-auto py-5">

        {/* ── Confetti — fires on any win ──────────────────────────────────── */}
        <Confetti active={isWin} intensity={isClosed ? "high" : "medium"} />

        <div className="w-full max-w-sm flex flex-col gap-3">

          {/* Brand */}
          <div className="flex items-center gap-2">
            <WizardIcon className="w-4 h-4 text-zinc-400" />
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-zinc-400">Closer Wizard</span>
            <span className="text-zinc-700 text-[10px]">·</span>
            <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-zinc-500">{t.ARENA}</span>
          </div>

          {/* Hero verdict */}
          {isClosed ? (
            /* CERRADO — vertical centrado, celebración completa */
            <div className={cn(
              "rounded-2xl px-5 py-6 flex flex-col items-center gap-3",
              outcomeBg, "ring-1 ring-white/10",
            )}>
              <Trophy
                className="w-16 h-16 drop-shadow-[0_0_14px_rgba(52,211,153,0.6)]"
                style={{ animation: "arena-win-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both" }}
              />
              <div className="flex flex-col items-center gap-0.5">
                <p className="text-[9px] font-mono tracking-[0.2em] uppercase text-zinc-500">{t.OUTCOME_LABEL}</p>
                <p className={cn("text-5xl font-mono font-black tracking-tight leading-none", outcomeColor)}>
                  {lang === "es" ? "CERRADO" : "CLOSED"}
                </p>
                <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{outcomeName}</p>
              </div>
            </div>
          ) : summary.outcome === "next_step" ? (
            /* AVANCE — horizontal compacto, sin justify-between */
            <div className={cn(
              "rounded-2xl px-5 py-4 flex items-center gap-4",
              outcomeBg, "ring-1 ring-white/10",
            )}>
              <TrendingUp
                className={cn("w-12 h-12 shrink-0", outcomeColor)}
                style={{ animation: "arena-win-pop 0.45s cubic-bezier(0.34,1.56,0.64,1) both" }}
              />
              <div className="flex flex-col gap-0.5">
                <p className="text-[9px] font-mono tracking-[0.2em] uppercase text-zinc-500">{t.OUTCOME_LABEL}</p>
                <p className={cn("text-4xl font-mono font-black tracking-tight leading-none", outcomeColor)}>
                  {lang === "es" ? "GANADO" : "WON"}
                </p>
                <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{outcomeName}</p>
              </div>
            </div>
          ) : (
            /* Non-win layout — horizontal */
            <div className={cn("rounded-2xl px-5 py-4 flex items-center justify-between gap-4", outcomeBg)}>
              <div className="flex flex-col gap-0.5 min-w-0">
                <p className="text-[9px] font-mono tracking-[0.2em] uppercase text-zinc-500">{t.OUTCOME_LABEL}</p>
                <p className={cn("text-3xl font-mono font-black tracking-tight leading-none", outcomeColor)}>
                  {summary.outcome === "lost"
                    ? (lang === "es" ? "PERDIDO" : "LOST")
                    : (lang === "es" ? "PARADO"  : "STOPPED")}
                </p>
                <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{outcomeName}</p>
              </div>
              <div className={cn("shrink-0 mr-1", outcomeColor)}>
                {summary.outcome === "lost"
                  ? <span className="text-5xl font-mono leading-none select-none">✗</span>
                  : <span className="text-4xl font-mono leading-none select-none text-zinc-600">·</span>}
              </div>
            </div>
          )}

          {/* Exit note — client mode only */}
          {exitNote?.text && role === "client" && (
            <div className="border border-zinc-800 rounded-xl px-3 py-2.5 flex flex-col gap-0.5">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.CLIENT_EXIT_NOTE_LABEL}</p>
              <p className="text-xs font-mono text-zinc-300 leading-relaxed">{exitNote.text}</p>
            </div>
          )}

          {/* Debrief block */}
          {role === "seller" && debrief && (
            <div className="flex flex-col gap-2.5 border border-zinc-800 rounded-xl px-4 py-3 bg-zinc-950">
              <div className="flex flex-col gap-0">
                <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.DEBRIEF_SCORE}</p>
                <div className="flex items-baseline gap-1">
                  <span className={cn(
                    "text-3xl font-mono font-bold tabular-nums",
                    debrief.score <= 3 ? "text-orange-400"
                    : debrief.score <= 5 ? "text-amber-400"
                    : debrief.score <= 7 ? "text-zinc-200"
                    : "text-teal-400"
                  )}>
                    {debrief.score}
                  </span>
                  <span className="text-base font-mono text-zinc-600">/ 10</span>
                </div>
              </div>
              {debrief.critique.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.DEBRIEF_CRITIQUE}</p>
                  <div className="flex flex-col gap-1.5">
                    {debrief.critique.map((point, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-zinc-600 font-mono text-[10px] shrink-0">—</span>
                        <p className="text-[11px] font-mono text-zinc-300 leading-relaxed">{point}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Conversation transcript — collapsible */}
          {allTurns.length > 0 && (
            <div className="border border-zinc-800 rounded-xl bg-zinc-950 overflow-hidden">
              <button
                onClick={() => setTranscriptOpen(o => !o)}
                onMouseDown={e => e.preventDefault()}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/3 transition-colors"
              >
                <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.TRANSCRIPT_LABEL}</p>
                <span className={cn("text-zinc-600 text-xs font-mono transition-transform duration-200", transcriptOpen ? "rotate-180" : "")}>▾</span>
              </button>
              {transcriptOpen && (
                <div className="flex flex-col gap-3 max-h-52 overflow-y-auto px-4 pb-3 scrollbar-thin border-t border-zinc-800/60">
                  <div className="h-1" />
                  {allTurns.map((turn, i) => {
                    const isUser = turn.speaker === "user";
                    return (
                      <div key={i} className={cn("flex flex-col gap-0.5", isUser ? "items-end" : "items-start")}>
                        <span className={cn(
                          "text-[8px] font-mono tracking-widest uppercase",
                          isUser ? "text-teal-400" : "text-sky-400"
                        )}>
                          {isUser ? (lang === "es" ? "TÚ" : "YOU") : (role === "seller" ? t.AI_AS_CLIENT : t.AI_AS_SELLER)}
                        </span>
                        <p className={cn(
                          "text-[11px] font-mono leading-relaxed px-2.5 py-1.5 rounded-lg max-w-[88%]",
                          isUser
                            ? "bg-zinc-800 text-white text-right"
                            : "bg-zinc-900 text-zinc-200 text-left border border-zinc-700/60"
                        )}>
                          <BoldText text={turn.message} />
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Session info — compact grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-white/8 pt-3">
            {/* Seller mode: show AI client profile + difficulty */}
            {role === "seller" && arenaConfig.clientProfile && (
              <div className="flex flex-col gap-0">
                <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{lang === "es" ? "CLIENTE IA" : "AI CLIENT"}</p>
                <p className="text-xs font-mono font-semibold text-white">
                  {CLIENT_PROFILE_LABEL[arenaConfig.clientProfile]?.[lang] ?? arenaConfig.clientProfile.replace(/_/g, " ")}
                </p>
              </div>
            )}
            {role === "seller" && arenaConfig.difficulty && (
              <div className="flex flex-col gap-0">
                <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{lang === "es" ? "DIFICULTAD" : "DIFFICULTY"}</p>
                <p className="text-xs font-mono font-semibold text-white">
                  {DIFFICULTY_LABEL[arenaConfig.difficulty]?.[lang] ?? arenaConfig.difficulty}
                </p>
              </div>
            )}
            {/* Client mode: show AI seller profile if configured */}
            {role === "client" && arenaConfig.sellerProfile && (
              <div className="flex flex-col gap-0">
                <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{lang === "es" ? "VENDEDOR IA" : "AI SELLER"}</p>
                <p className="text-xs font-mono font-semibold text-white">
                  {SELLER_PROFILE_LABEL[arenaConfig.sellerProfile]?.[lang] ?? arenaConfig.sellerProfile.replace(/_/g, " ")}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-0">
              <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.TURNS}</p>
              <p className="text-xs font-mono font-semibold text-white">{summary.userTurns} / {summary.totalTurns}</p>
            </div>
            {summary.context && (
              <div className="col-span-2 flex flex-col gap-0 mt-0.5">
                <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{lang === "es" ? "CONTEXTO" : "CONTEXT"}</p>
                <p className="text-[11px] font-mono text-zinc-300 leading-relaxed line-clamp-2">{summary.context}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1.5 border-t border-white/8 pt-3">
            {onRetry && (
              <button
                onClick={onRetry}
                className="w-full bg-white text-black text-xs font-mono font-bold py-2.5 rounded-xl hover:bg-zinc-100 active:scale-[0.98] transition-all"
              >
                {["closed", "next_step"].includes(summary.outcome) ? t.CLIENT_RETRY : t.DEBRIEF_RETRY}
              </button>
            )}
            <button
              onClick={handleDownloadReport}
              className={cn(
                "w-full text-xs font-mono font-bold py-2.5 rounded-xl active:scale-[0.98] transition-all",
                onRetry
                  ? "border border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-white"
                  : "bg-white text-black hover:bg-zinc-100"
              )}
            >
              {lang === "es" ? "Descargar informe (.md)" : "Download report (.md)"}
            </button>
            <button
              onClick={onExit}
              className="w-full text-center text-[10px] font-mono text-zinc-500 hover:text-zinc-200 py-1.5 transition-colors"
            >
              {t.CLOSE}
            </button>
          </div>

        </div>
      </div>
    );
  }

  // ── Main Arena screen ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black flex flex-col font-mono overflow-hidden">

      {/* Backdrop — closes exit panel when clicking outside */}
      {exitStep !== null && (
        <div className="fixed inset-0 z-10" onClick={() => setExitStep(null)} />
      )}

      {/* Early exit — no user turns yet */}
      {showEarlyExit && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center px-6 z-50">
          <div className="w-full max-w-xs flex flex-col gap-3">
            <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">
              {lang === "es" ? "No has practicado nada todavía" : "You haven't practiced yet"}
            </p>
            <button
              onClick={() => setShowEarlyExit(false)}
              className="w-full py-3 rounded-xl bg-white text-black text-xs font-mono font-bold hover:bg-zinc-100 active:scale-[0.98] transition-all"
            >
              {lang === "es" ? "Cancelar" : "Cancel"}
            </button>
            <button
              onClick={onExit}
              className="w-full py-3 rounded-xl border border-zinc-800 text-zinc-300 text-xs font-mono hover:border-zinc-600 hover:text-white active:scale-[0.98] transition-all"
            >
              {lang === "es" ? "Volver al menú" : "Back to menu"}
            </button>
          </div>
        </div>
      )}

      {/* Outcome confirmation modal — AI-detected */}
      {pendingOutcome && (
        <OutcomeModal
          detectedOutcome={pendingOutcome}
          lang={lang}
          onConfirm={(outcome) => void handleEnd(outcome)}
          onContinue={() => setPendingOutcome(null)}
        />
      )}


      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-white/6">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 shrink-0 group"
            title={t.EXIT}
          >
            <WizardIcon className="w-2.5 h-2.5 text-zinc-400 group-hover:text-white transition-colors" />
            <span className="text-[8px] tracking-[0.25em] uppercase text-zinc-400 group-hover:text-white transition-colors">Closer Wizard</span>
          </button>
          <div className="w-px h-2.5 bg-zinc-800 shrink-0" />
          <button
            onClick={onGoArena ?? onExit}
            className="text-[10px] tracking-widest uppercase text-sky-400 font-semibold shrink-0 hover:text-sky-200 transition-colors"
          >
            {t.ARENA}
          </button>
          <div className="w-px h-2.5 bg-zinc-800 shrink-0" />
          <button
            onClick={onGoArenaRole ?? onGoArena ?? onExit}
            className="text-[8px] tracking-widest uppercase text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
          >
            {roleTag}
          </button>
          {contextLabel && (
            <>
              <div className="w-px h-2.5 bg-zinc-800 shrink-0" />
              <span className="text-[9px] text-zinc-500 truncate">{contextLabel}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-4">
          <StateIndicator state={conversationState} lang={lang} />
          <button
            onClick={toggleTheme}
            onMouseDown={e => e.preventDefault()}
            title={theme === "dark" ? "Tema claro" : "Tema oscuro"}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            {theme === "dark" ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
          </button>
          <button
            onClick={onExit}
            className="text-[9px] tracking-widest uppercase text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            {t.EXIT}
          </button>
        </div>
      </div>

      {/* ── Journey bar (client mode, coach on, has data) ──────────────────── */}
      {role === "client" && coachOn && latestJourney && (
        <JourneyBar journey={latestJourney} lang={lang} />
      )}

      {/* ── Message list ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isStarting ? (
          <div className="flex items-center justify-center h-full gap-2 text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs tracking-widest uppercase">{t.STARTING}</span>
          </div>
        ) : (
          <div className={cn(
            "mx-auto flex flex-col gap-5 transition-[max-width] duration-300",
            role === "client" && coachOn ? "max-w-3xl" : "max-w-2xl"
          )}>
            {messages.map((msg, i) => {
              const showCoachSlot = role === "client" && coachOn && msg.speaker === "ai" && !!coachLiteMap[msg.index];
              if (msg.speaker === "note") {
                return (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    {role === "client" && coachOn && <div className="w-44 shrink-0" />}
                    <div className="flex-1 h-px bg-zinc-800" />
                    <span className="text-[8px] font-mono tracking-widest uppercase text-zinc-600 shrink-0 flex items-center gap-1">
                      <StickyNote className="w-2.5 h-2.5" />
                      {msg.message}
                    </span>
                    <div className="flex-1 h-px bg-zinc-800" />
                  </div>
                );
              }
              return (
                <div key={i} className="flex items-start gap-4">
                  {/* Left coach column — only renders when there's actual data */}
                  {role === "client" && coachOn && (
                    <div className="w-44 shrink-0 self-start pt-5">
                      {showCoachSlot
                        ? <CoachNote explanation={coachLiteMap[msg.index]!.explanation} lang={lang} />
                        : null}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <MessageRow msg={msg} youLabel={t.YOU} aiLabel={aiLabel} />
                  </div>
                </div>
              );
            })}
            {isSending && (
              <div className="flex items-start gap-4">
                {role === "client" && coachOn && (
                  <div className="w-44 shrink-0 self-start pt-5">
                    <CoachNoteSkeleton />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {role === "client" ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] tracking-widest uppercase text-sky-400/70">{aiLabel}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-sky-400/60 animate-pulse shrink-0" />
                        <span className="text-[11px] font-mono text-zinc-500 italic">
                          {COACH_LOADING[lang][loadingPhase]}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] tracking-widest uppercase text-zinc-600">{aiLabel}</span>
                      <div className="flex items-center gap-1.5 text-zinc-600">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="text-xs">{t.SENDING}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/6 px-4 py-3">
        <div className="max-w-2xl mx-auto flex flex-col gap-2">

          {/* Client mode: exit panel (only shown when active) */}
          {role === "client" && !isStarting && messages.length >= 1 && exitStep !== null && (
              <div className="relative z-20 flex flex-col gap-1.5 px-2.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl">
                {exitStep === "outcomes" ? (
                  /* Step 1 — choose outcome */
                  <>
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-[8px] font-mono tracking-widest uppercase text-zinc-600">{t.CLIENT_EXIT_TITLE}</p>
                      <button onClick={() => setExitStep(null)} className="text-[9px] text-zinc-700 hover:text-zinc-400 transition-colors leading-none">✕</button>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => void handleClientExit("closed")}
                        disabled={isEnding}
                        className="flex-1 py-1.5 rounded-lg border text-[9px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-teal-400 border-teal-400/30 hover:border-teal-400/60 hover:bg-teal-400/5 text-center leading-snug"
                      >
                        {isEnding ? <Loader2 className="w-3 h-3 animate-spin inline" /> : t.CLIENT_EXIT_CONVINCED}
                      </button>
                      <button
                        onClick={() => setExitStep("reason")}
                        disabled={isEnding}
                        className="flex-1 py-1.5 rounded-lg border text-[9px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-amber-400 border-amber-400/30 hover:border-amber-400/60 hover:bg-amber-400/5 text-center leading-snug"
                      >
                        {t.CLIENT_EXIT_LOST}
                      </button>
                      <button
                        onClick={() => void handleClientExit("manual_stop")}
                        disabled={isEnding}
                        className="flex-1 py-1.5 rounded-lg border text-[9px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-zinc-500 border-zinc-800 hover:border-zinc-600 hover:text-zinc-300 text-center leading-snug"
                      >
                        {t.CLIENT_EXIT_QUIT}
                      </button>
                    </div>
                  </>
                ) : (
                  /* Step 2 — reason for "lost" */
                  <>
                    <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-500">{t.CLIENT_EXIT_REASON_TITLE}</p>
                    <textarea
                      value={pendingExitReason}
                      onChange={e => setPendingExitReason(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey && !isEnding) { e.preventDefault(); void handleClientExit("lost"); }
                        if (e.key === "Escape") setExitStep("outcomes");
                      }}
                      placeholder={t.CLIENT_EXIT_REASON_PH}
                      autoFocus
                      rows={2}
                      className="w-full bg-transparent border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setExitStep("outcomes")}
                        className="px-3 py-1.5 rounded-lg border text-[10px] font-mono tracking-wide transition-all text-zinc-500 border-zinc-800 hover:border-zinc-600 hover:text-zinc-300"
                      >
                        {t.CLIENT_EXIT_BACK}
                      </button>
                      <button
                        onClick={() => void handleClientExit("lost")}
                        disabled={isEnding}
                        className="flex-1 py-1.5 rounded-lg border text-[10px] font-mono tracking-wide transition-all disabled:opacity-30 disabled:pointer-events-none text-amber-400 border-amber-400/30 hover:border-amber-400/60 hover:bg-amber-400/5"
                      >
                        {isEnding ? <Loader2 className="w-3 h-3 animate-spin inline" /> : t.CLIENT_EXIT_CONFIRM}
                      </button>
                    </div>
                  </>
                )}
              </div>
          )}

          {role === "seller" ? (
            /* Seller: textarea (with sparkles icon) + end button side by side */
            <div className="grid gap-2" style={{gridTemplateColumns: "1fr auto"}}>
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t.PLACEHOLDER}
                  rows={3}
                  disabled={isStarting || isSending}
                  autoFocus
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 pr-9 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors resize-none leading-relaxed disabled:opacity-40"
                />
                <button
                  onClick={() => void fetchSuggestion()}
                  disabled={isSuggesting || isStarting || isSending || messages.length < 1}
                  onMouseDown={e => e.preventDefault()}
                  title={lang === "es" ? "Enviar respuesta ideal" : "Send ideal response"}
                  className="absolute top-2 right-2 p-1.5 rounded-lg text-zinc-500 hover:text-sky-400 hover:bg-white/8 transition-all disabled:opacity-25 disabled:pointer-events-none"
                >
                  {isSuggesting
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Sparkles className="w-3.5 h-3.5" />
                  }
                </button>
              </div>
              <div className="flex flex-col gap-1.5 h-full">
                <button
                  onClick={() => {
                    const hasUserTurns = messages.some(m => m.speaker === "user");
                    if (!hasUserTurns) { setShowEarlyExit(true); }
                    else { void handleEnd("manual_stop"); }
                  }}
                  disabled={isEnding || isStarting}
                  onMouseDown={e => e.preventDefault()}
                  className="w-20 flex-1 rounded-xl border border-zinc-700 text-zinc-300 text-[9px] font-mono tracking-wider uppercase leading-snug hover:border-zinc-400 hover:text-white active:scale-[0.98] transition-all disabled:opacity-25 disabled:pointer-events-none flex items-center justify-center text-center px-1"
                >
                  {isEnding
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <span>{lang === "es" ? "Terminar sesión" : "End session"}</span>
                  }
                </button>
                {messages.some(m => m.speaker === "user") && (
                  <button
                    onClick={handleMidSessionDownload}
                    onMouseDown={e => e.preventDefault()}
                    title={lang === "es" ? "Descargar log de conversación" : "Download conversation log"}
                    className="w-20 flex items-center justify-center gap-1 text-[8px] font-mono tracking-widest uppercase text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    <Download className="w-2.5 h-2.5" />
                    log
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Client: seller notes + textarea */
            <>
              {!isStarting && (
                <div className="flex items-center gap-2">
                  <StickyNote className="w-3 h-3 text-zinc-700 shrink-0" />
                  <input
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && noteText.trim()) { e.preventDefault(); void submitNote(); }
                      if (e.key === "Escape") { setNoteText(""); (e.target as HTMLInputElement).blur(); }
                    }}
                    placeholder={lang === "es" ? "Instrucción al vendedor — Enter para enviar" : "Seller instruction — Enter to send"}
                    disabled={isSending}
                    className="flex-1 min-w-0 bg-transparent border-b border-zinc-800 focus:border-zinc-600 text-[11px] font-mono text-white placeholder:text-zinc-700 focus:outline-none py-1 transition-colors disabled:opacity-40"
                  />
                  {noteCount > 0 && (
                    <span className="text-[8px] font-mono text-sky-400 tabular-nums shrink-0">{noteCount}</span>
                  )}
                </div>
              )}
              <div className="grid gap-2" style={{gridTemplateColumns: "1fr auto"}}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t.PLACEHOLDER}
                  rows={2}
                  disabled={isStarting || isSending}
                  autoFocus
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors resize-none leading-relaxed disabled:opacity-40"
                />
                {messages.length >= 1 && (
                  <button
                    onClick={() => setExitStep("outcomes")}
                    disabled={isEnding || isSending || isStarting}
                    onMouseDown={e => e.preventDefault()}
                    className="w-20 rounded-xl border border-zinc-700 text-zinc-300 text-[9px] font-mono tracking-wider uppercase leading-snug hover:border-zinc-400 hover:text-white active:scale-[0.98] transition-all disabled:opacity-25 disabled:pointer-events-none flex items-center justify-center text-center px-1"
                  >
                    {isEnding
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <span>{lang === "es" ? "Terminar chat" : "End chat"}</span>
                    }
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[8px] text-zinc-700 tracking-widest">
                  {lang === "es" ? "↓ ok · ↑ objeto · Enter envía" : "↓ ok · ↑ object · Enter sends"}
                </p>
                <div className="flex items-center gap-1.5">
                  {messages.some(m => m.speaker === "user") && (
                    <button
                      onClick={handleMidSessionDownload}
                      onMouseDown={e => e.preventDefault()}
                      title={lang === "es" ? "Descargar log" : "Download log"}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-mono tracking-widest uppercase border transition-all text-zinc-700 border-zinc-800/70 hover:text-zinc-400 hover:border-zinc-600"
                    >
                      <Download className="w-2 h-2" />
                      log
                    </button>
                  )}
                  <button
                    onClick={() => setCoachOn(prev => !prev)}
                    onMouseDown={e => e.preventDefault()}
                    title={lang === "es" ? "Anotaciones coach" : "Coach annotations"}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-mono tracking-widest uppercase border transition-all",
                      coachOn
                        ? "text-teal-300 border-teal-500/40 bg-teal-500/8"
                        : "text-zinc-700 border-zinc-800/70 hover:text-zinc-400 hover:border-zinc-600"
                    )}
                  >
                    <GraduationCap className="w-2 h-2" />
                    coach
                  </button>
                </div>
              </div>
            </>
          )}

        </div>
      </div>

    </div>
  );
}

// ── Bold markdown renderer ────────────────────────────────────────────────────
function BoldText({ text, className }: { text?: string; className?: string }) {
  const parts = (text ?? "").split(/\*\*([\s\S]+?)\*\*/g);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <strong key={i} className="font-semibold text-white">{part}</strong>
          : part
      )}
    </span>
  );
}

// Auto-bold any line that is a full question (ends with ?) and isn't already bolded
function autoHighlightQuestions(text: string): string {
  return text.split("\n").map(line => {
    const t = line.trim();
    if (t.endsWith("?") && !t.includes("**")) return `**${t}**`;
    return line;
  }).join("\n");
}

// ── Rich text renderer (for AI seller messages) ───────────────────────────────
// Handles: **bold**, paragraph breaks (\n\n), line breaks (\n), bullet lists (- item)
// Final question block (ends with ?) gets extra visual separation when it's the last block.
function RichText({ text }: { text?: string }) {
  const cleaned = (text ?? "").trim();
  // Filter out empty blocks first so isLast detection is accurate
  const rawBlocks = cleaned.split(/\n\n+/).filter(b => b.trim() !== "");

  return (
    <div className="flex flex-col gap-2">
      {rawBlocks.map((block, bi) => {
        const isLast = bi === rawBlocks.length - 1;
        // Detect question block from original text (before auto-bold adds **)
        const strippedBlock = block.replace(/\*\*/g, "").trim();
        const isQuestionBlock = strippedBlock.endsWith("?");
        const showDivider = isLast && isQuestionBlock && rawBlocks.length > 1;

        const processed = autoHighlightQuestions(block);
        const lines = processed.split("\n").filter(l => l.trim() !== "");
        if (lines.length === 0) return null;

        const allBullets = lines.every(l => /^[ \t]*-[ \t]/.test(l));
        const dividerClass = showDivider ? "mt-1 pt-2.5 border-t border-white/[0.06]" : undefined;

        if (allBullets) {
          return (
            <ul key={bi} className={cn("flex flex-col gap-1", dividerClass)}>
              {lines.map((line, li) => (
                <li key={li} className="flex gap-2 items-start">
                  <span className="text-zinc-500 shrink-0 mt-px select-none">—</span>
                  <span><BoldText text={line.replace(/^[ \t]*-[ \t]*/, "")} /></span>
                </li>
              ))}
            </ul>
          );
        }

        if (lines.length === 1) {
          return (
            <p key={bi} className={dividerClass}>
              <BoldText text={lines[0]} />
            </p>
          );
        }

        // Mixed block (e.g. heading + bullets) — render each line individually
        return (
          <div key={bi} className={cn("flex flex-col gap-0.5", dividerClass)}>
            {lines.map((line, li) => {
              if (/^[ \t]*-[ \t]/.test(line)) {
                return (
                  <p key={li} className="flex gap-2 items-start">
                    <span className="shrink-0 mt-px select-none opacity-40">—</span>
                    <span><BoldText text={line.replace(/^[ \t]*-[ \t]*/, "")} /></span>
                  </p>
                );
              }
              return <p key={li}><BoldText text={line} /></p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Message row ───────────────────────────────────────────────────────────────
function MessageRow({
  msg,
  youLabel,
  aiLabel,
}: {
  msg: ArenaMessage;
  youLabel: string;
  aiLabel: string;
}) {
  const isUser = msg.speaker === "user";
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <span className={cn(
        "text-[9px] tracking-widest uppercase",
        isUser ? "text-zinc-500" : "text-sky-400"
      )}>
        {isUser ? youLabel : aiLabel}
      </span>
      <div className={cn(
        "px-4 py-2.5 rounded-xl text-sm leading-relaxed",
        isUser
          ? "max-w-[80%] bg-zinc-900 border border-zinc-800 text-zinc-300 text-right"
          : "max-w-[90%] bg-zinc-950 border border-zinc-800/60 text-zinc-300 text-left"
      )}>
        {isUser
          ? <BoldText text={msg.message} />
          : <RichText text={msg.message} />
        }
      </div>
    </div>
  );
}
