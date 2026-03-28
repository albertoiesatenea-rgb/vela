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

interface ContextPanelProps {
  onContextReady: (context: string) => void;
  sessionContext: string | null;
  onClearSession: () => void;
}

function buildContextFromGuided(
  type: ConversationType,
  fields: Record<string, string>
): string {
  const typeName = CONVERSATION_TYPES.find((t) => t.value === type)?.label ?? type;
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
        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600 transition-colors font-mono"
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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 h-full">
      {/* Type chips */}
      <div className="flex flex-wrap gap-1.5">
        {CONVERSATION_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => { setType(t.value); setFields({}); }}
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

      {/* Fields */}
      <div className="grid grid-cols-2 gap-3 flex-1">
        {type !== "inmobiliaria" ? (
          <>
            <Field label="Con quién hablo" value={fields["Con quién"] ?? ""} onChange={v => set("Con quién", v)} placeholder="cliente, jefe, amiga..." />
            <Field label="Qué quiero conseguir" value={fields["Objetivo"] ?? ""} onChange={v => set("Objetivo", v)} placeholder="cerrar, convencer, acordar..." />
            <Field label="Qué me preocupa" value={fields["Preocupación"] ?? ""} onChange={v => set("Preocupación", v)} placeholder="que diga que es caro..." />
            <Field label="Info adicional" value={fields["Adicional"] ?? ""} onChange={v => set("Adicional", v)} placeholder="cualquier contexto..." />
          </>
        ) : (
          <>
            <Field label="Cliente" value={fields["Cliente"] ?? ""} onChange={v => set("Cliente", v)} placeholder="Nombre" />
            <Field label="Inmueble" value={fields["Inmueble"] ?? ""} onChange={v => set("Inmueble", v)} placeholder="3 hab, 85m², Atocha..." />
            <Field label="Precio" value={fields["Precio"] ?? ""} onChange={v => set("Precio", v)} placeholder="420.000€" />
            <Field label="Objetivo" value={fields["Objetivo"] ?? ""} onChange={v => set("Objetivo", v)} placeholder="cerrar reserva, 2ª visita..." />
            <Field label="Posibles objeciones" value={fields["Objeciones"] ?? ""} onChange={v => set("Objeciones", v)} placeholder="precio, miedo, comparar..." />
            <Field label="Perfil del cliente" value={fields["Perfil"] ?? ""} onChange={v => set("Perfil", v)} placeholder="primera compra, inversor..." />
          </>
        )}
      </div>

      <button
        type="submit"
        className="w-full bg-white text-black text-sm font-mono font-bold py-3 rounded-xl hover:bg-zinc-200 active:scale-[0.98] transition-all"
      >
        Iniciar sesión →
      </button>
    </form>
  );
}

/** Full-screen setup view — shown before session starts */
export function ContextSetup({ onContextReady }: { onContextReady: (ctx: string) => void }) {
  const [mode, setMode] = useState<ContextMode>("quick");
  const [quickText, setQuickText] = useState("");

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-8 pb-6">
        <div>
          <h1 className="text-xs font-mono tracking-[0.3em] uppercase text-zinc-500">Silent Closer</h1>
          <p className="text-[11px] font-mono text-zinc-700 mt-0.5">Configura el contexto antes de empezar</p>
        </div>
        <button
          onClick={() => onContextReady("")}
          className="text-[11px] font-mono text-zinc-700 hover:text-zinc-400 transition-colors border border-zinc-800 px-3 py-1.5 rounded-full"
        >
          Saltar →
        </button>
      </div>

      {/* Mode toggle */}
      <div className="px-8 mb-6">
        <div className="flex items-center bg-zinc-950 p-1 rounded-full border border-zinc-800 w-fit">
          <button
            onClick={() => setMode("quick")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-mono transition-all",
              mode === "quick" ? "bg-white text-black" : "text-zinc-500 hover:text-white"
            )}
          >
            <Zap className="w-3 h-3" />
            Modo rápido
          </button>
          <button
            onClick={() => setMode("guided")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-mono transition-all",
              mode === "guided" ? "bg-white text-black" : "text-zinc-500 hover:text-white"
            )}
          >
            <AlignLeft className="w-3 h-3" />
            Modo guiado
          </button>
        </div>
      </div>

      {/* Content — fills remaining space */}
      <div className="flex-1 px-8 pb-8 overflow-y-auto flex flex-col">
        {mode === "quick" ? (
          <div className="flex flex-col gap-4 flex-1">
            <textarea
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              placeholder={`Describe la situación en tus palabras...\n\nEj: "Voy a hablar con un cliente que ya vio el piso pero le frena el precio. Quiero que reserve hoy. Me preocupa que quiera comparar con otras opciones."`}
              className="flex-1 w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-5 py-4 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:border-zinc-600 transition-colors font-mono resize-none leading-relaxed"
              autoFocus
            />
            <button
              onClick={() => onContextReady(quickText)}
              className="w-full bg-white text-black text-sm font-mono font-bold py-3.5 rounded-xl hover:bg-zinc-200 active:scale-[0.98] transition-all"
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
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-500">
            Sesión activa
          </span>
          {!expanded && sessionContext && (
            <span className="text-[10px] font-mono text-zinc-700 truncate max-w-xs ml-1">
              — {sessionContext.split("\n")[0]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onClearSession(); }}
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
      </button>

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
