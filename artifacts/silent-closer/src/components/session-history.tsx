import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";

interface SavedSession {
  id: string;
  createdAt: string;
  outcome: string | null;
  score: number | null;
  brainId: string | null;
  sessionContext: string | null;
}

export function SessionHistory({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/copilot/sessions")
      .then(r => r.json())
      .then(d => { setSessions(d.sessions ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) +
      " · " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  };

  const outcomeLabel: Record<string, string> = {
    closed: "Cerrado",
    next_step: "Siguiente paso",
    follow_up: "Seguimiento",
    lost: "Perdido",
    unclear: "Sin definir",
  };

  const scoreColor = (s: number | null) => {
    if (s === null || s === undefined) return "text-zinc-500";
    if (s >= 7) return "text-teal-400";
    if (s >= 5) return "text-amber-400";
    return "text-red-400";
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(`/api/copilot/sessions/${id}`, { method: "DELETE" });
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch {
      // silently ignore
    } finally {
      setDeleting(null);
    }
  };

  const contextPreview = (ctx: string | null) => {
    if (!ctx) return "Sin contexto";
    const firstLine = ctx.split("\n")[0];
    return firstLine.length > 200 ? firstLine.slice(0, 200) + "…" : firstLine;
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <span className="text-sm font-mono font-bold tracking-widest uppercase text-foreground">
          Historial
        </span>
        <button
          onClick={onClose}
          className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Volver
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && (
          <p className="text-xs font-mono text-muted-foreground">Cargando...</p>
        )}
        {!loading && sessions.length === 0 && (
          <p className="text-xs font-mono text-muted-foreground">
            No hay sesiones guardadas todavía.
          </p>
        )}
        {sessions.map(s => (
          <div
            key={s.id}
            className="border border-border rounded-xl p-4 mb-3 flex items-start justify-between gap-4"
          >
            {/* Left: metadata */}
            <div className="flex flex-col gap-1.5 min-w-0 flex-1">
              <span className="text-[10px] font-mono text-muted-foreground">
                {fmtDate(s.createdAt)}
              </span>
              <span className="text-xs text-foreground leading-snug">
                {contextPreview(s.sessionContext)}
              </span>
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                {s.brainId && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {s.brainId}
                  </span>
                )}
                {s.outcome && (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {outcomeLabel[s.outcome] ?? s.outcome}
                  </span>
                )}
              </div>
            </div>

            {/* Right: score + delete */}
            <div className="shrink-0 flex flex-col items-end gap-3">
              <span className={cn("text-2xl font-mono font-bold leading-none", scoreColor(s.score))}>
                {s.score !== null ? s.score.toFixed(1) : "—"}
              </span>
              <button
                onClick={() => void handleDelete(s.id)}
                disabled={deleting === s.id}
                className="text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-30"
                title="Eliminar sesión"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
