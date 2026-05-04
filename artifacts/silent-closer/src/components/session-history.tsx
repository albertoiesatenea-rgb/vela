import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Trash2, ChevronDown, ChevronUp, Download } from "lucide-react";

interface BrutalAudit {
  verdict?: string;
  what_worked?: string[];
  what_failed?: string[];
  failure_owner?: string[];
  missed_closes?: string[];
  rules_violated?: string[];
  priority_changes?: string[];
  what_i_would_have_done?: string;
  perfect_conversation?: string;
  [key: string]: unknown;
}

interface SavedSession {
  id: string;
  createdAt: string;
  outcome: string | null;
  score: number | null;
  brainId: string | null;
  sessionContext: string | null;
  clientName: string | null;
  whisperTranscript: string | null;
  brutalAudit: BrutalAudit | null;
}

const OUTCOME_LABEL: Record<string, string> = {
  closed: "Cerrado",
  next_step: "Sig. paso",
  follow_up: "Seguimiento",
  lost: "Perdido",
  unclear: "Sin definir",
};

function scoreColor(s: number | null) {
  if (s === null) return "text-zinc-500";
  if (s >= 7) return "text-teal-400";
  if (s >= 5) return "text-amber-400";
  return "text-red-400";
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

function AuditBlock({ label, color, items }: { label: string; color: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className={cn("text-[9px] font-mono mb-0.5 tracking-wide", color)}>{label}</p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs font-mono text-foreground leading-snug">— {item}</li>
        ))}
      </ul>
    </div>
  );
}

function downloadLog(s: SavedSession) {
  const lines: string[] = [];
  lines.push(`# Sesión VELA — ${fmtDate(s.createdAt)}`);
  lines.push(`**Cliente:** ${s.clientName ?? "Sin nombre"}`);
  lines.push(`**Outcome:** ${s.outcome ? (OUTCOME_LABEL[s.outcome] ?? s.outcome) : "—"}`);
  lines.push(`**Score:** ${s.score !== null ? s.score.toFixed(1) : "—"}`);
  lines.push(`**Brain:** ${s.brainId ?? "—"}`);
  lines.push("");
  if (s.sessionContext) {
    lines.push("## Contexto");
    lines.push(s.sessionContext);
    lines.push("");
  }
  if (s.whisperTranscript) {
    lines.push("## Transcript");
    lines.push(s.whisperTranscript);
    lines.push("");
  }
  if (s.brutalAudit) {
    const a = s.brutalAudit;
    lines.push("## Auditoría brutal");
    if (a.verdict) { lines.push(`### Veredicto\n${a.verdict}`); lines.push(""); }
    if (a.what_worked?.length) { lines.push(`### Qué funcionó\n${a.what_worked.map(x => `- ${x}`).join("\n")}`); lines.push(""); }
    if (a.what_failed?.length) { lines.push(`### Qué falló\n${a.what_failed.map(x => `- ${x}`).join("\n")}`); lines.push(""); }
    if (a.missed_closes?.length) { lines.push(`### Cierres perdidos\n${a.missed_closes.map(x => `- ${x}`).join("\n")}`); lines.push(""); }
    if (a.priority_changes?.length) { lines.push(`### Cambios prioritarios\n${a.priority_changes.map(x => `- ${x}`).join("\n")}`); lines.push(""); }
    if (a.what_i_would_have_done) { lines.push(`### Lo que yo habría hecho\n${a.what_i_would_have_done}`); lines.push(""); }
    if (a.perfect_conversation) { lines.push(`### Conversación perfecta\n${a.perfect_conversation}`); lines.push(""); }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vela-sesion-${s.id.slice(0, 8)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function SessionHistory({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/copilot/sessions")
      .then(r => r.json())
      .then(d => { setSessions(d.sessions ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(id);
    try {
      await fetch(`/api/copilot/sessions/${id}`, { method: "DELETE" });
      setSessions(prev => prev.filter(s => s.id !== id));
      if (expanded === id) setExpanded(null);
    } catch {
      // silently ignore
    } finally {
      setDeleting(null);
    }
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
          <p className="text-xs font-mono text-muted-foreground">No hay sesiones guardadas todavía.</p>
        )}

        {sessions.map(s => {
          const isOpen = expanded === s.id;
          const audit = s.brutalAudit;

          return (
            <div key={s.id} className="border border-border rounded-xl mb-2 overflow-hidden">
              {/* Compact row */}
              <button
                onClick={() => setExpanded(prev => prev === s.id ? null : s.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
              >
                <span className="font-mono font-bold text-xs text-foreground min-w-[90px] truncate">
                  {s.clientName ?? "Sin nombre"}
                </span>

                <span className={cn("font-mono font-bold text-sm w-8 text-right shrink-0", scoreColor(s.score))}>
                  {s.score !== null ? s.score.toFixed(1) : "—"}
                </span>

                {s.outcome && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0">
                    {OUTCOME_LABEL[s.outcome] ?? s.outcome}
                  </span>
                )}

                <span className="flex-1" />

                <span className="text-[9px] font-mono text-muted-foreground shrink-0">
                  {fmtDate(s.createdAt)}
                </span>

                <span className="text-muted-foreground shrink-0 ml-1">
                  {isOpen
                    ? <ChevronUp className="w-3 h-3" />
                    : <ChevronDown className="w-3 h-3" />}
                </span>

                <button
                  onClick={e => void handleDelete(s.id, e)}
                  disabled={deleting === s.id}
                  className="text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-30 shrink-0 ml-1"
                  title="Eliminar sesión"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="border-t border-border px-4 py-3 flex flex-col gap-3">
                  {s.sessionContext && (
                    <div>
                      <p className="text-[9px] font-mono text-muted-foreground mb-1 tracking-widest uppercase">Contexto</p>
                      <p className="text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed">
                        {s.sessionContext}
                      </p>
                    </div>
                  )}

                  {s.whisperTranscript && (
                    <div>
                      <p className="text-[9px] font-mono text-muted-foreground mb-1 tracking-widest uppercase">Transcript</p>
                      <p className="text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                        {s.whisperTranscript}
                      </p>
                    </div>
                  )}

                  {audit && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase">Auditoría brutal</p>
                      {audit.verdict && (
                        <div>
                          <p className="text-[9px] font-mono text-muted-foreground mb-0.5">Veredicto</p>
                          <p className="text-xs font-mono text-foreground leading-snug">{audit.verdict}</p>
                        </div>
                      )}
                      <AuditBlock label="Qué funcionó" color="text-teal-400" items={audit.what_worked} />
                      <AuditBlock label="Qué falló" color="text-red-400" items={audit.what_failed} />
                      <AuditBlock label="Cierres perdidos" color="text-sky-400" items={audit.missed_closes} />
                      <AuditBlock label="Cambios prioritarios" color="text-foreground" items={audit.priority_changes} />
                      {audit.what_i_would_have_done && (
                        <div>
                          <p className="text-[9px] font-mono text-muted-foreground mb-0.5">Lo que yo habría hecho</p>
                          <p className="text-xs font-mono text-foreground italic leading-snug">{audit.what_i_would_have_done}</p>
                        </div>
                      )}
                      {audit.perfect_conversation && (
                        <div>
                          <p className="text-[9px] font-mono text-amber-400 mb-0.5">Conversación perfecta</p>
                          <p className="text-xs font-mono text-foreground whitespace-pre-wrap leading-snug">{audit.perfect_conversation}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => downloadLog(s)}
                    className="self-start flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground hover:text-foreground transition-colors border border-border rounded-full px-2.5 py-1 mt-1"
                  >
                    <Download className="w-3 h-3" />
                    Descargar log
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
