import { useState, useRef, useEffect, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Zap, SlidersHorizontal, User, Users, Target, Briefcase, ShieldOff, FileText, Swords, Navigation, Headphones, Shuffle, X, Package, Building, Lightbulb, MessageSquare, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import type { ArenaRole } from "@/pages/arena";

export interface ArenaConfig {
  clientProfile?: string;
  sellerProfile?: string;
  difficulty?: string;
  forceTerminal?: boolean;
}

export type AppMode = "copilot" | "arena";

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
    START:     "Iniciar copiloto",
    PLACEHOLDER: "Ej: quiero vender un piso en Dresden a un inversor muy analítico que duda de la ciudad",
    ARENA_PH_SELLER: "Ej: quiero vender un piso en Dresden a un inversor muy analítico que duda de la ciudad",
    ARENA_PH_CLIENT: "Ej: soy un inversor analítico al que quieren venderle un piso en Dresden",
    SESSION:   "Sesión",
    END:       "Finalizar",
    SUBTITLE:  "Inteligencia táctica conversacional",
    // Advanced step-by-step
    ADV_NEXT:  "Siguiente",
    ADV_START: "Iniciar copiloto",
    ADV_SHORT_LABELS: ["Oferta", "Quién", "Objetivo", "Frenos", "Rol", "Notas"] as string[],
    ADV_Q: [
      "¿Qué estás vendiendo o proponiendo?",
      "¿Con quién estás hablando?",
      "¿Qué quieres conseguir?",
      "¿Cuáles son los posibles frenos u objeciones?",
      "¿Quién eres tú en esta conversación?",
      "¿Algo más que deba saber?",
    ] as string[],
    ADV_PH: [
      "un inmueble, una propuesta, un software, un acuerdo…",
      "cliente, inversor, jefe, socio, decisor…",
      "cerrar, convencer, avanzar, negociar, acordar…",
      "precio, timing, desconfianza, comparación con otra opción…",
      "asesor, comercial, inversor, fundador…",
      "matices, contexto extra, situación especial… (opcional)",
    ] as string[],
    ADV_LABELS: [
      "Qué vendes", "Con quién", "Objetivo", "Posibles frenos", "Tu rol", "Notas",
    ] as string[],
    MODE_COPILOT: "Copiloto",
    MODE_ARENA: "Arena",
    START_ARENA: "Entrar en Arena",
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
    START:     "Start copilot",
    PLACEHOLDER: "E.g: I want to sell an apartment in Berlin to a very analytical investor who doubts the city",
    ARENA_PH_SELLER: "E.g: I want to sell an apartment in Berlin to a very analytical investor who doubts the city",
    ARENA_PH_CLIENT: "E.g: I'm a very analytical investor being pitched an apartment in Berlin",
    SESSION:   "Session",
    END:       "End",
    SUBTITLE:  "Conversational tactical intelligence",
    ADV_NEXT:  "Next",
    ADV_START: "Start copilot",
    ADV_SHORT_LABELS: ["Offer", "Who", "Goal", "Blockers", "Role", "Notes"] as string[],
    ADV_Q: [
      "What are you selling or proposing?",
      "Who are you talking to?",
      "What do you want to achieve?",
      "What are the likely objections or blockers?",
      "Who are you in this conversation?",
      "Anything else I should know?",
    ] as string[],
    ADV_PH: [
      "a property, a proposal, a software, a deal…",
      "client, investor, manager, partner, decision-maker…",
      "close, convince, advance, negotiate, agree…",
      "price, timing, distrust, comparison with another option…",
      "advisor, sales rep, investor, founder…",
      "extra context, special situation, nuances… (optional)",
    ] as string[],
    ADV_LABELS: [
      "What you're selling", "Who you're talking to", "Goal", "Possible objections", "Your role", "Notes",
    ] as string[],
    MODE_COPILOT: "Copilot",
    MODE_ARENA: "Arena",
    START_ARENA: "Enter Arena",
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

// ── Arena profiles & difficulty ──────────────────────────────────────────────
const REAL_PROFILES = ["analytical", "emotional", "skeptical", "cautious", "dominant", "indecisive", "negotiator"];

const CLIENT_PROFILES = {
  es: [
    { id: "random",      label: "Aleatorio" },
    { id: "analytical",  label: "Analítico" },
    { id: "emotional",   label: "Emocional" },
    { id: "skeptical",   label: "Escéptico" },
    { id: "cautious",    label: "Cauto" },
    { id: "dominant",    label: "Dominante" },
    { id: "indecisive",  label: "Indeciso" },
    { id: "negotiator",  label: "Negociador" },
  ],
  en: [
    { id: "random",      label: "Random" },
    { id: "analytical",  label: "Analytical" },
    { id: "emotional",   label: "Emotional" },
    { id: "skeptical",   label: "Skeptical" },
    { id: "cautious",    label: "Cautious" },
    { id: "dominant",    label: "Dominant" },
    { id: "indecisive",  label: "Indecisive" },
    { id: "negotiator",  label: "Negotiator" },
  ],
};

const SELLER_PROFILES = {
  es: [
    { id: "communicative", label: "Comunicativo" },
    { id: "authoritative", label: "Autoritario" },
    { id: "technical",     label: "Técnico" },
    { id: "passive",       label: "Pasivo" },
    { id: "aggressive",    label: "Agresivo" },
    { id: "consultive",    label: "Consultivo" },
  ],
  en: [
    { id: "communicative", label: "Communicative" },
    { id: "authoritative", label: "Authoritative" },
    { id: "technical",     label: "Technical" },
    { id: "passive",       label: "Passive" },
    { id: "aggressive",    label: "Aggressive" },
    { id: "consultive",    label: "Consultive" },
  ],
};

const DIFFICULTY_LEVELS = {
  es: [
    { id: "easy",   label: "Fácil" },
    { id: "normal", label: "Normal" },
    { id: "hard",   label: "Difícil" },
    { id: "brutal", label: "Brutal" },
  ],
  en: [
    { id: "easy",   label: "Easy" },
    { id: "normal", label: "Normal" },
    { id: "hard",   label: "Hard" },
    { id: "brutal", label: "Brutal" },
  ],
};

const RANDOM_CONTEXTS = {
  seller: {
    es: [
      "Vendo software de gestión de proyectos a una empresa de construcción mediana que sigue usando hojas de Excel.",
      "Ofrezco servicios de consultoría de marketing digital a un restaurante local que quiere crecer online.",
      "Presento una solución de ciberseguridad a un despacho de abogados que acaba de sufrir un ciberataque menor.",
      "Vendo seguros de vida a un emprendedor de 35 años, casado y con dos hijos pequeños.",
      "Propongo un sistema de automatización de almacén a un distribuidor de alimentación que tiene problemas de errores en pedidos.",
      "Ofrezco formación corporativa en ventas a una empresa de telecomunicaciones con resultados mediocres este año.",
      "Vendo una plataforma de recursos humanos a una empresa de 80 personas que gestiona todo con email y papel.",
      "Propongo servicios de contabilidad online a una startup tecnológica que lleva 2 años funcionando.",
      "Vendo un CRM a una inmobiliaria que tiene 12 agentes y ningún sistema de seguimiento de clientes.",
      "Ofrezco servicios de diseño web y posicionamiento SEO a una clínica dental que no aparece en Google.",
    ],
    en: [
      "I'm selling project management software to a mid-size construction firm still using spreadsheets.",
      "I'm offering digital marketing consulting to a local restaurant that wants to grow online.",
      "I'm presenting a cybersecurity solution to a law firm that recently had a minor data breach.",
      "I'm selling life insurance to a 35-year-old entrepreneur with a young family.",
      "I'm proposing warehouse automation to a food distributor struggling with order errors.",
      "I'm selling sales training services to a telecom company with weak results this year.",
      "I'm offering an HR platform to an 80-person company managing everything via email.",
      "I'm selling accounting software to a 2-year-old tech startup.",
      "I'm selling a CRM to a real estate agency with 12 agents and no tracking system.",
      "I'm offering web design and SEO to a dental clinic that doesn't appear in Google.",
    ],
  },
  client: {
    es: [
      "Soy el director financiero de una empresa de 60 personas. Me llaman para venderme un software de contabilidad que ya tienen varios empleados pidiendo.",
      "Soy el dueño de una cafetería con 3 locales. Me contactan para ofrecerme publicidad en una revista del sector.",
      "Soy el responsable de compras de una empresa industrial. Un proveedor quiere que cambie a su solución de mantenimiento.",
      "Soy un inversor privado. Me presentan una oportunidad de invertir en una startup de tecnología educativa.",
      "Soy el director de RRHH de una empresa de 200 personas. Me proponen un nuevo sistema de selección de personal.",
      "Soy el gerente de una clínica privada. Me ofrecen una plataforma de gestión de citas y pacientes.",
    ],
    en: [
      "I'm the CFO of a 60-person company. I'm being called to buy accounting software that several employees have been requesting.",
      "I own a coffee chain with 3 locations. I'm being offered advertising in an industry magazine.",
      "I'm the purchasing manager at an industrial firm. A supplier wants me to switch to their maintenance solution.",
      "I'm a private investor being pitched an edtech startup opportunity.",
      "I'm the HR Director of a 200-person company being pitched a new recruitment platform.",
      "I'm the manager of a private clinic being offered a patient management system.",
    ],
  },
};

function pickRandomContext(role: ArenaRole, lang: Lang): string {
  const pool = RANDOM_CONTEXTS[role][lang];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Arena Advanced Form ───────────────────────────────────────────────────────
const ARENA_ADV_ICONS_SELLER = [Package, Building, Lightbulb, ShieldOff];
const ARENA_ADV_ICONS_CLIENT = [User, Briefcase, MessageSquare];

function ArenaAdvancedForm({
  role,
  lang,
  onSubmit,
  children,
}: {
  role: ArenaRole;
  lang: Lang;
  onSubmit: (ctx: string) => void;
  children?: ReactNode;
}) {
  const isSeller = role === "seller";

  const questions = isSeller
    ? (lang === "es"
        ? ["¿Qué estás vendiendo?", "¿A quién o qué empresa?", "¿Cuál es tu principal argumento de valor?", "¿Posibles objeciones o frenos?"]
        : ["What are you selling?", "Who or what company?", "What is your main value argument?", "Possible objections or blockers?"])
    : (lang === "es"
        ? ["¿Qué te están vendiendo?", "¿Cuál es tu rol o empresa?", "¿Cuál es tu principal duda o preocupación?"]
        : ["What are they selling you?", "What's your role or company?", "What's your main doubt or concern?"]);

  const placeholders = isSeller
    ? (lang === "es"
        ? ["software de CRM, seguro de vida, servicio de limpieza…", "director de ventas, pyme de 50 personas, startup…", "ahorra un 30% en costes operativos…", "precio, ya tienen proveedor, no es el momento…"]
        : ["CRM software, life insurance, cleaning service…", "sales director, 50-person SME, startup…", "saves 30% in operational costs…", "price, already have a provider, bad timing…"])
    : (lang === "es"
        ? ["un CRM, un seguro de empresa, consultoría…", "director financiero, responsable de compras…", "precio demasiado alto, no estoy convencido de necesitarlo…"]
        : ["a CRM, business insurance, consulting…", "CFO, purchasing manager…", "price too high, not convinced I need it…"]);

  const labels = isSeller
    ? (lang === "es"
        ? ["Producto", "A quién", "Valor", "Objeciones"]
        : ["Product", "To whom", "Value", "Objections"])
    : (lang === "es"
        ? ["Qué venden", "Mi rol", "Mi duda"]
        : ["What's sold", "My role", "My doubt"]);

  const icons = isSeller ? ARENA_ADV_ICONS_SELLER : ARENA_ADV_ICONS_CLIENT;

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => Array(questions.length).fill(""));

  // Reset when role changes (question count changes)
  useEffect(() => {
    setStep(0);
    setAnswers(Array(questions.length).fill(""));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const setAnswer = (v: string) =>
    setAnswers(prev => { const n = [...prev]; n[step] = v; return n; });

  const buildCtx = (ans: string[]) => {
    return ans
      .map((v, i) => v.trim() ? `${labels[i]}: ${v.trim()}` : null)
      .filter(Boolean)
      .join("\n");
  };

  const goNext = () => {
    if (step < questions.length - 1) setStep(s => s + 1);
    else onSubmit(buildCtx(answers));
  };

  const ctaLabel = lang === "es" ? "Entrar en Arena" : "Enter Arena";

  return (
    <div className="flex flex-col gap-5">
      {/* Step icons */}
      <div className="flex gap-1">
        {labels.map((label, i) => {
          const Icon = icons[i];
          const isCurrent = i === step;
          const isFilled = (answers[i] ?? "").trim().length > 0;
          return (
            <button
              key={i}
              onClick={() => setStep(i)}
              onMouseDown={e => e.preventDefault()}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-2 px-0.5 rounded-lg transition-all",
                isCurrent ? "bg-white/8 border border-white/12" : "hover:bg-white/6 border border-transparent"
              )}
            >
              <Icon className={cn("w-3 h-3 transition-colors", isCurrent ? "text-white" : isFilled ? "text-zinc-200" : "text-zinc-400")} />
              <span className={cn("text-[7px] font-mono tracking-wider uppercase w-full text-center transition-colors truncate",
                isCurrent ? "text-white" : isFilled ? "text-zinc-300" : "text-zinc-400"
              )}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active question */}
      <div className="flex flex-col gap-3">
        <p className="text-[14px] font-mono font-semibold text-white leading-snug">
          {questions[step]}
        </p>
        <input
          key={step}
          type="text"
          value={answers[step]}
          onChange={e => setAnswer(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); goNext(); } }}
          placeholder={placeholders[step]}
          autoFocus
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono"
        />
      </div>

      {children}

      <button
        onClick={() => onSubmit(buildCtx(answers))}
        className="w-full bg-white text-black text-xs font-mono font-semibold py-3 rounded-xl hover:bg-zinc-100 transition-all active:scale-[0.98]"
      >
        {ctaLabel}
      </button>
    </div>
  );
}

// ── Step-by-step Advanced form ───────────────────────────────────────────────
const ADV_TOTAL = 6;

const ADV_STEP_ICONS = [Package, Users, Target, ShieldOff, User, FileText];

function AdvancedForm({ onSubmit, lang, ctaLabel, children }: { onSubmit: (context: string) => void; lang: Lang; ctaLabel?: string; children?: ReactNode }) {
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
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono"
        />
      </div>

      {children}

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

// ── Reusable Arena profile + difficulty picker ────────────────────────────────
function ArenaProfilePicker({
  arenaRole, lang,
  clientProfile, setClientProfile,
  sellerProfile, setSellerProfile,
  difficulty, setDifficulty,
}: {
  arenaRole: ArenaRole; lang: Lang;
  clientProfile: string | undefined; setClientProfile: (v: string | undefined) => void;
  sellerProfile: string | undefined; setSellerProfile: (v: string | undefined) => void;
  difficulty: string; setDifficulty: (v: string) => void;
}) {
  const clientItems = CLIENT_PROFILES[lang];
  const sellerItems = SELLER_PROFILES[lang];
  const diffItems = DIFFICULTY_LEVELS[lang];

  const chipBase = "font-mono transition-all border text-[9px]";
  const toggleChip = (active: boolean) => cn(chipBase, "px-2 py-0.5 rounded-full",
    active ? "bg-sky-500/20 border-sky-500/60 text-sky-300" : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
  );
  const toggleTeal = (active: boolean) => cn(chipBase, "px-2 py-0.5 rounded-full",
    active ? "bg-teal-500/20 border-teal-500/60 text-teal-300" : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
  );
  const diffChip = (active: boolean) => cn(chipBase, "flex-1 py-1 rounded-full",
    active ? "bg-amber-500/20 border-amber-500/60 text-amber-300" : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
  );
  const label9 = "text-[9px] font-mono text-zinc-500 uppercase tracking-[0.2em]";

  return (
    <div className="flex flex-col gap-3">
      {arenaRole === "seller" && (
        <>
          <div className="flex flex-col gap-1.5">
            <p className={label9}>{lang === "es" ? "Perfil del cliente IA" : "AI client profile"}</p>
            <div className="flex flex-wrap gap-1.5">
              {clientItems.map(p => (
                <button key={p.id} onMouseDown={e => e.preventDefault()}
                  onClick={() => setClientProfile(clientProfile === p.id ? undefined : p.id)}
                  className={toggleChip(clientProfile === p.id)}>{p.label}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className={label9}>{lang === "es" ? "Dificultad" : "Difficulty"}</p>
            <div className="flex gap-1.5">
              {diffItems.map(d => (
                <button key={d.id} onMouseDown={e => e.preventDefault()}
                  onClick={() => setDifficulty(d.id)}
                  className={diffChip(difficulty === d.id)}>{d.label}</button>
              ))}
            </div>
          </div>
        </>
      )}
      {arenaRole === "client" && (
        <div className="flex flex-col gap-1.5">
          <p className={label9}>{lang === "es" ? "Perfil del vendedor IA" : "AI seller profile"}</p>
          <div className="flex flex-wrap gap-1.5">
            {sellerItems.map(p => (
              <button key={p.id} onMouseDown={e => e.preventDefault()}
                onClick={() => setSellerProfile(sellerProfile === p.id ? undefined : p.id)}
                className={toggleTeal(sellerProfile === p.id)}>{p.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Copilot client-profile picker (no random, no difficulty) ─────────────────
function CopilotClientPicker({
  lang,
  value,
  onChange,
}: { lang: Lang; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const items = CLIENT_PROFILES[lang].filter(p => p.id !== "random");
  const chipBase = "font-mono transition-all border text-[9px] px-2 py-0.5 rounded-full";
  const chip = (active: boolean) => cn(chipBase,
    active
      ? "bg-sky-500/20 border-sky-500/60 text-sky-300"
      : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
  );
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.2em]">
        {lang === "es" ? "Perfil estimado del cliente" : "Estimated client profile"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map(p => (
          <button
            key={p.id}
            onMouseDown={e => e.preventDefault()}
            onClick={() => onChange(value === p.id ? undefined : p.id)}
            className={chip(value === p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value && (
        <p className="text-[8px] font-mono text-zinc-600 leading-snug">
          {lang === "es"
            ? "La IA usará este perfil como referencia inicial. Si la conversación revela algo distinto, las sugerencias se adaptan solas."
            : "The AI will use this as an initial reference. If the conversation reveals a different profile, suggestions adapt automatically."}
        </p>
      )}
    </div>
  );
}

// ── ContextSetup — full-screen setup view ────────────────────────────────────
export function ContextSetup({
  onContextReady,
  onArenaReady,
  lang,
  onLangChange,
  initialMode,
  initialRole,
}: {
  onContextReady: (ctx: string) => void;
  onArenaReady: (ctx: string, role: ArenaRole, config: ArenaConfig) => void;
  lang: Lang;
  onLangChange: (l: Lang) => void;
  initialMode?: AppMode;
  initialRole?: ArenaRole;
}) {
  const t = CP[lang];
  const { theme, toggleTheme } = useTheme();
  const [contextMode, setContextMode] = useState<ContextMode>("quick");
  const [appMode, setAppMode] = useState<AppMode>(initialMode ?? "copilot");
  const [arenaRole, setArenaRole] = useState<ArenaRole>(initialRole ?? "seller");
  const [quickText, setQuickText] = useState("");
  const [isRandomCtx, setIsRandomCtx] = useState(false);

  // Arena profile/difficulty state
  const [clientProfile, setClientProfile] = useState<string | undefined>("random");
  const [sellerProfile, setSellerProfile] = useState<string | undefined>(undefined);
  const [difficulty, setDifficulty] = useState<string>("normal");
  const [showAdvancedOpts, setShowAdvancedOpts] = useState(
    () => localStorage.getItem("arena_opts_open") === "1"
  );

  // Copilot client-profile hint
  const [copilotClientProfile, setCopilotClientProfile] = useState<string | undefined>(undefined);
  const [showCopilotOpts, setShowCopilotOpts] = useState(false);

  const quickRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea on mount and whenever quick mode is activated
  useEffect(() => {
    if (contextMode !== "quick") return;
    const id = setTimeout(() => quickRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, [contextMode]);

  const handleSetAppMode = (m: AppMode) => {
    setAppMode(m);
  };

  const handleSubmit = (ctx: string) => {
    if (appMode === "arena" && !ctx.trim()) return;
    if (appMode === "arena") {
      if (arenaRole === "seller") {
        // Seller mode: user sells, AI plays the client → clientProfile + difficulty matter
        const isRandom = clientProfile === "random" || clientProfile === undefined;
        const resolvedProfile = isRandom
          ? REAL_PROFILES[Math.floor(Math.random() * REAL_PROFILES.length)]
          : clientProfile;
        onArenaReady(ctx, arenaRole, {
          clientProfile: resolvedProfile,
          difficulty,
          forceTerminal: isRandom,
        });
      } else {
        // Client mode: user IS the client, AI plays the seller → only sellerProfile matters
        onArenaReady(ctx, arenaRole, {
          sellerProfile,
        });
      }
    } else {
      // Copilot: optionally append client-profile hint so the AI has it from the start
      let finalCtx = ctx;
      if (copilotClientProfile) {
        const profileLabel = CLIENT_PROFILES[lang].find(p => p.id === copilotClientProfile)?.label ?? copilotClientProfile;
        finalCtx += lang === "es"
          ? `\n\n[Perfil estimado del cliente: ${profileLabel}. Usa esto como referencia inicial en tus sugerencias, con flexibilidad si la conversación revela señales distintas.]`
          : `\n\n[Estimated client profile: ${profileLabel}. Use this as an initial reference in your suggestions, staying flexible if the conversation reveals different signals.]`;
      }
      onContextReady(finalCtx);
    }
  };

  const handleRandomContext = () => {
    const ctx = pickRandomContext(arenaRole, lang);
    setQuickText(ctx);
    setIsRandomCtx(true);
    setTimeout(() => quickRef.current?.focus(), 50);
  };

  const handleRoleSwitch = (newRole: ArenaRole) => {
    setArenaRole(newRole);
    if (isRandomCtx) {
      setQuickText(pickRandomContext(newRole, lang));
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
          <div className="flex items-center gap-2">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              onMouseDown={e => e.preventDefault()}
              title={theme === "dark" ? "Tema claro" : "Tema oscuro"}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 border border-white/8 text-zinc-400 hover:text-white transition-colors"
            >
              {theme === "dark"
                ? <Sun className="w-3.5 h-3.5" />
                : <Moon className="w-3.5 h-3.5" />}
            </button>
            {/* Language toggle */}
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
        </div>

        {/* Divider */}
        <div className="border-t border-white/8" />

        {/* ── Controls row ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">

          {/* Mode pill */}
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
              <button
                onClick={() => handleSetAppMode("arena")}
                onMouseDown={e => e.preventDefault()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono transition-all text-zinc-300 hover:text-white"
              >
                <Swords className="w-3 h-3" />
                {t.MODE_ARENA}
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleRoleSwitch("seller")}
                  onMouseDown={e => e.preventDefault()}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-all",
                    arenaRole === "seller" ? "bg-white text-black" : "bg-zinc-800 text-zinc-300 hover:text-white"
                  )}
                >
                  <Headphones className="w-3 h-3" />
                  {t.ARENA_SELLER_SHORT}
                </button>
                <button
                  onClick={() => handleRoleSwitch("client")}
                  onMouseDown={e => e.preventDefault()}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-all",
                    arenaRole === "client" ? "bg-white text-black" : "bg-zinc-800 text-zinc-300 hover:text-white"
                  )}
                >
                  <User className="w-3 h-3" />
                  {t.ARENA_CLIENT_SHORT}
                </button>
              </>
            )}
          </div>

          {/* Rápido/Avanzado — both modes */}
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
        </div>

        {/* ── Quick mode ────────────────────────────────────────────────── */}
        {contextMode === "quick" && (
          <>
            {/* Context textarea + random button */}
            <div className="relative">
              <textarea
                ref={quickRef}
                value={quickText}
                onChange={(e) => { setQuickText(e.target.value); setIsRandomCtx(false); }}
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
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors font-mono resize-none leading-relaxed"
              />
              {/* Shuffle (Arena only) + Clear (whenever there's text) */}
              <div className="absolute top-2 right-2 flex flex-col gap-0.5">
                {appMode === "arena" && (
                  <button
                    onClick={handleRandomContext}
                    onMouseDown={e => e.preventDefault()}
                    title={lang === "es" ? "Contexto aleatorio" : "Random context"}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/8 transition-all"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </button>
                )}
                {quickText && (
                  <button
                    onClick={() => { setQuickText(""); setIsRandomCtx(false); quickRef.current?.focus(); }}
                    onMouseDown={e => e.preventDefault()}
                    title={lang === "es" ? "Borrar texto" : "Clear text"}
                    className="p-1.5 rounded-lg text-zinc-600 hover:text-white hover:bg-white/8 transition-all"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* ── Copilot-only: client profile hint (collapsible) ── */}
            {appMode === "copilot" && (
              <div className="flex flex-col gap-2">
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => setShowCopilotOpts(v => !v)}
                  className="self-start flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showCopilotOpts
                    ? <><ChevronUp className="w-3 h-3" />{lang === "es" ? "Ocultar" : "Hide"}</>
                    : <><ChevronDown className="w-3 h-3" />{lang === "es" ? "Opciones" : "Options"}</>
                  }
                </button>
                {showCopilotOpts && (
                  <CopilotClientPicker
                    lang={lang}
                    value={copilotClientProfile}
                    onChange={setCopilotClientProfile}
                  />
                )}
              </div>
            )}

            {/* ── Arena-only: profile + difficulty chips (collapsible) ── */}
            {appMode === "arena" && (
              <div className="flex flex-col gap-2">
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => setShowAdvancedOpts(v => {
                    const next = !v;
                    localStorage.setItem("arena_opts_open", next ? "1" : "0");
                    return next;
                  })}
                  className="self-start flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showAdvancedOpts
                    ? <><ChevronUp className="w-3 h-3" />{lang === "es" ? "Ocultar" : "Hide"}</>
                    : <><ChevronDown className="w-3 h-3" />{lang === "es" ? "Opciones" : "Options"}</>
                  }
                </button>
                {showAdvancedOpts && (
                  <ArenaProfilePicker
                    arenaRole={arenaRole} lang={lang}
                    clientProfile={clientProfile} setClientProfile={setClientProfile}
                    sellerProfile={sellerProfile} setSellerProfile={setSellerProfile}
                    difficulty={difficulty} setDifficulty={setDifficulty}
                  />
                )}
              </div>
            )}

            {/* CTA */}
            <button
              onClick={() => handleSubmit(quickText)}
              disabled={appMode === "arena" && !quickText.trim()}
              className="w-full bg-white text-black text-sm font-mono font-bold py-3.5 rounded-xl hover:bg-zinc-100 active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              {ctaLabel}
            </button>
          </>
        )}

        {/* ── Advanced form — Copilot ──────────────────────────────────── */}
        {contextMode === "advanced" && appMode === "copilot" && (
          <AdvancedForm onSubmit={handleSubmit} lang={lang} ctaLabel={ctaLabel}>
            <CopilotClientPicker
              lang={lang}
              value={copilotClientProfile}
              onChange={setCopilotClientProfile}
            />
          </AdvancedForm>
        )}

        {/* ── Advanced form — Arena ────────────────────────────────────── */}
        {contextMode === "advanced" && appMode === "arena" && (
          <ArenaAdvancedForm role={arenaRole} lang={lang} onSubmit={handleSubmit}>
            <ArenaProfilePicker
              arenaRole={arenaRole} lang={lang}
              clientProfile={clientProfile} setClientProfile={setClientProfile}
              sellerProfile={sellerProfile} setSellerProfile={setSellerProfile}
              difficulty={difficulty} setDifficulty={setDifficulty}
            />
          </ArenaAdvancedForm>
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
  const { theme, toggleTheme } = useTheme();
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
              momentum === "green" && "border-teal-800 text-teal-400 bg-teal-950/40",
              momentum === "amber" && "border-amber-800 text-amber-400 bg-amber-950/40",
              momentum === "red"   && "border-orange-800 text-orange-400 bg-orange-950/40",
            )}>
              <div className={cn(
                "w-1 h-1 rounded-full",
                momentum === "green" && "bg-teal-400",
                momentum === "amber" && "bg-amber-500",
                momentum === "red"   && "bg-orange-400 animate-pulse",
              )} />
              <span>{MOMENTUM_LABELS[lang as "es" | "en"][momentum]}</span>
            </div>
          )}
          {/* Theme toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleTheme(); }}
            onMouseDown={e => e.preventDefault()}
            title={theme === "dark" ? "Tema claro" : "Tema oscuro"}
            className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {theme === "dark"
              ? <Sun className="w-3 h-3" />
              : <Moon className="w-3 h-3" />}
          </button>
          {/* End session button — larger hit area */}
          <button
            onClick={(e) => { e.stopPropagation(); onClearSession(); }}
            className="text-[10px] font-mono text-zinc-400 hover:text-orange-400 px-3 py-2 rounded-lg hover:bg-orange-950/25 transition-all"
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
