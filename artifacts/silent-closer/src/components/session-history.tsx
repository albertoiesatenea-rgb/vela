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
  totalCostUsd: number | null;
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
    // Always prefer the canonical log
    triggerDownload(s.canonicalLogMd, s.id);
  } else {
    // Legacy/partial session — prepend explicit warning
    const header = [
      "> ESTA SESIÓN NO FUE GUARDADA COMO SESIÓN FINAL CANÓNICA",
      `> id: ${s.id}`,
      `> saved_explicitly: ${s.savedExplicitly ? "sí" : "no"}`,
      `> saved_at: ${s.savedAt ?? "null"}`,
      `> canonical_log_md: null`,
      "",
      "",
    ].join("\n");
    triggerDownload(header + buildFallbackLog(s), s.id);
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
  const [auditSubtab, setAuditSubtab] = useState<"comercial" | "vela">("comercial");
  const [ctxExpanded, setCtxExpanded] = useState(false);
  const hasBrief    = !!s.prebriefId;
  const hasBrutal   = !!s.brutalAudit;
  const hasVela     = !!s.velaAudit;
  const hasWhisper  = !!(s.whisperCleanTranscript ?? s.whisperTranscript);
  const hasCanonical = !!s.canonicalLogMd;

  const transcript = s.whisperCleanTranscript ?? s.whisperTranscript;
  const summary    = s.callSummary as Record<string, unknown> | null;
  const tl         = s.timelineSnapshot as Record<string, unknown> | null;
  const cost       = s.costSnapshot as Record<string, unknown> | null;

  // Extract prebrief bundle data stored in sessionSnapshot
  const snap      = s.sessionSnapshot as Record<string, unknown> | null;
  const pbSnap    = snap?.["prebriefBundle"] as Record<string, unknown> | null;
  const briefing  = pbSnap?.["briefing"] as Record<string, unknown> | null;
  const icSnap    = pbSnap?.["interpretedContext"] as Record<string, unknown> | null;

  // Cost
  const costUsd = s.totalCostUsd ?? (cost?.["totalCostUsd"] != null ? Number(cost["totalCostUsd"]) : null);
  const costNoDataReason = !s.sourceSessionId ? "sin source_session_id" : "tracker sin datos";

  // Duration from timeline
  const tlStart = tl?.["session_started_at"] as string | null | undefined;
  const tlEnd   = tl?.["session_ended_at"] as string | null | undefined;
  const durationMin = (tlStart && tlEnd)
    ? ((new Date(tlEnd).getTime() - new Date(tlStart).getTime()) / 60000).toFixed(1)
    : null;

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
                {s.sessionContext ? (
                  <div>
                    <p className="text-[9px] font-mono text-zinc-500 mb-1 tracking-widest uppercase">Contexto confirmado (usado en vivo)</p>
                    <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                      {s.sessionContext}
                    </pre>
                  </div>
                ) : (
                  <p className="text-xs font-mono text-zinc-600">Sin contexto registrado.</p>
                )}

                {/* Interpreted context detail from prebrief — expandable */}
                {icSnap && (
                  <div className="border-t border-zinc-800/50 pt-2">
                    <button
                      onClick={() => setCtxExpanded(v => !v)}
                      className="text-[9px] font-mono text-zinc-500 hover:text-zinc-300 tracking-widest uppercase transition-colors"
                    >
                      {ctxExpanded ? "▾" : "▸"} Contexto interpretado
                    </button>
                    {ctxExpanded && (
                      <div className="mt-2 flex flex-col gap-1">
                        {!!icSnap["detected_phase"]     && <Row label="Fase detectada"     value={String(icSnap["detected_phase"])} />}
                        {!!icSnap["call_type"]           && <Row label="Tipo de llamada"    value={String(icSnap["call_type"])} />}
                        {!!icSnap["today_decision"]      && <Row label="Decisión hoy"       value={String(icSnap["today_decision"])} />}
                        {!!icSnap["valid_outcome_today"] && <Row label="Outcome válido hoy" value={String(icSnap["valid_outcome_today"])} />}
                        {Array.isArray(icSnap["special_context_flags"]) && (icSnap["special_context_flags"] as string[]).length > 0 && (
                          <div>
                            <p className="text-[9px] font-mono text-zinc-600 mb-0.5">Flags</p>
                            {(icSnap["special_context_flags"] as string[]).map((f, i) => (
                              <p key={i} className="text-[11px] font-mono text-zinc-500">· {f}</p>
                            ))}
                          </div>
                        )}
                        {Array.isArray(icSnap["decision_constraints"]) && (icSnap["decision_constraints"] as string[]).length > 0 && (
                          <div>
                            <p className="text-[9px] font-mono text-zinc-600 mb-0.5">Constraints</p>
                            {(icSnap["decision_constraints"] as string[]).map((c, i) => (
                              <p key={i} className="text-[11px] font-mono text-zinc-500">· {c}</p>
                            ))}
                          </div>
                        )}
                        {Array.isArray(icSnap["case_specific_risks"]) && (icSnap["case_specific_risks"] as string[]).length > 0 && (
                          <div>
                            <p className="text-[9px] font-mono text-zinc-600 mb-0.5">Riesgos</p>
                            {(icSnap["case_specific_risks"] as string[]).map((r, i) => (
                              <p key={i} className="text-[11px] font-mono text-zinc-500">· {r}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
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
                        <p className="text-zinc-300">{String(summary["globalState"] ?? "—")}</p>
                      </div>
                      <div>
                        <p className="text-zinc-600 text-[9px]">Resultado</p>
                        <p className="text-zinc-300 truncate">{String(summary["resultLabel"] ?? "—")}</p>
                      </div>
                    </div>
                    {Array.isArray(summary["strengths"]) && (summary["strengths"] as string[]).length > 0 && (
                      <div className="mt-2">
                        <p className="text-[9px] font-mono text-teal-600 mb-1">FUNCIONÓ</p>
                        {(summary["strengths"] as string[]).map((x, i) => (
                          <p key={i} className="text-[11px] font-mono text-zinc-400">→ {x}</p>
                        ))}
                      </div>
                    )}
                    {Array.isArray(summary["improvements"]) && (summary["improvements"] as string[]).length > 0 && (
                      <div className="mt-2">
                        <p className="text-[9px] font-mono text-amber-600 mb-1">MEJORAR</p>
                        {(summary["improvements"] as string[]).map((x, i) => (
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
                ) : briefing ? (
                  <div className="flex flex-col gap-2.5">
                    {!!briefing["real_call_goal"] && (
                      <div>
                        <p className="text-[9px] font-mono text-zinc-500 mb-0.5 tracking-widest uppercase">Objetivo real</p>
                        <p className="text-xs font-mono text-zinc-200 leading-relaxed">{String(briefing["real_call_goal"])}</p>
                      </div>
                    )}
                    {!!briefing["must_get_today"] && (
                      <div>
                        <p className="text-[9px] font-mono text-zinc-500 mb-0.5 tracking-widest uppercase">Conseguir hoy</p>
                        <p className="text-xs font-mono text-zinc-200 leading-relaxed">{String(briefing["must_get_today"])}</p>
                      </div>
                    )}
                    {Array.isArray(briefing["expected_objections"]) && (briefing["expected_objections"] as string[]).length > 0 && (
                      <div>
                        <p className="text-[9px] font-mono text-zinc-500 mb-0.5 tracking-widest uppercase">Objeciones esperadas</p>
                        {(briefing["expected_objections"] as string[]).map((o, i) => (
                          <p key={i} className="text-[11px] font-mono text-zinc-400 leading-snug">— {o}</p>
                        ))}
                      </div>
                    )}
                    {!!briefing["suggested_opening"] && (
                      <div>
                        <p className="text-[9px] font-mono text-zinc-500 mb-0.5 tracking-widest uppercase">Apertura sugerida</p>
                        <p className="text-xs font-mono text-zinc-300 italic leading-relaxed">{String(briefing["suggested_opening"])}</p>
                      </div>
                    )}
                    {!!briefing["suggested_next_step_close"] && (
                      <div>
                        <p className="text-[9px] font-mono text-zinc-500 mb-0.5 tracking-widest uppercase">Cierre / siguiente paso</p>
                        <p className="text-xs font-mono text-zinc-300 italic leading-relaxed">{String(briefing["suggested_next_step_close"])}</p>
                      </div>
                    )}
                    {!!briefing["brief_for_live"] && (
                      <div>
                        <p className="text-[9px] font-mono text-zinc-500 mb-0.5 tracking-widest uppercase">Brief en vivo</p>
                        <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto border border-zinc-800/50 rounded p-2">
                          {String(briefing["brief_for_live"])}
                        </pre>
                      </div>
                    )}
                    <div className="border-t border-zinc-800/50 pt-1">
                      <Row label="Prebrief ID" value={s.prebriefId} />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <Row label="Prebrief ID" value={s.prebriefId} />
                    <p className="text-[11px] font-mono text-amber-700 mt-1">
                      {!pbSnap
                        ? "Prebrief linkado pero no empaquetado en snapshot — guardado antes de v2."
                        : "Prebrief linkado pero sin datos de briefing en snapshot."}
                    </p>
                  </div>
                )}
              </>
            )}

            {/* TRANSCRIPTOS */}
            {tab === "transcriptos" && (
              <>
                {/* Comparison stats */}
                {(transcript || s.whisperRawTranscript || s.webSpeechTranscript) && (
                  <div className="flex gap-3 text-[9px] font-mono text-zinc-600 border-b border-zinc-800/50 pb-2 mb-1">
                    <span>Whisper limpio: {transcript ? `${transcript.length} chars` : "—"}</span>
                    <span>Whisper bruto: {s.whisperRawTranscript ? `${s.whisperRawTranscript.length} chars` : "—"}</span>
                    <span>Web Speech: {s.webSpeechTranscript ? `${s.webSpeechTranscript.length} chars` : "—"}</span>
                  </div>
                )}
                {transcript && (
                  <div>
                    <p className="text-[9px] font-mono text-teal-600 mb-1 tracking-widest uppercase">
                      Whisper limpio{hasCanonical ? " · fuente de verdad" : ""}
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
                {/* Subtabs */}
                <div className="flex gap-0 border-b border-zinc-800/50 -mx-4 px-4 mb-3">
                  {(["comercial", "vela"] as const).map(st => (
                    <button
                      key={st}
                      onClick={() => setAuditSubtab(st)}
                      className={cn(
                        "px-3 py-1.5 text-[9px] font-mono tracking-widest uppercase border-b-2 transition-colors",
                        auditSubtab === st
                          ? "border-zinc-300 text-zinc-200"
                          : "border-transparent text-zinc-600 hover:text-zinc-400"
                      )}
                    >
                      {st === "comercial" ? "Comercial" : "VELA"}
                      {st === "comercial" && hasBrutal && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-red-500 inline-block align-middle" />}
                      {st === "vela"      && hasVela   && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-sky-500 inline-block align-middle" />}
                    </button>
                  ))}
                </div>

                {/* Comercial subtab */}
                {auditSubtab === "comercial" && (
                  s.brutalAudit ? (
                    <div className="flex flex-col gap-2">
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
                    <p className="text-xs font-mono text-zinc-600">Sin auditoría comercial.</p>
                  )
                )}

                {/* VELA subtab */}
                {auditSubtab === "vela" && (
                  s.velaAudit ? (
                    <div className="flex flex-col gap-2">
                      {s.velaAudit.verdict && (
                        <div>
                          <p className="text-[9px] font-mono text-zinc-600 mb-0.5">Veredicto</p>
                          <p className="text-xs font-mono text-zinc-300 leading-relaxed">{s.velaAudit.verdict}</p>
                        </div>
                      )}
                      <pre className="text-[10px] font-mono text-zinc-600 whitespace-pre-wrap max-h-56 overflow-y-auto border border-zinc-800/50 rounded p-2">
                        {JSON.stringify(s.velaAudit, null, 2)}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-xs font-mono text-zinc-600">Sin auditoría VELA.</p>
                  )
                )}
              </>
            )}

            {/* SISTEMA */}
            {tab === "sistema" && (() => {
              const costSnap2 = s.costSnapshot as Record<string, unknown> | null;
              const costReasonStr = costUsd == null
                ? (costSnap2?.["reason"] ? String(costSnap2["reason"]) : costNoDataReason)
                : null;
              return (
              <div className="flex flex-col gap-1.5">
                {/* Validez — los 5 campos requeridos */}
                <div className="flex flex-col gap-1 border border-zinc-800/50 rounded p-2 mb-1">
                  <p className="text-[9px] font-mono text-zinc-500 tracking-widest uppercase mb-0.5">Validez sesión</p>
                  <Row label="saved_explicitly"  value={s.savedExplicitly ? "sí ✓" : "no ✗"} />
                  <Row label="saved_at"          value={s.savedAt ? `${fmtDate(s.savedAt)} ✓` : "null ✗"} />
                  <Row label="canonical_log_md"  value={s.canonicalLogMd ? `sí — ${(s.canonicalLogMd.length / 1024).toFixed(1)} KB ✓` : "null ✗"} />
                  <Row label="session_snapshot"  value={s.sessionSnapshot ? "sí ✓" : "null ✗"} />
                  <Row label="timeline_snapshot" value={s.timelineSnapshot ? "sí ✓" : "null ✗"} />
                </div>

                {/* Cost */}
                <div className="flex flex-col gap-1 border border-zinc-800/50 rounded p-2 mb-1">
                  <p className="text-[9px] font-mono text-zinc-500 tracking-widest uppercase mb-0.5">Coste sesión</p>
                  <Row label="Total USD"
                    value={costUsd != null ? `$${costUsd.toFixed(6)}` : `no disponible — ${costReasonStr ?? costNoDataReason}`} />
                  <Row label="Total EUR"
                    value={costUsd != null ? `~€${(costUsd * 0.93).toFixed(4)} (estimado)` : "—"} />
                  {costSnap2?.["calls"]       != null && <Row label="Llamadas API"   value={String(costSnap2["calls"])} />}
                  {costSnap2?.["totalTokens"] != null && <Row label="Tokens totales" value={String(costSnap2["totalTokens"])} />}
                </div>

                <Row label="DB id"           value={s.id} />
                <Row label="source_session"  value={s.sourceSessionId} />
                <Row label="prebrief_id"     value={s.prebriefId} />
                {durationMin && <Row label="Duración (min)" value={durationMin} />}
                <Row label="Brain"           value={s.brainId} />

                {tl && (
                  <div className="border-t border-zinc-800/50 pt-2 mt-1 flex flex-col gap-1">
                    <p className="text-[9px] font-mono text-zinc-600 tracking-widest uppercase">Timeline</p>
                    <Row label="Sesión iniciada"    value={fmtTime((tl as Record<string,string>)["session_started_at"])} />
                    <Row label="Sesión terminada"   value={fmtTime((tl as Record<string,string>)["session_ended_at"])} />
                    <Row label="Prebrief creado"    value={fmtTime((tl as Record<string,string>)["prebrief_created_at"])} />
                    <Row label="Briefing listo"     value={fmtTime((tl as Record<string,string>)["prebrief_briefing_ready_at"])} />
                    <Row label="Whisper bruto"      value={fmtTime((tl as Record<string,string>)["whisper_raw_ready_at"])} />
                    <Row label="Whisper limpio"     value={fmtTime((tl as Record<string,string>)["whisper_clean_ready_at"])} />
                    <Row label="Summary listo"      value={fmtTime((tl as Record<string,string>)["summary_ready_at"])} />
                    <Row label="Brutal audit"       value={fmtTime((tl as Record<string,string>)["brutal_audit_ready_at"])} />
                    <Row label="VELA audit"         value={fmtTime((tl as Record<string,string>)["vela_audit_ready_at"])} />
                    <Row label="Guardado en DB"     value={fmtTime((tl as Record<string,string>)["saved_at"])} />
                  </div>
                )}
              </div>
              );
            })()}
          </div>

          {/* Download footer */}
          <div className="px-4 pb-3 flex justify-end items-center gap-2">
            {!s.canonicalLogMd && (
              <span className="text-[8px] font-mono text-amber-700 border border-amber-900/50 rounded px-1.5 py-0.5 shrink-0">
                parcial
              </span>
            )}
            <button
              onClick={() => downloadSession(s)}
              className={cn(
                "flex items-center gap-1.5 text-[9px] font-mono transition-colors border rounded-full px-2.5 py-1",
                s.canonicalLogMd
                  ? "text-zinc-600 hover:text-zinc-300 border-zinc-800"
                  : "text-amber-700 hover:text-amber-500 border-amber-900/50"
              )}
            >
              <Download className="w-3 h-3" />
              {s.canonicalLogMd ? "Descargar log canónico" : "Descargar log (parcial)"}
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
