import { useState } from "react";
import { ChevronDown, ChevronUp, Zap, AlignLeft } from "lucide-react";
import { cn } from "@/lib/utils";

type ContextMode = "quick" | "guided";

type ConversationType =
  | "general"
  | "personal"
  | "negociacion"
  | "venta"
  | "videollamada"
  | "inmobiliaria"
  | "objeciones";

const CONVERSATION_TYPES: { value: ConversationType; label: string }[] = [
  { value: "general", label: "General" },
  { value: "personal", label: "Personal" },
  { value: "negociacion", label: "Negociación" },
  { value: "venta", label: "Venta" },
  { value: "videollamada", label: "Videollamada" },
  { value: "inmobiliaria", label: "Inmobiliaria" },
  { value: "objeciones", label: "Objeciones" },
];

const QUICK_CHIPS = [
  "cliente escéptico",
  "objeción de precio",
  "quiero cerrar hoy",
  "no me cree",
  "comparando opciones",
  "miedo a comprometerse",
];

function buildContextFromGuided(
  type: ConversationType,
  fields: Record<string, string>
): string {
  const typeName =
    CONVERSATION_TYPES.find((t) => t.value === type)?.label ?? type;
  const parts: string[] = [`Tipo: ${typeName}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value.trim()) parts.push(`${key}: ${value.trim()}`);
  }
  return parts.join("\n");
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-mono tracking-widest uppercase text-zinc-600">
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

function GuidedForm({ onSubmit }: { onSubmit: (context: string) => void }) {
  const [type, setType] = useState<ConversationType>("general");
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (key: string, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(buildContextFromGuided(type, fields));
  };

  const fieldDefs =
    type === "inmobiliaria"
      ? [
          { label: "Inmueble", key: "Inmueble", ph: "3 hab, 85m², Atocha…" },
          { label: "Precio", key: "Precio", ph: "420.000€" },
          { label: "Objetivo", key: "Objetivo", ph: "cerrar reserva, 2ª visita…" },
          { label: "Objeciones esperadas", key: "Objeciones", ph: "precio, comparar, miedo…" },
        ]
      : [
          { label: "Con quién hablo", key: "Con quién", ph: "cliente, jefe, inversor…" },
          { label: "Qué quiero conseguir", key: "Objetivo", ph: "cerrar, convencer, acordar…" },
          { label: "Qué me preocupa", key: "Preocupación", ph: "que diga que es caro…" },
        ];

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {CONVERSATION_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => {
              setType(t.value);
              setFields({});
            }}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-mono transition-all",
              type === t.value
                ? "bg-white text-black"
                : "bg-zinc-900 text-zinc-500 hover:text-white border border-zinc-800"
            )}
          >
            {t.label}
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
        Iniciar sesión →
      </button>
    </form>
  );
}

/** Full-screen setup view — shown before session starts */
export function ContextSetup({
  onContextReady,
}: {
  onContextReady: (ctx: string) => void;
}) {
  const [mode, setMode] = useState<ContextMode>("quick");
  const [quickText, setQuickText] = useState("");

  const appendChip = (chip: string) => {
    setQuickText((prev) =>
      prev.trim() ? `${prev.trimEnd()}, ${chip}` : chip
    );
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center px-6">
      {/* Outer card — max width centrado */}
      <div className="w-full max-w-lg flex flex-col gap-7">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-mono tracking-[0.3em] uppercase text-zinc-600">
              Silent Closer
            </p>
            <h1 className="text-xl font-mono font-semibold text-white mt-1 tracking-tight">
              Prepara la sesión
            </h1>
            <p className="text-xs font-mono text-zinc-600 mt-0.5">
              Contexto opcional — arranca en segundos
            </p>
          </div>
          <button
            onClick={() => onContextReady("")}
            className="text-[11px] font-mono text-zinc-700 hover:text-zinc-400 transition-colors border border-zinc-800 px-3 py-1.5 rounded-full shrink-0 mt-1"
          >
            Saltar →
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center bg-zinc-950 p-1 rounded-full border border-zinc-800 w-fit">
          <button
            onClick={() => setMode("quick")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono transition-all",
              mode === "quick"
                ? "bg-white text-black"
                : "text-zinc-500 hover:text-white"
            )}
          >
            <Zap className="w-3 h-3" />
            Rápido
          </button>
          <button
            onClick={() => setMode("guided")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-mono transition-all",
              mode === "guided"
                ? "bg-white text-black"
                : "text-zinc-500 hover:text-white"
            )}
          >
            <AlignLeft className="w-3 h-3" />
            Guiado
          </button>
        </div>

        {/* Content block */}
        {mode === "quick" ? (
          <div className="flex flex-col gap-3">
            <textarea
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              placeholder="Describe la situación en pocas palabras…"
              rows={3}
              autoFocus
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600 transition-colors font-mono resize-none leading-relaxed"
            />

            {/* Quick chips */}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => appendChip(chip)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-mono text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-300 transition-all"
                >
                  {chip}
                </button>
              ))}
            </div>

            <button
              onClick={() => onContextReady(quickText)}
              className="w-full bg-white text-black text-sm font-mono font-bold py-3.5 rounded-xl hover:bg-zinc-100 active:scale-[0.98] transition-all mt-1"
            >
              Iniciar sesión →
            </button>
          </div>
        ) : (
          <GuidedForm onSubmit={onContextReady} />
        )}
      </div>
    </div>
  );
}

/** Compact top bar — shown during active session */
export function SessionBar({
  sessionContext,
  onClearSession,
}: {
  sessionContext: string;
  onClearSession: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-white/5 bg-black shrink-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-500 shrink-0">
            Sesión activa
          </span>
          {!expanded && sessionContext && (
            <span className="text-[10px] font-mono text-zinc-700 truncate ml-1">
              — {sessionContext.split("\n")[0]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearSession();
            }}
            className="text-[10px] font-mono text-zinc-700 hover:text-red-400 transition-colors"
          >
            Finalizar
          </button>
          {expanded ? (
            <ChevronUp className="w-3 h-3 text-zinc-700" />
          ) : (
            <ChevronDown className="w-3 h-3 text-zinc-700" />
          )}
        </div>
      </div>

      {expanded && sessionContext && (
        <div className="px-5 pb-3">
          <p className="text-[11px] font-mono text-zinc-600 leading-relaxed whitespace-pre-wrap">
            {sessionContext}
          </p>
        </div>
      )}
    </div>
  );
}
