import { useState } from "react";
import { ChevronDown, ChevronUp, Zap, AlignLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Closer Wizard icon: pointed hat + 8-arm sparkle ─────────────────────────
function WizardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 26" fill="currentColor" className={className} aria-hidden>
      {/* Hat cone — clear pointed silhouette */}
      <path d="M12 1L20 18H4L12 1Z" />
      {/* Hat band — subtle accent */}
      <rect x="4" y="18" width="16" height="1.5" opacity="0.25" />
      {/* Brim — distinctly wider than cone */}
      <rect x="0.5" y="19.5" width="23" height="4" rx="2" />
      {/* 8-arm sparkle — floats upper-right outside the cone */}
      <g stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.92">
        <line x1="19" y1="1.5" x2="19" y2="7.5" />
        <line x1="16" y1="4.5" x2="22" y2="4.5" />
        <line x1="16.9" y1="2.4" x2="21.1" y2="6.6" />
        <line x1="21.1" y1="2.4" x2="16.9" y2="6.6" />
      </g>
    </svg>
  );
}

export { WizardIcon };

type Lang = "es" | "en";
type ContextMode = "quick" | "guided";

type ConversationType =
  | "general"
  | "personal"
  | "negotiation"
  | "sale"
  | "videocall"
  | "realestate"
  | "objections";

const CONVERSATION_TYPES_MAP: Record<Lang, { value: ConversationType; label: string }[]> = {
  es: [
    { value: "general",     label: "General" },
    { value: "personal",    label: "Personal" },
    { value: "negotiation", label: "Negociación" },
    { value: "sale",        label: "Venta" },
    { value: "videocall",   label: "Videollamada" },
    { value: "realestate",  label: "Inmobiliaria" },
    { value: "objections",  label: "Objeciones" },
  ],
  en: [
    { value: "general",     label: "General" },
    { value: "personal",    label: "Personal" },
    { value: "negotiation", label: "Negotiation" },
    { value: "sale",        label: "Sale" },
    { value: "videocall",   label: "Video call" },
    { value: "realestate",  label: "Real estate" },
    { value: "objections",  label: "Objections" },
  ],
};

const CP = {
  es: {
    DEFINE:      "Define el contexto",
    QUICK:       "Rápido",
    GUIDED:      "Guiado",
    START:       "Iniciar copiloto →",
    SKIP:        "Continuar sin contexto",
    PLACEHOLDER: "Ej: quiero vender un piso en Dresden a un inversor muy analítico que duda de la ciudad",
    SESSION:     "Sesión",
    END:         "Finalizar",
    SUBTITLE:    "Inteligencia táctica conversacional",
    FIELD_WHO:   "Con quién hablo",
    FIELD_GOAL:  "Qué quiero conseguir",
    FIELD_FEAR:  "Qué me preocupa",
    PH_WHO:      "cliente, jefe, inversor…",
    PH_GOAL:     "cerrar, convencer, acordar…",
    PH_FEAR:     "que diga que es caro…",
    FIELD_PROP:  "Inmueble",
    FIELD_PRICE: "Precio",
    FIELD_OBJ:   "Objetivo",
    FIELD_OBJS:  "Objeciones esperadas",
    PH_PROP:     "3 hab, 85m², Atocha…",
    PH_PRICE:    "420.000€",
    PH_OBJ:      "cerrar reserva, 2ª visita…",
    PH_OBJS:     "precio, comparar, miedo…",
  },
  en: {
    DEFINE:      "Set the context",
    QUICK:       "Quick",
    GUIDED:      "Guided",
    START:       "Start copilot →",
    SKIP:        "Continue without context",
    PLACEHOLDER: "E.g: I want to sell an apartment in Berlin to a very analytical investor who doubts the city",
    SESSION:     "Session",
    END:         "End",
    SUBTITLE:    "Conversational tactical intelligence",
    FIELD_WHO:   "Who I'm talking to",
    FIELD_GOAL:  "What I want to achieve",
    FIELD_FEAR:  "What I'm worried about",
    PH_WHO:      "client, boss, investor…",
    PH_GOAL:     "close, convince, agree…",
    PH_FEAR:     "they say it's too expensive…",
    FIELD_PROP:  "Property",
    FIELD_PRICE: "Price",
    FIELD_OBJ:   "Objective",
    FIELD_OBJS:  "Expected objections",
    PH_PROP:     "3 bed, 85m², city center…",
    PH_PRICE:    "$420,000",
    PH_OBJ:      "close reservation, 2nd visit…",
    PH_OBJS:     "price, comparing, fear…",
  },
};

function buildContextFromGuided(
  type: ConversationType,
  fields: Record<string, string>,
  lang: Lang,
): string {
  const types = CONVERSATION_TYPES_MAP[lang];
  const typeName = types.find((t) => t.value === type)?.label ?? type;
  const label = lang === "en" ? "Type" : "Tipo";
  const parts: string[] = [`${label}: ${typeName}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value.trim()) parts.push(`${key}: ${value.trim()}`);
  }
  return parts.join("\n");
}

function Field({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-mono tracking-widest uppercase text-zinc-300">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600 transition-colors font-mono"
      />
    </div>
  );
}

function GuidedForm({ onSubmit, lang }: { onSubmit: (context: string) => void; lang: Lang }) {
  const t = CP[lang];
  const types = CONVERSATION_TYPES_MAP[lang];
  const [type, setType] = useState<ConversationType>("general");
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (key: string, value: string) => setFields((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(buildContextFromGuided(type, fields, lang));
  };

  const fieldDefs =
    type === "realestate"
      ? [
          { label: t.FIELD_PROP,  key: t.FIELD_PROP,  ph: t.PH_PROP },
          { label: t.FIELD_PRICE, key: t.FIELD_PRICE,  ph: t.PH_PRICE },
          { label: t.FIELD_OBJ,   key: t.FIELD_OBJ,    ph: t.PH_OBJ },
          { label: t.FIELD_OBJS,  key: t.FIELD_OBJS,   ph: t.PH_OBJS },
        ]
      : [
          { label: t.FIELD_WHO,  key: t.FIELD_WHO,  ph: t.PH_WHO },
          { label: t.FIELD_GOAL, key: t.FIELD_GOAL, ph: t.PH_GOAL },
          { label: t.FIELD_FEAR, key: t.FIELD_FEAR, ph: t.PH_FEAR },
        ];

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {types.map((tp) => (
          <button
            key={tp.value}
            type="button"
            onClick={() => { setType(tp.value); setFields({}); }}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-mono transition-all",
              type === tp.value
                ? "bg-white text-black"
                : "bg-zinc-900 text-zinc-200 hover:text-white border border-zinc-700"
            )}
          >
            {tp.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3">
        {fieldDefs.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            value={fields[f.key] ?? ""}
            onChange={(v) => set(f.key, v)}
            placeholder={f.ph}
          />
        ))}
      </div>

      <button
        type="submit"
        className="w-full bg-white text-black text-sm font-mono font-bold py-3 rounded-xl hover:bg-zinc-100 active:scale-[0.98] transition-all mt-1"
      >
        {t.START}
      </button>
    </form>
  );
}

/** Full-screen setup view — shown before session starts */
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

        {/* Brand header */}
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <WizardIcon className="w-5 h-6 text-white opacity-90" />
              <h1 className="text-3xl font-mono font-bold text-white tracking-[0.12em] uppercase">
                Closer Wizard
              </h1>
            </div>
            <p className="text-[11px] font-mono text-zinc-500 tracking-[0.2em] uppercase">
              {t.SUBTITLE}
            </p>
          </div>
          {/* Language toggle on setup screen */}
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
              onClick={() => setMode("guided")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono transition-all",
                mode === "guided" ? "bg-white text-black" : "text-zinc-300 hover:text-white"
              )}
            >
              <AlignLeft className="w-3 h-3" />
              {t.GUIDED}
            </button>
          </div>

          {/* Content block */}
          {mode === "quick" ? (
            <div className="flex flex-col gap-4">
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
              <button
                onClick={() => onContextReady("")}
                className="w-full text-center text-[11px] font-mono text-zinc-300 hover:text-white transition-colors py-1"
              >
                {t.SKIP}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <GuidedForm onSubmit={onContextReady} lang={lang} />
              <button
                onClick={() => onContextReady("")}
                className="w-full text-center text-[11px] font-mono text-zinc-300 hover:text-white transition-colors py-1"
              >
                {t.SKIP}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Momentum = "red" | "amber" | "green" | undefined;

const MOMENTUM_LABELS: Record<"es" | "en", Record<"red" | "amber" | "green", string>> = {
  es: { red: "TENSO", amber: "NEUTRO", green: "FAVORABLE" },
  en: { red: "TENSE", amber: "NEUTRAL", green: "FAVORABLE" },
};

/** Compact top bar — shown during active session */
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
        className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0 pr-4">
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
        <div className="flex items-center gap-3 shrink-0">
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
          <button
            onClick={(e) => { e.stopPropagation(); onClearSession(); }}
            className="text-[10px] font-mono text-zinc-400 hover:text-red-400 px-3 py-2 rounded-lg hover:bg-red-950/25 transition-all -mr-1"
          >
            {t.END}
          </button>
          {expanded
            ? <ChevronUp className="w-3 h-3 text-zinc-200" />
            : <ChevronDown className="w-3 h-3 text-zinc-200" />}
        </div>
      </div>

      {expanded && sessionContext && (
        <div className="px-5 pb-3">
          <p className="text-[11px] font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {sessionContext}
          </p>
        </div>
      )}
    </div>
  );
}
