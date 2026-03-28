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
  { value: "general", label: "Conversación general" },
  { value: "personal", label: "Conversación personal" },
  { value: "negociacion", label: "Negociación" },
  { value: "venta", label: "Venta" },
  { value: "videollamada", label: "Videollamada comercial" },
  { value: "inmobiliaria", label: "Venta inmobiliaria" },
  { value: "objeciones", label: "Gestión de objeciones" },
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
  const parts: string[] = [`Tipo de conversación: ${CONVERSATION_TYPES.find(t => t.value === type)?.label}`];

  for (const [key, value] of Object.entries(fields)) {
    if (value.trim()) {
      parts.push(`${key}: ${value.trim()}`);
    }
  }

  return parts.join("\n");
}

function GuidedForm({
  onSubmit,
}: {
  onSubmit: (context: string) => void;
}) {
  const [type, setType] = useState<ConversationType>("general");
  const [fields, setFields] = useState<Record<string, string>>({});

  const set = (key: string, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(buildContextFromGuided(type, fields));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Type selector */}
      <div className="flex flex-wrap gap-2">
        {CONVERSATION_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => { setType(t.value); setFields({}); }}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-mono transition-all duration-200",
              type === t.value
                ? "bg-white text-black"
                : "bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* General / Personal / Negociación / Venta / Videollamada / Objeciones */}
      {type !== "inmobiliaria" && (
        <div className="space-y-3">
          <Field label="Con quién hablo" value={fields["Con quién hablo"] ?? ""} onChange={v => set("Con quién hablo", v)} placeholder="Ej: cliente escéptico, mi jefe, una amiga..." />
          <Field label="Qué quiero conseguir" value={fields["Qué quiero conseguir"] ?? ""} onChange={v => set("Qué quiero conseguir", v)} placeholder="Ej: cerrar una reserva, conseguir permiso, que confíe en mí..." />
          <Field label="Qué me preocupa" value={fields["Qué me preocupa"] ?? ""} onChange={v => set("Qué me preocupa", v)} placeholder="Ej: que diga que es muy caro, que no tome decisión hoy..." />
          <Field label="Información útil adicional" value={fields["Información adicional"] ?? ""} onChange={v => set("Información adicional", v)} placeholder="Cualquier cosa relevante..." />
        </div>
      )}

      {/* Inmobiliaria template */}
      {type === "inmobiliaria" && (
        <div className="space-y-3">
          <Field label="Nombre del cliente" value={fields["Cliente"] ?? ""} onChange={v => set("Cliente", v)} placeholder="Ej: Juan García" />
          <Field label="Inmueble" value={fields["Inmueble"] ?? ""} onChange={v => set("Inmueble", v)} placeholder="Ej: Piso 3 hab en Atocha, 85m²" />
          <Field label="Precio o rango" value={fields["Precio"] ?? ""} onChange={v => set("Precio", v)} placeholder="Ej: 420.000€" />
          <Field label="Zona / ciudad" value={fields["Zona"] ?? ""} onChange={v => set("Zona", v)} placeholder="Ej: Madrid centro" />
          <Field label="Objetivo de la llamada" value={fields["Objetivo"] ?? ""} onChange={v => set("Objetivo", v)} placeholder="Ej: cerrar reserva, segunda visita, resolver duda..." />
          <Field label="Posibles objeciones" value={fields["Objeciones"] ?? ""} onChange={v => set("Objeciones", v)} placeholder="Ej: precio alto, miedo a equivocarse, quiere comparar..." />
          <Field label="Perfil del cliente" value={fields["Perfil"] ?? ""} onChange={v => set("Perfil", v)} placeholder="Ej: primera compra, inversor, pareja con presupuesto justo..." />
          <Field label="Información adicional" value={fields["Adicional"] ?? ""} onChange={v => set("Adicional", v)} placeholder="Cualquier cosa relevante..." />
        </div>
      )}

      <button
        type="submit"
        className="w-full bg-white text-black text-sm font-mono font-bold py-2.5 rounded-xl hover:bg-zinc-200 active:scale-[0.98] transition-all"
      >
        Iniciar sesión →
      </button>
    </form>
  );
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
      <label className="text-[10px] font-mono tracking-widest uppercase text-zinc-500">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors font-mono"
      />
    </div>
  );
}

export function ContextPanel({ onContextReady, sessionContext, onClearSession }: ContextPanelProps) {
  const [mode, setMode] = useState<ContextMode>("quick");
  const [quickText, setQuickText] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Active session — show collapsed summary
  if (sessionContext !== null) {
    return (
      <div className="border-b border-white/5 bg-black">
        <button
          onClick={() => setIsCollapsed((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-3 text-left hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">
              Sesión activa
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); onClearSession(); }}
              className="text-[10px] font-mono text-zinc-600 hover:text-red-400 transition-colors px-2 py-1 rounded"
            >
              Finalizar sesión
            </button>
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronUp className="w-3.5 h-3.5 text-zinc-600" />}
          </div>
        </button>

        {!isCollapsed && (
          <div className="px-6 pb-4">
            <p className="text-xs font-mono text-zinc-500 leading-relaxed whitespace-pre-wrap line-clamp-4">
              {sessionContext}
            </p>
          </div>
        )}
      </div>
    );
  }

  // Setup screen
  return (
    <div className="border-b border-white/5 bg-zinc-950 px-6 py-5">
      {/* Mode toggle */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-600 mr-2">
          Contexto
        </span>
        <div className="flex items-center bg-zinc-900 p-0.5 rounded-full border border-zinc-800">
          <button
            onClick={() => setMode("quick")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all duration-200",
              mode === "quick" ? "bg-white text-black" : "text-zinc-500 hover:text-white"
            )}
          >
            <Zap className="w-3 h-3" />
            Rápido
          </button>
          <button
            onClick={() => setMode("guided")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all duration-200",
              mode === "guided" ? "bg-white text-black" : "text-zinc-500 hover:text-white"
            )}
          >
            <AlignLeft className="w-3 h-3" />
            Guiado
          </button>
        </div>
        <button
          onClick={() => onContextReady("")}
          className="ml-auto text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          saltar →
        </button>
      </div>

      {/* Quick mode */}
      {mode === "quick" && (
        <div className="space-y-3">
          <textarea
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder={`Describe la situación en tus palabras...\n\nEj: "Voy a hablar con un cliente que ya vio el piso pero tiene miedo al precio. Quiero que reserve hoy."`}
            rows={4}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors font-mono resize-none"
            autoFocus
          />
          <button
            onClick={() => onContextReady(quickText)}
            className="w-full bg-white text-black text-sm font-mono font-bold py-2.5 rounded-xl hover:bg-zinc-200 active:scale-[0.98] transition-all"
          >
            Iniciar sesión →
          </button>
        </div>
      )}

      {/* Guided mode */}
      {mode === "guided" && (
        <GuidedForm onSubmit={onContextReady} />
      )}
    </div>
  );
}
