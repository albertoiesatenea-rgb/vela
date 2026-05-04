import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Trash2, Download } from "lucide-react";

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

interface VelaAudit {
  verdict?: string;
  reliability?: string;
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
  rawInput: string | null;
  prebriefId: string | null;
  callSummary: unknown | null;
  brutalAudit: BrutalAudit | null;
  // canonical
  whisperTranscript: string | null;
  canonicalLogMd: string | null;
  sessionSnapshot: unknown | null;
  whisperRawTranscript: string | null;
  whisperCleanTranscript: string | null;
  webSpeechTranscript: string | null;
  velaAudit: VelaAudit | null;
  costSnapshot: unknown | null;
  timelineSnapshot: unknown | null;
  savedExplicitly: boolean | null;
  savedAt: string | null;
  sourceSessionId: string | null;
}

const OUTCOME_LABEL: Record<string, string> = {
  closed:    "Cerrado",
  next_step: "Sig. paso",
  follow_up: "Seguimiento",
  lost:      "Perdido",
  unclear:   "Sin definir",
};

const OUTCOME_DOT: Record<string, string> = {
  closed:    "bg-teal-500",
  next_step: "bg-sky-500",
  follow_up: "bg-amber-500",
  lost:      "bg-red-500",
  unclear:   "bg-zinc-600",
};

function scoreColor(s: number | null) {
  if (s === null) return "text-zinc-500";
  if (s >= 7) return "text-teal-400";
  if (s >= 5) return "text-amber-400";
  return "text-red-400";
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const day  = d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "2-digit" });
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function buildFallbackLog(s: SavedSession): string {
  const lines: string[] = [];
  lines.push(`# Sesión VELA — ${fmtDate(s.createdAt)}`);
  lines.push(`id: ${s.id}`);
  lines.push(`cliente: ${s.clientName ?? "sin nombre"}`);
  lines.push(`outcome: ${s.outcome ? (OUTCOME_LABEL[s.outcome] ?? s.outcome) : "—"}`);
  lines.push(`score: ${s.score !== null ? s.score.toFixed(1) : "—"}`);
  lines.push(`brain: ${s.brainId ?? "—"}`);
  lines.push("");
  if (s.rawInput ?? s.sessionContext) {
    lines.push("## Contexto");
    lines.push((s.rawInput ?? s.sessionContext)!);
    lines.push("");
  }
  const transcript = s.whisperCleanTranscript ?? s.whisperTranscript;
  if (transcript) {
    lines.push("## Transcript (Whisper limpio)");
    lines.push(transcript);
    lines.push("");
  }
  if (s.whisperRawTranscript) {
    lines.push("## Transcript (Whisper bruto)");
    lines.push(s.whisperRawTranscript);
    lines.push("");
  }
  if (s.webSpeechTranscript) {
    lines.push("## Transcript (Web Speech)");
    lines.push(s.webSpeechTranscript);
    lines.push("");
  }
  if (s.brutalAudit) {
    const a = s.brutalAudit;
    lines.push("## Auditoría brutal");
    if (a.verdict) { lines.push(`### Veredicto\n${a.verdict}`); lines.push(""); }
    if (a.what_worked?.length)    { lines.push(`### Qué funcionó\n${a.what_worked.map(x => `- ${x}`).join("\n")}`); lines.push(""); }
    if (a.what_failed?.length)    { lines.push(`### Qué falló\n${a.what_failed.map(x => `- ${x}`).join("\n")}`); lines.push(""); }
    if (a.missed_closes?.length)  { lines.push(`### Cierres perdidos\n${a.missed_closes.map(x => `- ${x}`).join("\n")}`); lines.push(""); }
    if (a.priority_changes?.length) { lines.push(`### Cambios prioritarios\n${a.priority_changes.map(x => `- ${x}`).join("\n")}`); lines.push(""); }
    if (a.what_i_would_have_done) { lines.push(`### Lo que yo habría hecho\n${a.what_i_would_have_done}`); lines.push(""); }
    if (a.perfect_conversation)   { lines.push(`### Conversación perfecta\n${a.perfect_conversation}`); lines.push(""); }
  }
  if (s.velaAudit) {
    lines.push("## Auditoría VELA");
    lines.push(JSON.stringify(s.velaAudit, null, 2));
    lines.push("");
  }
  lines.push(`\n_Log generado por VELA · ${new Date().toISOString()}_`);
  return lines.join("\n");
}

function triggerDownload(content: string, sessionId: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  a.download = `vela-${sessionId.slice(0, 8)}-${ts}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadSession(s: SavedSession) {
  if (s.canonicalLogMd) {
    triggerDownload(s.canonicalLogMd, s.id);
  } else {
    triggerDownload(buildFallbackLog(s), s.id);
  }
}

type Tab = "contexto" | "prebrief" | "transcriptos" | "auditorias" | "sistema";

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: "contexto",    label: "Contexto" },
  { key: "prebrief",    label: "Prebrief" },
  { key: "transcriptos", label: "Transcriptos" },
  { key: "auditorias",  label: "Auditorías" },
  { key: "sistema",     label: "Sistema" },
];

function SessionCard({
  s,
  isOpen,
  onToggle,
  onDelete,
  deleting,
}: {
  s: SavedSession;
  isOpen: boolean;
  onToggle: () => void;
  onDelete: (e: React.MouseEvent) => void;
  deleting: boolean;
}) {
  const [tab, setTab] = useState<Tab>("contexto");
  const hasBrief    = !!s.prebriefId;
  const hasBrutal   = !!s.brutalAudit;
  const hasVela     = !!s.velaAudit;
  const hasWhisper  = !!(s.whisperCleanTranscript ?? s.whisperTranscript);
  const hasCanonical = !!s.canonicalLogMd;

  const transcript = s.whisperCleanTranscript ?? s.whisperTranscript;
  const summary    = s.callSummary as Record<string, unknown> | null;
  const tl         = s.timelineSnapshot as Record<string, unknown> | null;
  const cost       = s.costSnapshot as Record<string, unknown> | null;

  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden mb-2">
      {/* ── Card header row ── */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-white/3 transition-colors"
      >
        {/* Outcome dot */}
        <div className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          s.outcome ? (OUTCOME_DOT[s.outcome] ?? "bg-zinc-500") : "bg-zinc-700"
        )} />

        {/* Client name */}
        <span className="font-mono font-bold text-xs text-white truncate flex-1 min-w-0">
          {s.clientName ?? "Sin nombre"}
        </span>

        {/* Score */}
        <span className={cn("font-mono font-bold text-sm w-8 text-right shrink-0", scoreColor(s.score))}>
          {s.score !== null ? s.score.toFixed(1) : "—"}
        </span>

        {/* Outcome label */}
        {s.outcome && (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 shrink-0">
            {OUTCOME_LABEL[s.outcome] ?? s.outcome}
          </span>
        )}

        {/* Indicator dots */}
        <div className="flex items-center gap-1 shrink-0">
          {hasBrief   && <div className="w-1.5 h-1.5 rounded-full bg-violet-500" title="Prebrief" />}
          {hasBrutal  && <div className="w-1.5 h-1.5 rounded-full bg-red-500" title="Auditoría brutal" />}
          {hasVela    && <div className="w-1.5 h-1.5 rounded-full bg-sky-500" title="Auditoría VELA" />}
          {hasWhisper && <div className="w-1.5 h-1.5 rounded-full bg-teal-500" title="Transcript Whisper" />}
        </div>

        {/* Date */}
        <span className="text-[9px] font-mono text-zinc-500 shrink-0">{fmtDate(s.createdAt)}</span>

        {/* Brain badge */}
        {s.brainId && (
          <span className="text-[8px] font-mono text-zinc-600 border border-zinc-800 px-1 py-0.5 rounded shrink-0 hidden sm:block">
            {s.brainId.slice(0, 10)}
          </span>
        )}

        {/* Expand chevron */}
        <span className="text-zinc-600 text-[10px] shrink-0">{isOpen ? "▲" : "▼"}</span>

        {/* Download button */}
        <button
          onClick={e => { e.stopPropagation(); downloadSession(s); }}
          className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
          title={hasCanonical ? "Descargar log canónico" : "Descargar log (fallback)"}
        >
          <Download className="w-3 h-3" />
        </button>

        {/* Delete button */}
        <button
          onClick={onDelete}
          disabled={deleting}
          className="text-zinc-700 hover:text-red-400 transition-colors disabled:opacity-30 shrink-0"
          title="Eliminar sesión"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </button>

      {/* ── Expanded detail ── */}
      {isOpen && (
        <div className="border-t border-zinc-800">
          {/* Tabs */}
          <div className="flex items-center gap-0 border-b border-zinc-800 px-4 overflow-x-auto">
            {TAB_LABELS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "px-3 py-2 text-[9px] font-mono tracking-widest uppercase shrink-0 border-b-2 transition-colors",
                  tab === t.key
                    ? "border-white text-white"
                    : "border-transparent text-zinc-600 hover:text-zinc-300"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="px-4 py-3 flex flex-col gap-3">

            {/* CONTEXTO */}
            {tab === "contexto" && (
              <>
                {(s.rawInput ?? s.sessionContext) ? (
                  <div>
                    <p className="text-[9px] font-mono text-zinc-500 mb-1 tracking-widest uppercase">Contexto original</p>
                    <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                      {s.rawInput ?? s.sessionContext}
                    </pre>
                  </div>
                ) : (
                  <p className="text-xs font-mono text-zinc-600">Sin contexto registrado.</p>
                )}
                {summary && (
                  <div className="border-t border-zinc-800/50 pt-3">
                    <p className="text-[9px] font-mono text-zinc-500 mb-1.5 tracking-widest uppercase">Summary</p>
                    <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                      <div>
                        <p className="text-zinc-600 text-[9px]">Score</p>
                        <p className={cn("font-bold", scoreColor(s.score))}>
                          {s.score !== null ? s.score.toFixed(1) : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-zinc-600 text-[9px]">Estado</p>
                        <p className="text-zinc-300">{String((summary as Record<string,unknown>)["globalState"] ?? "—")}</p>
                      </div>
                      <div>
                        <p className="text-zinc-600 text-[9px]">Resultado</p>
                        <p className="text-zinc-300 truncate">{String((summary as Record<string,unknown>)["resultLabel"] ?? "—")}</p>
                      </div>
                    </div>
                    {Array.isArray((summary as Record<string,unknown>)["strengths"]) && ((summary as Record<string,unknown>)["strengths"] as string[]).length > 0 && (
                      <div className="mt-2">
                        <p className="text-[9px] font-mono text-teal-600 mb-1">FUNCIONÓ</p>
                        {((summary as Record<string,unknown>)["strengths"] as string[]).map((x, i) => (
                          <p key={i} className="text-[11px] font-mono text-zinc-400">→ {x}</p>
                        ))}
                      </div>
                    )}
                    {Array.isArray((summary as Record<string,unknown>)["improvements"]) && ((summary as Record<string,unknown>)["improvements"] as string[]).length > 0 && (
                      <div className="mt-2">
                        <p className="text-[9px] font-mono text-amber-600 mb-1">MEJORAR</p>
                        {((summary as Record<string,unknown>)["improvements"] as string[]).map((x, i) => (
                          <p key={i} className="text-[11px] font-mono text-zinc-400">△ {x}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* PREBRIEF */}
            {tab === "prebrief" && (
              <>
                {!hasBrief ? (
                  <p className="text-xs font-mono text-zinc-600">No se usó prebrief en esta sesión.</p>
                ) : (
                  <>
                    <div>
                      <p className="text-[9px] font-mono text-zinc-500 mb-1 tracking-widest uppercase">Prebrief ID</p>
                      <p className="text-[11px] font-mono text-zinc-400">{s.prebriefId}</p>
                    </div>
                    {/* Note: prebrief detail is in the DB's prebrief_logs table.
                        The interpretedContext and briefing fields are stored there.
                        The canonicalLogMd (section 4) has the full prebrief snapshot. */}
                    {hasCanonical ? (
                      <p className="text-[11px] font-mono text-zinc-500">
                        El log canónico (↓ Descargar) contiene el prebrief completo en la Sección 4.
                      </p>
                    ) : (
                      <p className="text-[11px] font-mono text-zinc-600">
                        Descargue el log para ver el prebrief completo.
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {/* TRANSCRIPTOS */}
            {tab === "transcriptos" && (
              <>
                {transcript && (
                  <div>
                    <p className="text-[9px] font-mono text-teal-600 mb-1 tracking-widest uppercase">
                      Whisper limpio {hasCanonical ? "· fuente de verdad" : ""}
                    </p>
                    <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto border border-zinc-800/50 rounded p-2">
                      {transcript}
                    </pre>
                  </div>
                )}
                {s.whisperRawTranscript && s.whisperRawTranscript !== transcript && (
                  <div>
                    <p className="text-[9px] font-mono text-zinc-500 mb-1 tracking-widest uppercase">Whisper bruto</p>
                    <pre className="text-xs font-mono text-zinc-500 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto border border-zinc-800/50 rounded p-2">
                      {s.whisperRawTranscript}
                    </pre>
                  </div>
                )}
                {s.webSpeechTranscript && (
                  <div>
                    <p className="text-[9px] font-mono text-zinc-500 mb-1 tracking-widest uppercase">Web Speech</p>
                    <pre className="text-xs font-mono text-zinc-500 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto border border-zinc-800/50 rounded p-2">
                      {s.webSpeechTranscript}
                    </pre>
                  </div>
                )}
                {!transcript && !s.whisperRawTranscript && !s.webSpeechTranscript && (
                  <p className="text-xs font-mono text-zinc-600">Sin transcriptos disponibles.</p>
                )}
              </>
            )}

            {/* AUDITORÍAS */}
            {tab === "auditorias" && (
              <>
                {s.brutalAudit ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-[9px] font-mono text-zinc-500 tracking-widest uppercase">Auditoría brutal</p>
                    {s.brutalAudit.verdict && (
                      <div>
                        <p className="text-[9px] font-mono text-zinc-600 mb-0.5">Veredicto</p>
                        <p className="text-xs font-mono text-zinc-200 leading-relaxed">{s.brutalAudit.verdict}</p>
                      </div>
                    )}
                    {AuditList("Funcionó", "text-teal-400", s.brutalAudit.what_worked)}
                    {AuditList("Falló", "text-red-400", s.brutalAudit.what_failed)}
                    {AuditList("Cierres perdidos", "text-sky-400", s.brutalAudit.missed_closes)}
                    {AuditList("Cambios prioritarios", "text-white", s.brutalAudit.priority_changes)}
                    {s.brutalAudit.what_i_would_have_done && (
                      <div>
                        <p className="text-[9px] font-mono text-zinc-600 mb-0.5">Lo que yo habría hecho</p>
                        <p className="text-xs font-mono text-zinc-300 italic leading-relaxed">{s.brutalAudit.what_i_would_have_done}</p>
                      </div>
                    )}
                    {s.brutalAudit.perfect_conversation && (
                      <div>
                        <p className="text-[9px] font-mono text-amber-500 mb-0.5">Conversación perfecta</p>
                        <p className="text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed">{s.brutalAudit.perfect_conversation}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs font-mono text-zinc-600">Sin auditoría brutal.</p>
                )}

                {s.velaAudit && (
                  <div className="flex flex-col gap-1 border-t border-zinc-800/50 pt-3">
                    <p className="text-[9px] font-mono text-zinc-500 tracking-widest uppercase">Auditoría VELA</p>
                    {s.velaAudit.verdict && (
                      <p className="text-xs font-mono text-zinc-300 leading-relaxed">{s.velaAudit.verdict}</p>
                    )}
                    <pre className="text-[10px] font-mono text-zinc-600 whitespace-pre-wrap max-h-48 overflow-y-auto border border-zinc-800/50 rounded p-2 mt-1">
                      {JSON.stringify(s.velaAudit, null, 2)}
                    </pre>
                  </div>
                )}
                {!s.brutalAudit && !s.velaAudit && (
                  <p className="text-xs font-mono text-zinc-600">Sin auditorías disponibles.</p>
                )}
              </>
            )}

            {/* SISTEMA */}
            {tab === "sistema" && (
              <div className="flex flex-col gap-1.5">
                <Row label="DB id"              value={s.id} />
                <Row label="Source session"     value={s.sourceSessionId} />
                <Row label="Guardado"            value={s.savedAt ? fmtDate(s.savedAt) : "—"} />
                <Row label="Guardado explícit."  value={s.savedExplicitly ? "sí" : "no"} />
                <Row label="Log canónico"        value={s.canonicalLogMd ? `${(s.canonicalLogMd.length / 1024).toFixed(1)} KB` : "no"} />
                <Row label="Brain"               value={s.brainId} />
                {tl && (
                  <div className="border-t border-zinc-800/50 pt-2 mt-1 flex flex-col gap-1">
                    <p className="text-[9px] font-mono text-zinc-600 tracking-widest uppercase">Timeline</p>
                    <Row label="Sesión iniciada"     value={fmtTime((tl as Record<string,string>)["session_started_at"])} />
                    <Row label="Sesión terminada"    value={fmtTime((tl as Record<string,string>)["session_ended_at"])} />
                    <Row label="Prebrief creado"     value={fmtTime((tl as Record<string,string>)["prebrief_created_at"])} />
                    <Row label="Briefing listo"      value={fmtTime((tl as Record<string,string>)["prebrief_briefing_ready_at"])} />
                    <Row label="Whisper bruto"       value={fmtTime((tl as Record<string,string>)["whisper_raw_ready_at"])} />
                    <Row label="Whisper limpio"      value={fmtTime((tl as Record<string,string>)["whisper_clean_ready_at"])} />
                    <Row label="Summary listo"       value={fmtTime((tl as Record<string,string>)["summary_ready_at"])} />
                    <Row label="Brutal audit"        value={fmtTime((tl as Record<string,string>)["brutal_audit_ready_at"])} />
                    <Row label="VELA audit"          value={fmtTime((tl as Record<string,string>)["vela_audit_ready_at"])} />
                    <Row label="Guardado en DB"      value={fmtTime((tl as Record<string,string>)["saved_at"])} />
                  </div>
                )}
                {cost && (
                  <div className="border-t border-zinc-800/50 pt-2 mt-1 flex flex-col gap-1">
                    <p className="text-[9px] font-mono text-zinc-600 tracking-widest uppercase">Coste</p>
                    {(cost as Record<string,unknown>)["totalCostUsd"] != null && (
                      <Row label="Total USD" value={`$${Number((cost as Record<string,unknown>)["totalCostUsd"]).toFixed(6)}`} />
                    )}
                    {(cost as Record<string,unknown>)["calls"] != null && (
                      <Row label="Llamadas API" value={String((cost as Record<string,unknown>)["calls"])} />
                    )}
                    {(cost as Record<string,unknown>)["totalTokens"] != null && (
                      <Row label="Tokens totales" value={String((cost as Record<string,unknown>)["totalTokens"])} />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Download footer */}
          <div className="px-4 pb-3 flex justify-end">
            <button
              onClick={() => downloadSession(s)}
              className="flex items-center gap-1.5 text-[9px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors border border-zinc-800 rounded-full px-2.5 py-1"
            >
              <Download className="w-3 h-3" />
              {s.canonicalLogMd ? "Descargar log canónico" : "Descargar log"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2">
      <p className="text-[9px] font-mono text-zinc-600 w-32 shrink-0">{label}</p>
      <p className="text-[11px] font-mono text-zinc-400 truncate">{value ?? "—"}</p>
    </div>
  );
}

function AuditList(label: string, cls: string, items?: string[]) {
  if (!items?.length) return null;
  return (
    <div>
      <p className={cn("text-[9px] font-mono mb-0.5", cls)}>{label.toUpperCase()}</p>
      {items.map((x, i) => (
        <p key={i} className="text-xs font-mono text-zinc-400 leading-snug">— {x}</p>
      ))}
    </div>
  );
}

export function SessionHistory({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [loading, setLoading]   = useState(true);
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
    <div className="fixed inset-0 bg-black flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-mono font-bold tracking-widest uppercase text-white">
            Bitácora
          </span>
          <span className="text-[9px] font-mono text-zinc-600">
            {!loading && `${sessions.length} sesión${sessions.length !== 1 ? "es" : ""}`}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-xs font-mono text-zinc-500 hover:text-white transition-colors"
        >
          ← Volver
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-6 py-2 border-b border-zinc-900 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
          <span className="text-[9px] font-mono text-zinc-600">prebrief</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <span className="text-[9px] font-mono text-zinc-600">brutal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />
          <span className="text-[9px] font-mono text-zinc-600">vela</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
          <span className="text-[9px] font-mono text-zinc-600">whisper</span>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && (
          <p className="text-xs font-mono text-zinc-600 animate-pulse">Cargando...</p>
        )}
        {!loading && sessions.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16">
            <p className="text-xs font-mono text-zinc-600">Sin sesiones guardadas todavía.</p>
            <p className="text-[10px] font-mono text-zinc-700">
              Las sesiones guardadas con "Guardar sesión" aparecerán aquí.
            </p>
          </div>
        )}
        {sessions.map(s => (
          <SessionCard
            key={s.id}
            s={s}
            isOpen={expanded === s.id}
            onToggle={() => setExpanded(prev => prev === s.id ? null : s.id)}
            onDelete={e => void handleDelete(s.id, e)}
            deleting={deleting === s.id}
          />
        ))}
      </div>
    </div>
  );
}
