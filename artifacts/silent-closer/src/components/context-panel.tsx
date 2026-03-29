import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp, Zap, SlidersHorizontal, User, Users, Target, Briefcase, ShieldOff, FileText, Swords, Navigation, Headphones } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArenaRole } from "@/pages/arena";

type AppMode = "copilot" | "arena";

// ── Closer Wizard mark: cone + crossing lines + flat brim ────────────────────
// SVG mask approach: white cone polygon masked by two black diagonal lines that
// cross in the lower third — divides the cone into exactly 3 white polygons:
//   1. Upper triangle (main hat body)
//   2. Lower-left corner triangle
//   3. Lower-right corner triangle
// Flat rounded-rect brim below with a visible gap.
function WizardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <defs>
        <mask id="wiz-hat-mask">
          <polygon points="10,1.5 5.5,13 14.5,13" fill="white" />
          <line x1="7" y1="9" x2="14.5" y2="13" stroke="black" strokeWidth="1.2" />
          <line x1="13" y1="9" x2="5.5" y2="13" stroke="black" strokeWidth="1.2" />
        </mask>
      </defs>
      <polygon points="10,1.5 5.5,13 14.5,13" fill="currentColor" mask="url(#wiz-hat-mask)" />
      <rect x="1.5" y="14" width="17" height="2.5" rx="1.25" fill="currentColor" />
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
    ARENA_PH_SELLER: "Ej: quiero vender un piso en Dresden a un inversor muy analítico que duda de la ciudad",
    ARENA_PH_CLIENT: "Ej: soy un inversor analítico al que quieren venderle un piso en Dresden",
    SESSION:   "Sesión",
    END:       "Finalizar",
    SUBTITLE:  "Inteligencia táctica conversacional",
    // Advanced step-by-step
    ADV_NEXT:  "Siguiente →",
    ADV_START: "Iniciar copiloto →",
    ADV_SHORT_LABELS: ["Rol", "Quién", "Objetivo", "Oferta", "Frenos", "Notas"] as string[],
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
    MODE_COPILOT: "Copiloto",
    MODE_ARENA: "Arena",
    START_ARENA: "Entrar en Arena →",
    ARENA_ROLE_LABEL: "Tu rol en Arena",
    ARENA_SELLER: "Yo soy el vendedor",
    ARENA_CLIENT: "Yo soy el cliente",
    ARENA_SELLER_SHORT: "Vendedor",
    ARENA_CLIENT_SHORT: "Cliente",
    ARENA_HINT: "La IA jugará el otro rol",
  },
  en: {
    DEFINE:    "Set the context",
    QUICK:     "Quick",
    ADVANCED:  "Advanced",
    START:     "Start copilot →",
    PLACEHOLDER: "E.g: I want to sell an apartment in Berlin to a very analytical investor who doubts the city",
    ARENA_PH_SELLER: "E.g: I want to sell an apartment in Berlin to a very analytical investor who doubts the city",
    ARENA_PH_CLIENT: "E.g: I'm a very analytical investor being pitched an apartment in Berlin",
    SESSION:   "Session",
    END:       "End",
    SUBTITLE:  "Conversational tactical intelligence",
    ADV_NEXT:  "Next →",
    ADV_START: "Start copilot →",
    ADV_SHORT_LABELS: ["Role", "Who", "Goal", "Offer", "Blockers", "Notes"] as string[],
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
    MODE_COPILOT: "Copilot",
    MODE_ARENA: "Arena",
    START_ARENA: "Enter Arena →",
    ARENA_ROLE_LABEL: "Your role in Arena",
    ARENA_SELLER: "I am the seller",
    ARENA_CLIENT: "I am the client",
    ARENA_SELLER_SHORT: "Seller",
    ARENA_CLIENT_SHORT: "Client",
    ARENA_HINT: "The AI will play the other role",
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

const ADV_STEP_ICONS = [User, Users, Target, Briefcase, ShieldOff, FileText];

function AdvancedForm({ onSubmit, lang, ctaLabel }: { onSubmit: (context: string) => void; lang: Lang; ctaLabel?: string }) {
  const t = CP[lang];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(Array(ADV_TOTAL).fill(""));

  const setAnswer = (v: string) =>
    setAnswers(prev => { const n = [...prev]; n[step] = v; return n; });

  const goNext = () => {
    if (step < ADV_TOTAL - 1) setStep(s => s + 1);
    else onSubmit(buildContextFromAdvanced(answers, lang));
  };

  const goStart = () => onSubmit(buildContextFromAdvanced(answers, lang));

  const isLast = step === ADV_TOTAL - 1;

  return (
    <div className="flex flex-col gap-5">

      {/* Clickable stepper — icon + short label per step */}
      <div className="flex gap-1">
        {t.ADV_SHORT_LABELS.map((label, i) => {
          const Icon = ADV_STEP_ICONS[i];
          const isCurrent = i === step;
          const isFilled  = answers[i].trim().length > 0;
          return (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-2 px-0.5 rounded-lg transition-all",
                isCurrent
                  ? "bg-white/8 border border-white/12"
                  : "hover:bg-white/6 border border-transparent"
              )}
            >
              <Icon className={cn(
                "w-3 h-3 transition-colors",
                isCurrent ? "text-white" : isFilled ? "text-zinc-200" : "text-zinc-400"
              )} />
              <span className={cn(
                "text-[7px] font-mono tracking-wider uppercase w-full text-center transition-colors truncate",
                isCurrent ? "text-white" : isFilled ? "text-zinc-300" : "text-zinc-400"
              )}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active step — question + input */}
      <div className="flex flex-col gap-3">
        <p className="text-[14px] font-mono font-semibold text-white leading-snug">
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

      {/* Nav — only the launch CTA; step navigation via icon clicks or Enter */}
      <button
        onClick={goStart}
        className="w-full bg-white text-black text-xs font-mono font-semibold py-3 rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.98]"
      >
        {ctaLabel ?? t.ADV_START}
      </button>
    </div>
  );
}

// ── ContextSetup — full-screen setup view ────────────────────────────────────
export function ContextSetup({
  onContextReady,
  onArenaReady,
  lang,
  onLangChange,
}: {
  onContextReady: (ctx: string) => void;
  onArenaReady: (ctx: string, role: ArenaRole) => void;
  lang: Lang;
  onLangChange: (l: Lang) => void;
}) {
  const t = CP[lang];
  const [contextMode, setContextMode] = useState<ContextMode>("quick");
  const [appMode, setAppMode] = useState<AppMode>("copilot");
  const [arenaRole, setArenaRole] = useState<ArenaRole>("seller");
  const [quickText, setQuickText] = useState("");
  const quickRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea on mount so the user can type immediately
  useEffect(() => {
    const id = setTimeout(() => quickRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, []);

  const handleSetAppMode = (m: AppMode) => {
    setAppMode(m);
    if (m === "arena") setContextMode("quick"); // Advanced form has no meaning in Arena
  };

  const handleSubmit = (ctx: string) => {
    if (!ctx.trim()) return;
    if (appMode === "arena") {
      onArenaReady(ctx, arenaRole);
    } else {
      onContextReady(ctx);
    }
  };

  const ctaLabel = appMode === "arena" ? t.START_ARENA : t.START;

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center px-6 overflow-y-auto py-6">
      <div className="w-full max-w-lg flex flex-col gap-4">

        {/* ── Brand row ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <WizardIcon className="w-9 h-9 text-white shrink-0" />
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-mono font-bold text-white tracking-[0.12em] uppercase leading-none">
                Closer Wizard
              </h1>
              <p className="text-[10px] font-mono text-zinc-500 tracking-[0.2em] uppercase">
                {t.SUBTITLE}
              </p>
            </div>
          </div>
          <div className="flex items-center bg-white/5 p-1 rounded-full border border-white/8 text-[9px] font-mono overflow-hidden">
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

        {/* ── Controls row ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">

          {/* Mode pill — expands inline with role options when Arena is active */}
          <div className="flex items-center bg-zinc-950 p-1 rounded-full border border-zinc-800">
            <button
              onClick={() => handleSetAppMode("copilot")}
              onMouseDown={e => e.preventDefault()}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono transition-all",
                appMode === "copilot" ? "bg-white text-black" : "text-zinc-300 hover:text-white"
              )}
            >
              <Navigation className="w-3 h-3" />
              {t.MODE_COPILOT}
            </button>

            {appMode === "copilot" ? (
              /* Copilot active — show plain Arena option */
              <button
                onClick={() => handleSetAppMode("arena")}
                onMouseDown={e => e.preventDefault()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono transition-all text-zinc-300 hover:text-white"
              >
                <Swords className="w-3 h-3" />
                {t.MODE_ARENA}
              </button>
            ) : (
              /* Arena active — grouped role sub-options */
              <>
                <button
                  onClick={() => setArenaRole("seller")}
                  onMouseDown={e => e.preventDefault()}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-all",
                    arenaRole === "seller"
                      ? "bg-white text-black"
                      : "bg-zinc-800 text-zinc-300 hover:text-white"
                  )}
                >
                  <Headphones className="w-3 h-3" />
                  {t.ARENA_SELLER_SHORT}
                </button>
                <button
                  onClick={() => setArenaRole("client")}
                  onMouseDown={e => e.preventDefault()}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-all",
                    arenaRole === "client"
                      ? "bg-white text-black"
                      : "bg-zinc-800 text-zinc-300 hover:text-white"
                  )}
                >
                  <User className="w-3 h-3" />
                  {t.ARENA_CLIENT_SHORT}
                </button>
              </>
            )}
          </div>

          {/* Rápido/Avanzado only makes sense in Copilot mode */}
          {appMode === "copilot" && (
            <div className="flex items-center bg-zinc-950 p-1 rounded-full border border-zinc-800">
              <button
                onClick={() => setContextMode("quick")}
                onMouseDown={e => e.preventDefault()}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono transition-all",
                  contextMode === "quick" ? "bg-white text-black" : "text-zinc-300 hover:text-white"
                )}
              >
                <Zap className="w-3 h-3" />
                {t.QUICK}
              </button>
              <button
                onClick={() => setContextMode("advanced")}
                onMouseDown={e => e.preventDefault()}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono transition-all",
                  contextMode === "advanced" ? "bg-white text-black" : "text-zinc-300 hover:text-white"
                )}
              >
                <SlidersHorizontal className="w-3 h-3" />
                {t.ADVANCED}
              </button>
            </div>
          )}
        </div>

        {/* ── Context input ─────────────────────────────────────────────── */}
        {contextMode === "quick" && (
          <textarea
            ref={quickRef}
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (quickText.trim()) handleSubmit(quickText);
              }
            }}
            placeholder={
              appMode === "arena"
                ? (arenaRole === "client" ? t.ARENA_PH_CLIENT : t.ARENA_PH_SELLER)
                : t.PLACEHOLDER
            }
            rows={3}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono resize-none leading-relaxed"
          />
        )}

        {/* Advanced form */}
        {contextMode === "advanced" && (
          <AdvancedForm onSubmit={handleSubmit} lang={lang} ctaLabel={ctaLabel} />
        )}

        {/* ── CTA (quick mode) ──────────────────────────────────────────── */}
        {contextMode === "quick" && (
          <button
            onClick={() => handleSubmit(quickText)}
            disabled={appMode === "arena" && !quickText.trim()}
            className="w-full bg-white text-black text-sm font-mono font-bold py-3.5 rounded-xl hover:bg-zinc-100 active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {ctaLabel}
          </button>
        )}

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
  endLabel,
}: {
  sessionContext: string;
  contextLabel?: string;
  onClearSession: () => void;
  lang?: Lang;
  momentum?: Momentum;
  endLabel?: string;
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
          {/* Brand mark — icon + wordmark as persistent identity anchor */}
          <WizardIcon className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
          <span className="text-[8px] font-mono tracking-[0.25em] uppercase text-zinc-400 shrink-0">
            Closer Wizard
          </span>
          <div className="w-px h-2.5 bg-zinc-800 shrink-0" />
          {/* Session indicator */}
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-300 shrink-0">
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
            {endLabel ?? t.END}
          </button>
          {expanded
            ? <ChevronUp className="w-3 h-3 text-zinc-400" />
            : <ChevronDown className="w-3 h-3 text-zinc-400" />}
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
