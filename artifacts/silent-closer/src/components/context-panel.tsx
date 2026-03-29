import { useState } from "react";
import { ChevronDown, ChevronUp, Zap, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Closer Wizard icon: tilted hat + 4-point star ────────────────────────────
// Tilted cone gives character; band differentiates from plain triangle;
// 4-point star clearly reads "magic" even at 12px.
function WizardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 22" fill="currentColor" className={className} aria-hidden>
      {/* Tilted hat cone */}
      <path d="M10 1.5L17 16H3L10 1.5Z" />
      {/* Hat band — visible stripe that sells it as a hat, not a triangle */}
      <rect x="3" y="15.5" width="14" height="1.5" opacity="0.35" />
      {/* Brim — clearly wider than the cone */}
      <rect x="0.5" y="17" width="18" height="3" rx="1.5" />
      {/* 4-point diamond star — floats upper-right, outside the cone */}
      <path d="M20.5 1L21.5 3.5L24 4.5L21.5 5.5L20.5 8L19.5 5.5L17 4.5L19.5 3.5Z" />
    </svg>
  );
}

export { WizardIcon };

type Lang = "es" | "en";
type ContextMode = "quick" | "advanced";

const CP = {
  es: {
    DEFINE:    "Define el contexto",
    QUICK:     "Rápido",
    ADVANCED:  "Avanzado",
    START:     "Iniciar copiloto →",
    PLACEHOLDER: "Ej: quiero vender un piso en Dresden a un inversor muy analítico que duda de la ciudad",
    SESSION:   "Sesión",
    END:       "Finalizar",
    SUBTITLE:  "Inteligencia táctica conversacional",
    // Advanced step-by-step
    ADV_STEP:  (n: number, total: number) => `PASO ${n} DE ${total}`,
    ADV_BACK:  "← Atrás",
    ADV_NEXT:  "Siguiente →",
    ADV_SKIP:  "Omitir",
    ADV_START: "Iniciar copiloto →",
    ADV_Q: [
      "¿Quién eres tú en esta conversación?",
      "¿Con quién estás hablando?",
      "¿Qué quieres conseguir?",
      "¿Qué estás moviendo o proponiendo?",
      "¿Cuáles son los posibles frenos u objeciones?",
      "¿Algo más que deba saber?",
    ] as string[],
    ADV_PH: [
      "asesor, comercial, inversor, fundador…",
      "cliente, inversor, jefe, socio, decisor…",
      "cerrar, convencer, avanzar, negociar, acordar…",
      "un inmueble, una propuesta, un software, un acuerdo…",
      "precio, timing, desconfianza, comparación con otra opción…",
      "matices, contexto extra, situación especial… (opcional)",
    ] as string[],
    ADV_LABELS: [
      "Tu rol", "Con quién", "Objetivo", "Qué mueves", "Posibles frenos", "Notas",
    ] as string[],
  },
  en: {
    DEFINE:    "Set the context",
    QUICK:     "Quick",
    ADVANCED:  "Advanced",
    START:     "Start copilot →",
    PLACEHOLDER: "E.g: I want to sell an apartment in Berlin to a very analytical investor who doubts the city",
    SESSION:   "Session",
    END:       "End",
    SUBTITLE:  "Conversational tactical intelligence",
    ADV_STEP:  (n: number, total: number) => `STEP ${n} OF ${total}`,
    ADV_BACK:  "← Back",
    ADV_NEXT:  "Next →",
    ADV_SKIP:  "Skip",
    ADV_START: "Start copilot →",
    ADV_Q: [
      "Who are you in this conversation?",
      "Who are you talking to?",
      "What do you want to achieve?",
      "What are you moving or proposing?",
      "What are the likely objections or blockers?",
      "Anything else I should know?",
    ] as string[],
    ADV_PH: [
      "advisor, sales rep, investor, founder…",
      "client, investor, manager, partner, decision-maker…",
      "close, convince, advance, negotiate, agree…",
      "a property, a proposal, a software, a deal…",
      "price, timing, distrust, comparison with another option…",
      "extra context, special situation, nuances… (optional)",
    ] as string[],
    ADV_LABELS: [
      "Your role", "Who you're talking to", "Goal", "What you're moving", "Possible objections", "Notes",
    ] as string[],
  },
};

function buildContextFromAdvanced(answers: string[], lang: Lang): string {
  const labels = CP[lang].ADV_LABELS;
  const parts = answers
    .map((v, i) => v.trim() ? `${labels[i]}: ${v.trim()}` : null)
    .filter(Boolean);
  return parts.join("\n");
}

// ── Step-by-step Advanced form ───────────────────────────────────────────────
const ADV_TOTAL = 6;

function AdvancedForm({ onSubmit, lang }: { onSubmit: (context: string) => void; lang: Lang }) {
  const t = CP[lang];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(Array(ADV_TOTAL).fill(""));

  const setAnswer = (v: string) =>
    setAnswers(prev => { const n = [...prev]; n[step] = v; return n; });

  const goNext = () => {
    if (step < ADV_TOTAL - 1) setStep(s => s + 1);
    else onSubmit(buildContextFromAdvanced(answers, lang));
  };

  const goSkip = () => {
    setAnswer("");
    if (step < ADV_TOTAL - 1) setStep(s => s + 1);
    else onSubmit(buildContextFromAdvanced(answers, lang));
  };

  const isLast = step === ADV_TOTAL - 1;

  return (
    <div className="flex flex-col gap-6">

      {/* Progress bar */}
      <div className="flex gap-1">
        {Array(ADV_TOTAL).fill(0).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-[2px] flex-1 rounded-full transition-all duration-300",
              i < step ? "bg-zinc-500" : i === step ? "bg-white" : "bg-zinc-800"
            )}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="flex flex-col gap-3">
        <p className="text-[9px] font-mono tracking-widest uppercase text-zinc-600">
          {t.ADV_STEP(step + 1, ADV_TOTAL)}
        </p>
        <p className="text-[15px] font-mono font-semibold text-white leading-snug">
          {t.ADV_Q[step]}
        </p>
        <input
          key={step}
          type="text"
          value={answers[step]}
          onChange={e => setAnswer(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); goNext(); } }}
          placeholder={t.ADV_PH[step]}
          autoFocus
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600 transition-colors font-mono"
        />
      </div>

      {/* Nav buttons */}
      <div className="flex items-center gap-2">
        {step > 0 ? (
          <button
            onClick={() => setStep(s => s - 1)}
            className="text-[10px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors px-2 py-2 shrink-0"
          >
            {t.ADV_BACK}
          </button>
        ) : (
          <div className="flex-shrink-0 w-12" />
        )}

        <button
          onClick={goSkip}
          className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors px-3 py-2 rounded-lg shrink-0"
        >
          {t.ADV_SKIP}
        </button>

        <button
          onClick={goNext}
          className={cn(
            "flex-1 text-xs font-mono font-semibold py-2.5 rounded-xl transition-all active:scale-[0.98]",
            isLast
              ? "bg-white text-black hover:bg-zinc-100"
              : "bg-zinc-900 border border-zinc-700 text-white hover:bg-zinc-800 hover:border-zinc-500"
          )}
        >
          {isLast ? t.ADV_START : t.ADV_NEXT}
        </button>
      </div>
    </div>
  );
}

// ── ContextSetup — full-screen setup view ────────────────────────────────────
export function ContextSetup({
  onContextReady,
  lang,
  onLangChange,
}: {
  onContextReady: (ctx: string) => void;
  lang: Lang;
  onLangChange: (l: Lang) => void;
}) {
  const t = CP[lang];
  const [mode, setMode] = useState<ContextMode>("quick");
  const [quickText, setQuickText] = useState("");

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-lg flex flex-col gap-6">

        {/* Brand header — name first, icon after (reads brand → sees symbol) */}
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-mono font-bold text-white tracking-[0.12em] uppercase">
                Closer Wizard
              </h1>
              <WizardIcon className="w-5 h-[18px] text-white opacity-80" />
            </div>
            <p className="text-[11px] font-mono text-zinc-500 tracking-[0.2em] uppercase">
              {t.SUBTITLE}
            </p>
          </div>
          {/* Language toggle */}
          <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/8 text-[9px] font-mono overflow-hidden mt-1">
            {(["es", "en"] as Lang[]).map(l => (
              <button
                key={l}
                onClick={() => onLangChange(l)}
                className={cn(
                  "px-3 py-1.5 rounded-full uppercase tracking-widest transition-all font-medium",
                  lang === l ? "bg-white text-black shadow" : "text-zinc-400 hover:text-white"
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/8" />

        {/* Functional section */}
        <div className="flex flex-col gap-5">
          <p className="text-[10px] font-mono tracking-[0.25em] uppercase text-zinc-400">
            {t.DEFINE}
          </p>

          {/* Mode toggle */}
          <div className="flex items-center bg-zinc-950 p-1 rounded-full border border-zinc-800 w-fit">
            <button
              onClick={() => setMode("quick")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono transition-all",
                mode === "quick" ? "bg-white text-black" : "text-zinc-300 hover:text-white"
              )}
            >
              <Zap className="w-3 h-3" />
              {t.QUICK}
            </button>
            <button
              onClick={() => setMode("advanced")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono transition-all",
                mode === "advanced" ? "bg-white text-black" : "text-zinc-300 hover:text-white"
              )}
            >
              <SlidersHorizontal className="w-3 h-3" />
              {t.ADVANCED}
            </button>
          </div>

          {/* Content */}
          {mode === "quick" ? (
            <div className="flex flex-col gap-3">
              <textarea
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                placeholder={t.PLACEHOLDER}
                rows={2}
                autoFocus
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono resize-none leading-relaxed"
              />
              <button
                onClick={() => onContextReady(quickText)}
                className="w-full bg-white text-black text-sm font-mono font-bold py-3.5 rounded-xl hover:bg-zinc-100 active:scale-[0.98] transition-all"
              >
                {t.START}
              </button>
            </div>
          ) : (
            <AdvancedForm onSubmit={onContextReady} lang={lang} />
          )}
        </div>

      </div>
    </div>
  );
}

// ── SessionBar types ─────────────────────────────────────────────────────────
type Momentum = "red" | "amber" | "green" | undefined;

const MOMENTUM_LABELS: Record<"es" | "en", Record<"red" | "amber" | "green", string>> = {
  es: { red: "TENSO", amber: "NEUTRO", green: "FAVORABLE" },
  en: { red: "TENSE", amber: "NEUTRAL", green: "FAVORABLE" },
};

// ── SessionBar — compact top bar during active session ───────────────────────
export function SessionBar({
  sessionContext,
  contextLabel,
  onClearSession,
  lang = "es",
  momentum,
}: {
  sessionContext: string;
  contextLabel?: string;
  onClearSession: () => void;
  lang?: Lang;
  momentum?: Momentum;
}) {
  const t = CP[lang];
  const [expanded, setExpanded] = useState(false);
  const displayLabel = contextLabel || sessionContext.split("\n")[0].slice(0, 70);

  return (
    <div className="border-b border-white/5 bg-black shrink-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0 pr-3">
          {/* Brand mark — subtle wizard icon as identity anchor */}
          <WizardIcon className="w-2.5 h-[11px] text-zinc-700 shrink-0" />
          <div className="w-px h-2.5 bg-zinc-800 shrink-0" />
          {/* Session indicator */}
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-500 shrink-0">
            {t.SESSION}
          </span>
          {!expanded && (
            <span className="text-[10px] font-mono text-zinc-400 truncate">
              — {displayLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Momentum indicator */}
          {momentum && (
            <div className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-mono tracking-widest uppercase transition-all duration-700",
              momentum === "green" && "border-green-800 text-green-400 bg-green-950/40",
              momentum === "amber" && "border-amber-800 text-amber-400 bg-amber-950/40",
              momentum === "red"   && "border-red-800 text-red-400 bg-red-950/40",
            )}>
              <div className={cn(
                "w-1 h-1 rounded-full",
                momentum === "green" && "bg-green-500",
                momentum === "amber" && "bg-amber-500",
                momentum === "red"   && "bg-red-500 animate-pulse",
              )} />
              <span>{MOMENTUM_LABELS[lang as "es" | "en"][momentum]}</span>
            </div>
          )}
          {/* End session button — larger hit area */}
          <button
            onClick={(e) => { e.stopPropagation(); onClearSession(); }}
            className="text-[10px] font-mono text-zinc-400 hover:text-red-400 px-3 py-2 rounded-lg hover:bg-red-950/25 transition-all"
          >
            {t.END}
          </button>
          {expanded
            ? <ChevronUp className="w-3 h-3 text-zinc-600" />
            : <ChevronDown className="w-3 h-3 text-zinc-600" />}
        </div>
      </div>

      {expanded && sessionContext && (
        <div className="px-4 pb-3 border-t border-white/5">
          <p className="text-[11px] font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap pt-2">
            {sessionContext}
          </p>
        </div>
      )}
    </div>
  );
}
