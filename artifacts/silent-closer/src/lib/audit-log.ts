/**
 * VELA — Unified Audit Log System
 *
 * Produces forensic, audit-ready markdown logs for both Copiloto and Arena modes.
 * Compatible with the VELA Auditor GPT without additional explanation.
 *
 * Pipeline: raw session data → buildCopilotAuditLog / buildArenaAuditLog
 *           → AuditLog typed object → renderAuditLogMarkdown → .md file
 */

// ── Brand name — single source of truth ─────────────────────────────────────
// Change only here to propagate to all user-visible outputs (audit logs,
// clipboard exports, session reports). Do NOT source the brand name from
// .agents/agent_assets_metadata.toml or legacy file names (closer-wizard-*)
// — those are file-system asset references, not branding sources.
export const BRAND_NAME = "VELA" as const;

export type AppMode = "copilot" | "arena";
export type AuditLang = "es" | "en";
export type ResponseStatus = "ok" | "error" | "partial" | "pending";

// ── Typed audit log structure ────────────────────────────────────────────────

export interface SessionMeta {
  app_mode: AppMode;
  session_id: string | null;
  exported_at: string;
  app_version: string;
  model: string;
  lang: AuditLang;
  ui_mode: string | null;
  source_mode: string | null;
  speaker_mode_default: string | null;
  role_in_arena: string | null;
  context_label: string | null;
  session_status: string;
}

export interface SessionContext {
  raw_context: string;
  objective: string | null;
  known_objections: string[] | null;
  relevant_data: string | null;
}

export interface SessionConfig {
  input_mode: string | null;
  speaker_mode_default: string | null;
  arena_role: string | null;
  arena_variant: string | null;
  arena_state_model: string | null;
  runtime_instructions: string[] | null;
}

export interface CopilotTurnData {
  signal: string | null;
  say_now: string | null;
  avoid: string | null;
  reading: string | null;
  mission: string | null;
  next_move: string | null;
  support: string | null;
  journey_past: string | null;
  journey_now: string | null;
  journey_next: string | null;
  momentum: string | null;
  memory_after: string[];
  why_this_turn_exists: string | null;
}

export interface CoachLiteFields {
  signal: string;
  reading: string;
  mission: string;
  next_move: string;
  strategy: string;
  why_this_response: string;
  alternative: string;
}

export interface ArenaTurnCoach {
  explanation: string;
  fields?: CoachLiteFields;
}

export interface ArenaTurnJourney {
  stages: Record<string, string>;
  now_help?: string;
  next_help?: string;
  premature_close_risk?: string;
}

export interface ArenaTurnData {
  arena_role_of_user: string;
  ai_role_this_turn: string;
  user_message: string | null;
  user_message_origin?: MessageOrigin;
  ai_message: string | null;
  conversation_state_before: string | null;
  conversation_state_after: string | null;
  terminal_state_detected: "yes" | "no";
  terminal_state_type: string | null;
  terminal_state_source: string | null;
  tension_or_momentum: string | null;
  hidden_reasoning_summary: string | null;
  coach?: ArenaTurnCoach;
  journey?: ArenaTurnJourney;
}

export interface AuditTurn {
  turn_index: number;
  timestamp: string;
  mode: AppMode;
  source_mode: string | null;
  speaker_mode: string | null;
  raw_input: string | null;
  normalized_input: string | null;
  inferred_speaker: string | null;
  memory_before: string[];
  model_request_summary: string | null;
  model_output_raw: string | null;
  response_status: ResponseStatus;
  parse_error: string | null;
  notes: string | null;
  copilot?: CopilotTurnData;
  arena?: ArenaTurnData;
}

export interface SpeakerSessionMetricsForLog {
  total: number;
  unknown_rate: number;
  avg_confidence: number;
  high_conf_rate: number;
  low_conf_rate: number;
  carryover_rate: number;
  auto_reassigned_count: number;
  ai_retropass_reclassified_count?: number;
}

export interface SessionSummary {
  final_outcome: string | null;
  final_outcome_source: string;
  final_score: number | null;
  final_global_state: string | null;
  final_result_label: string | null;
  final_momentum_or_state: string | null;
  total_turns: number;
  total_user_turns: number | null;
  total_ai_turns: number | null;
  session_end_reason: string | null;
  strongest_moment: string | null;
  weakest_moment: string | null;
  unresolved_objections: string[] | null;
  missed_closing_window: string | null;
  final_call_memory: string[];
  strengths: string[];
  improvements: string[];
  full_report: string | null;
  speaker_session_metrics?: SpeakerSessionMetricsForLog;
}

export interface AuditHints {
  likely_primary_failure: string;
  suspected_prompt_issue: "yes" | "no";
  suspected_ui_issue: "yes" | "no";
  suspected_support_gap: "yes" | "no";
  suspected_close_timing_issue: "yes" | "no";
  suspected_repetition_issue: "yes" | "no";
  suspected_claim_risk: "yes" | "no";
  suspected_unresolved_technical_objection: "yes" | "no";
  suspected_false_confidence: "yes" | "no";
  suspected_soft_next_step: "yes" | "no";
  audit_notes: string[];
}

export interface AuditLog {
  meta: SessionMeta;
  context: SessionContext;
  config: SessionConfig;
  turns: AuditTurn[];
  readable_transcript: string[];
  summary: SessionSummary;
  audit_hints: AuditHints;
}

// ── Copilot builder input types ───────────────────────────────────────────────

export interface CopilotTurnEntry {
  turn_index: number;
  timestamp: string;
  source_mode: "listen" | "simulate";
  speaker_mode: "auto" | "client" | "me";
  raw_fragment: string;
  normalized_fragment: string;
  inferred_speaker: string;
  speaker_confidence?: number;
  speaker_source?: "rule" | "carryover" | "manual" | "unknown";
  auto_repaired?: boolean;
  memory_before: string[];
  system_output: {
    signal: string;
    say_now: string;
    avoid: string | null;
    detail: { reading: string; mission: string; next_move: string; support: string };
    journey: { past: string; now: string; next: string };
    call_memory: string[];
    momentum: string;
  } | null;
  memory_after: string[];
  response_status: ResponseStatus;
  parse_error: string | null;
  notes: string | null;
}

export interface CopilotStructuredContext {
  meeting_goal?: string;
  previous_blocker?: string;
  blocker_status?: "open" | "resolved" | "partially_resolved";
  what_not_to_do_today?: string;
  desired_deliverable_today?: string;
}

export interface CopilotSessionData {
  sessionId: string | null;
  lang: AuditLang;
  sessionContext: string | null;
  contextLabel: string | null;
  speakerMode: string;
  inputModeUsed: string;
  callOutcome: string | null;
  callSummary: {
    score: number;
    globalState: string;
    resultLabel: string;
    strengths: string[];
    improvements: string[];
    fullReport?: string;
  } | null;
  turnLog: CopilotTurnEntry[];
  finalMemory: string[];
  structuredContext?: CopilotStructuredContext;
  speakerSessionMetrics?: SpeakerSessionMetricsForLog;
}

// ── Arena builder input types ─────────────────────────────────────────────────

export type MessageOrigin = "manual" | "suggest_accepted" | "suggest_edited" | "shortcut_generated" | "unknown";

export interface ArenaMessageEntry {
  index: number;
  speaker: "user" | "ai" | "note";
  message: string;
  message_origin?: MessageOrigin;
}

export interface ArenaCoachEntry {
  explanation: string;
  fields?: CoachLiteFields;
  journey?: {
    stages: Record<string, string>;
    now_help?: string;
    next_help?: string;
    premature_close_risk?: string;
  };
}

export interface ArenaStructuredContext {
  meeting_goal?: string;
  main_blocker?: string;
  blocker_status?: "open" | "partial" | "resolved";
  what_not_to_do?: string;
  valid_outcome_today?: string;
  known_context_notes?: string;
}

export interface ArenaSessionData {
  sessionId: string | null;
  lang: AuditLang;
  role: "seller" | "client";
  context: string;
  outcome: string;
  outcomeSource: "user" | "ai" | "system" | "mixed";
  totalTurns: number;
  userTurns: number;
  createdAt: string;
  closedAt: string;
  allMessages: ArenaMessageEntry[];
  exitNote: { text: string; outcome: string } | null;
  debrief: { score: number; critique: string[] } | null;
  runtimeInstructions?: string[];
  // Coach and journey data keyed by AI message index (optional — absent in old sessions)
  coachLiteMap?: Record<number, ArenaCoachEntry>;
  arenaStructuredContext?: ArenaStructuredContext;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function nul(v: string | null | undefined): string {
  return (v != null && v !== "") ? v : "null";
}

function yesno(v: boolean): "yes" | "no" {
  return v ? "yes" : "no";
}

function listLines(items: string[]): string {
  return items.length === 0 ? "- null" : items.map(i => `- ${i}`).join("\n");
}

function inputModeSummary(turns: CopilotTurnEntry[]): string {
  if (turns.length === 0) return "none";
  const modes = [...new Set(turns.map(t => t.source_mode))];
  return modes.length > 1 ? "mixed" : modes[0];
}

function detectMomentumTrend(turns: CopilotTurnEntry[]): string | null {
  const withMomentum = turns.filter(t => t.system_output?.momentum);
  if (withMomentum.length < 2) return null;
  const first = withMomentum[0].system_output!.momentum;
  const last = withMomentum[withMomentum.length - 1].system_output!.momentum;
  const rank: Record<string, number> = { green: 2, amber: 1, red: 0 };
  const delta = (rank[last] ?? 1) - (rank[first] ?? 1);
  if (delta > 0) return `improving (${first} → ${last})`;
  if (delta < 0) return `declining (${first} → ${last})`;
  return `stable (${last})`;
}

function deriveArenaState(text: string, lang: AuditLang): "favorable" | "tense" | "critical" {
  const lower = text.toLowerCase();
  const critical = lang === "es"
    ? ["no me interesa", "no puedo", "imposible", "demasiado caro", "no voy a", "no lo necesito", "no me convence", "descartado"]
    : ["not interested", "impossible", "way too expensive", "won't do", "don't need", "not convinced", "ruled out"];
  const favorable = lang === "es"
    ? ["interesante", "me gusta", "cuéntame más", "de acuerdo", "vamos adelante", "suena bien", "perfecto", "podría ser"]
    : ["interesting", "i like", "tell me more", "agreed", "let's go", "sounds good", "perfect", "that could be"];
  if (critical.some(kw => lower.includes(kw))) return "critical";
  if (favorable.some(kw => lower.includes(kw))) return "favorable";
  return "tense";
}

// ── Copilot audit log builder ─────────────────────────────────────────────────

export function buildCopilotAuditLog(data: CopilotSessionData): AuditLog {
  const exportedAt = new Date().toISOString();
  const inputModeStr = inputModeSummary(data.turnLog);
  const finalMemory = data.finalMemory;

  // Session meta
  const meta: SessionMeta = {
    app_mode: "copilot",
    session_id: data.sessionId,
    exported_at: exportedAt,
    app_version: "1.0.0",
    model: "gpt-4o",
    lang: data.lang,
    ui_mode: "copilot",
    source_mode: inputModeStr,
    speaker_mode_default: data.speakerMode,
    role_in_arena: null,
    context_label: data.contextLabel || null,
    session_status: data.callOutcome ?? "ended_without_declared_outcome",
  };

  // Context — raw + structural decomposition from structuredContext when available
  const rawCtx = data.sessionContext ?? "(no context provided)";
  const sc = data.structuredContext;
  const context: SessionContext = {
    raw_context: rawCtx,
    objective: sc?.meeting_goal ?? null,
    known_objections: sc?.previous_blocker ? [sc.previous_blocker] : null,
    relevant_data: sc?.desired_deliverable_today ?? null,
  };

  // Config
  const config: SessionConfig = {
    input_mode: inputModeStr,
    speaker_mode_default: data.speakerMode,
    arena_role: null,
    arena_variant: null,
    arena_state_model: null,
    runtime_instructions: null,
  };

  // Turns
  const turns: AuditTurn[] = data.turnLog.map((t) => {
    const o = t.system_output;
    const copilot: CopilotTurnData = {
      signal: o?.signal ?? null,
      say_now: o?.say_now ?? null,
      avoid: o?.avoid ?? null,
      reading: o?.detail?.reading ?? null,
      mission: o?.detail?.mission ?? null,
      next_move: o?.detail?.next_move ?? null,
      support: o?.detail?.support ?? null,
      journey_past: o?.journey?.past ?? null,
      journey_now: o?.journey?.now ?? null,
      journey_next: o?.journey?.next ?? null,
      momentum: o?.momentum ?? null,
      memory_after: t.memory_after,
      why_this_turn_exists: t.source_mode === "listen" ? "auto_listen_batch" : "manual_submit",
    };
    return {
      turn_index: t.turn_index,
      timestamp: t.timestamp,
      mode: "copilot",
      source_mode: t.source_mode,
      speaker_mode: t.speaker_mode,
      raw_input: t.raw_fragment,
      normalized_input: t.normalized_fragment,
      inferred_speaker: t.inferred_speaker,
      memory_before: t.memory_before,
      model_request_summary: `analyze_conversation(speaker_mode=${t.speaker_mode}, fragment_len=${t.raw_fragment.length})`,
      model_output_raw: o ? JSON.stringify(o, null, 2) : null,
      response_status: t.response_status,
      parse_error: t.parse_error,
      notes: t.notes,
      copilot,
    };
  });

  // Readable transcript
  const readable_transcript = data.turnLog.map(t =>
    `[${t.turn_index + 1}] [${t.inferred_speaker}]: ${t.normalized_fragment}`
  );

  // Parse error count for audit hints
  const parseErrors = data.turnLog.filter(t => t.parse_error).length;
  const errorTurns = data.turnLog.filter(t => t.response_status === "error").length;

  // Speaker uncertainty — high UNKNOWN rate in auto mode
  const unknownTurns = data.turnLog.filter(t => t.inferred_speaker === "UNKNOWN").length;
  const unknownRate = data.turnLog.length > 0 ? unknownTurns / data.turnLog.length : 0;
  const hasSpeakerUncertainty = data.speakerMode === "auto" && unknownRate > 0.3 && unknownTurns >= 3;
  const momentumTrend = detectMomentumTrend(data.turnLog);
  const lastMomentum = data.turnLog.length > 0
    ? data.turnLog[data.turnLog.length - 1].system_output?.momentum ?? null
    : null;

  // Detect repetition: consecutive turns with same say_now
  let repetitionCount = 0;
  for (let i = 1; i < data.turnLog.length; i++) {
    const prev = data.turnLog[i - 1].system_output?.say_now;
    const curr = data.turnLog[i].system_output?.say_now;
    if (prev && curr && prev === curr) repetitionCount++;
  }

  const isLost = data.callOutcome === "lost";
  const isUnclear = data.callOutcome === "unclear" || !data.callOutcome;
  const isNextStep = data.callOutcome === "next_step";

  // ── Risk signal heuristics (keyword-based, conservative — labeled "suspected")
  const allMemoryText = finalMemory.join(" ").toLowerCase();
  const allSignals = data.turnLog.map(t => t.system_output?.signal ?? "").join(" ").toLowerCase();
  const allReadings = data.turnLog.map(t => t.system_output?.detail?.reading ?? "").join(" ").toLowerCase();

  // CLAIM_RISK: seller used strong assurance language in memory or signals
  const claimRiskTerms = ["garantía", "certif", "te aseguro", "sin duda", "100% seguro", "completamente seguro", "guarantee", "certified", "i assure", "no risk", "100% safe"];
  const suspectedClaimRisk = claimRiskTerms.some(t => allMemoryText.includes(t));

  // ANALYTICAL_BUYER signals: client asked for data/numbers/methodology
  const analyticalTerms = ["analítico", "analytical", "técnic", "dato", "número", "cifra", "rentabilidad", "metodología", "retorno", "roi", "rendimiento", "tasa", "evidencia", "data", "numbers", "methodology", "return"];
  const hasAnalyticalSignal = analyticalTerms.some(t => allSignals.includes(t) || allReadings.includes(t) || allMemoryText.includes(t));

  // UNRESOLVED_TECHNICAL_OBJ: next_step outcome + analytical signals + no "resolved" indicator in memory
  const suspectedUnresolvedTechnical = isNextStep && hasAnalyticalSignal &&
    !allMemoryText.includes("resuel") && !allMemoryText.includes("resolved") &&
    !allMemoryText.includes("confirmad") && !allMemoryText.includes("confirmed");

  // FALSE_CONFIDENCE: official/regulatory/audit used as argument in memory
  const falseConfidenceTerms = ["certif", "homolog", "regulad", "oficial", "certificate", "certified", "regulated", "official", "auditoría", "audit"];
  const suspectedFalseConfidence = falseConfidenceTerms.some(t => allMemoryText.includes(t));

  // NEXT_STEP_QUALITY — 3-level classifier for next_step outcomes
  // Operative commitment: date/time, concrete channel, or concrete deliverable
  const dateTimeTerms = ["fecha", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo", "mañana", "pasado", "próxima semana", "próximo", "esta semana", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "tomorrow", "next week", ":00", " am ", " pm ", "a las ", "at "];
  const channelTerms = ["videollamada", "videoconferencia", "video call", "video-call", "zoom", "teams", "google meet", "meet ", "correo", "e-mail", "email", "convocatoria", "enlace", "link", "reunión", "reunion", "meeting", "llamada"];
  const deliverableTerms = ["resumen", "propuesta", "contrato", "documentación", "documentacion", "información", "summary", "proposal", "contract", "documentation", "agenda", "informe", "report", "presupuesto", "oferta", "dossier"];
  const decisionCriterionTerms = ["criterio", "condición", "condition", "criterion", "acordad", "agreed", "compromi", "commit"];

  const hasDateTime = dateTimeTerms.some(t => allMemoryText.includes(t));
  const hasChannel  = channelTerms.some(t => allMemoryText.includes(t));
  const hasDeliverable = deliverableTerms.some(t => allMemoryText.includes(t));
  const hasOperativeCommitment = hasDateTime || hasChannel || hasDeliverable;
  const hasDecisionCriterion = decisionCriterionTerms.some(t => allMemoryText.includes(t));

  type NextStepQuality = "strong" | "useful" | "weak";
  const nextStepQuality: NextStepQuality | null = isNextStep
    ? (hasOperativeCommitment && hasDecisionCriterion ? "strong"
      : hasOperativeCommitment ? "useful"
      : "weak")
    : null;

  // SOFT_NEXT_STEP: only when next_step quality is WEAK (no operative commitment at all)
  const suspectedSoftNextStep = isNextStep && nextStepQuality === "weak";

  // Summary
  const summary: SessionSummary = {
    final_outcome: data.callOutcome,
    final_outcome_source: data.callOutcome ? "user" : "system",
    final_score: data.callSummary?.score ?? null,
    final_global_state: data.callSummary?.globalState ?? null,
    final_result_label: data.callSummary?.resultLabel ?? null,
    final_momentum_or_state: momentumTrend ?? lastMomentum ?? null,
    total_turns: data.turnLog.length,
    total_user_turns: data.turnLog.filter(t => ["YO", "ME"].includes(t.inferred_speaker)).length,
    total_ai_turns: null,
    session_end_reason: data.callOutcome
      ? `user_declared_outcome: ${data.callOutcome}`
      : "no_outcome_declared",
    strongest_moment: null,
    weakest_moment: null,
    unresolved_objections: null,
    missed_closing_window: null,
    final_call_memory: finalMemory,
    strengths: data.callSummary?.strengths ?? [],
    improvements: data.callSummary?.improvements ?? [],
    full_report: data.callSummary?.fullReport ?? null,
    speaker_session_metrics: data.speakerSessionMetrics,
  };

  // Audit hints
  const auditNotes: string[] = [];
  if (parseErrors > 0) auditNotes.push(`${parseErrors} turn(s) had JSON parse errors — model output format may be unstable`);
  if (errorTurns > 0) auditNotes.push(`${errorTurns} turn(s) had API errors — check network or token budget`);
  if (repetitionCount > 1) auditNotes.push(`${repetitionCount} consecutive turns produced the same say_now — possible prompt loop`);
  if (isLost) auditNotes.push("outcome=lost — audit closing technique and objection handling");
  if (isUnclear) auditNotes.push("no outcome declared — session may have ended prematurely");
  if (lastMomentum === "red") auditNotes.push("final momentum was RED — conversation ended in a low-energy state");
  if (data.turnLog.length === 0) auditNotes.push("no turns recorded — session may have started but analysis never ran");
  if (suspectedClaimRisk) auditNotes.push("CLAIM_RISK detected — seller may have used assurance language without concrete evidence");
  if (suspectedUnresolvedTechnical) auditNotes.push("UNRESOLVED_TECHNICAL_OBJ detected — technical objection may have been deferred without in-call resolution");
  if (suspectedFalseConfidence) auditNotes.push("FALSE_CONFIDENCE detected — certification or official body may have been used as definitive proof");
  if (nextStepQuality === "strong") auditNotes.push("NEXT_STEP_QUALITY strong — operative commitment (date/channel/deliverable) + explicit decision criterion detected");
  if (nextStepQuality === "useful") auditNotes.push("NEXT_STEP_QUALITY useful — operative commitment agreed (date, channel, or concrete deliverable) without explicit decision criterion for next call");
  if (suspectedSoftNextStep) auditNotes.push("SOFT_NEXT_STEP detected — next step has no detected operative commitment (no date, no channel, no deliverable)");
  if (hasSpeakerUncertainty) auditNotes.push(`SPEAKER_UNCERTAINTY detected — ${unknownTurns} of ${data.turnLog.length} turns were UNKNOWN in auto mode (${Math.round(unknownRate * 100)}%). Tactical reads may be contaminated. Causal conclusions about conversational control should be treated with lower confidence. Consider using CLIENTE/YO attribution in future sessions.`);

  const hints: AuditHints = {
    likely_primary_failure: isLost ? "seller" : errorTurns > 0 ? "technical" : parseErrors > 0 ? "system" : "none",
    suspected_prompt_issue: yesno(parseErrors > 1 || repetitionCount > 2),
    suspected_ui_issue: "no",
    suspected_support_gap: yesno(isLost),
    suspected_close_timing_issue: yesno(isLost || lastMomentum === "amber"),
    suspected_repetition_issue: yesno(repetitionCount > 1),
    suspected_claim_risk: yesno(suspectedClaimRisk),
    suspected_unresolved_technical_objection: yesno(suspectedUnresolvedTechnical),
    suspected_false_confidence: yesno(suspectedFalseConfidence),
    suspected_soft_next_step: yesno(suspectedSoftNextStep),
    audit_notes: auditNotes.length > 0 ? auditNotes : ["no anomalies detected in this session"],
  };

  return { meta, context, config, turns, readable_transcript, summary, audit_hints: hints };
}

// ── Arena audit log builder ───────────────────────────────────────────────────

export function buildArenaAuditLog(data: ArenaSessionData): AuditLog {
  const exportedAt = new Date().toISOString();
  const aiRole = data.role === "seller" ? "client" : "seller";

  const meta: SessionMeta = {
    app_mode: "arena",
    session_id: data.sessionId,
    exported_at: exportedAt,
    app_version: "1.0.0",
    model: "gpt-4o",
    lang: data.lang,
    ui_mode: "arena",
    source_mode: "chat",
    speaker_mode_default: null,
    role_in_arena: data.role,
    context_label: null,
    session_status: data.outcome,
  };

  const sc = data.arenaStructuredContext;
  const context: SessionContext = {
    raw_context: data.context || "(no context provided)",
    objective: sc?.meeting_goal ?? null,
    known_objections: sc?.main_blocker
      ? `${sc.main_blocker}${sc.blocker_status ? ` [${sc.blocker_status}]` : ""}`
      : null,
    relevant_data: [
      sc?.what_not_to_do ? `no_do: ${sc.what_not_to_do}` : null,
      sc?.valid_outcome_today ? `valid_outcome: ${sc.valid_outcome_today}` : null,
      sc?.known_context_notes ? `notes: ${sc.known_context_notes}` : null,
    ].filter(Boolean).join(" | ") || null,
  };

  // ── Auto-detect enforcement blocks from session context ────────────────────
  // When the context contains advanced objection / comparison / phase markers,
  // the server has injected enforcement blocks into the system prompt.
  // Report them as runtime_instructions so the audit log shows
  // `runtime_instructions_active: yes` instead of `no`.
  const ctxLower = (data.context || "").toLowerCase();
  const enforcementBlocks: string[] = [];
  const hasRentComparison = ["rentabilidad", "renta baja", "alquiler bajo", "yield", "rent low",
    "2,", "3,", "4,", "%", "media de zona", "portal", "idealista", "fotocasa"].some(t => ctxLower.includes(t));
  const hasPhaseMarkers = ["segunda llamada", "follow-up", "seguimiento", "cierre", "reserva",
    "second call", "closing", "reservation"].some(t => ctxLower.includes(t));
  const hasCompetitorComparison = ["alternativa", "competidor", "berlín", "berlin", "budapest",
    "valencia", "alternative", "competitor"].some(t => ctxLower.includes(t));
  const hasConcreteObjection = ["cashflow", "cash flow", "flujo de caja", "objeción", "bloqueo",
    "freno", "no encaja", "no cuadra", "objection", "blocker"].some(t => ctxLower.includes(t));
  if (hasRentComparison || hasConcreteObjection) {
    enforcementBlocks.push("concrete-objection-engine: ACTIVE — 4-step sequence (respond → isolate → measure → advance)");
    enforcementBlocks.push("concrete-comparison-engine: ACTIVE — rent/yield disaggregation (contract vs market, gross vs net, price vs capital)");
    enforcementBlocks.push("false-dichotomy-guard: ACTIVE — prevents re-asking settled frames");
    enforcementBlocks.push("anti-premature-disqualification: ACTIVE — requires response-isolate-measure before disqualifying");
  }
  if (hasPhaseMarkers) {
    enforcementBlocks.push("grounding-and-phase-block: ACTIVE — follow-up/close phase detected, discovery re-opening forbidden");
  }
  if (hasCompetitorComparison) {
    enforcementBlocks.push("comparison-frame-engine: ACTIVE — competitor/alternative detected");
  }

  const userProvided = data.runtimeInstructions && data.runtimeInstructions.length > 0
    ? data.runtimeInstructions
    : [];
  const allRuntimeInstructions = [...userProvided, ...enforcementBlocks];

  const config: SessionConfig = {
    input_mode: "chat",
    speaker_mode_default: null,
    arena_role: data.role,
    arena_variant: null,
    arena_state_model: "keyword_heuristic + gpt-4o-mini + enforcement-blocks",
    runtime_instructions: allRuntimeInstructions.length > 0 ? allRuntimeInstructions : null,
  };

  // Build exchange-based turns — group messages as AI-open + user + AI-response triplets
  // Flat approach: one AuditTurn per message, richer cross-referencing
  const turns: AuditTurn[] = [];
  const msgs = data.allMessages.filter(m => m.speaker !== "note");

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const isUserMsg = msg.speaker === "user";
    const prevMsg = i > 0 ? msgs[i - 1] : null;
    const nextMsg = i < msgs.length - 1 ? msgs[i + 1] : null;

    // Derive state using keyword heuristic on the message text
    const stateBefore = prevMsg
      ? deriveArenaState(prevMsg.message, data.lang)
      : "tense";
    const stateAfter = deriveArenaState(msg.message, data.lang);

    // Is this the last message and does the outcome indicate terminal state?
    const isLast = i === msgs.length - 1;
    const terminalOutcomes = ["closed", "next_step", "lost", "broken"];
    const isTerminal = isLast && terminalOutcomes.includes(data.outcome);

    // hidden_reasoning_summary — honest about what's available client-side
    let hiddenReasoning: string | null = null;
    if (!isUserMsg) {
      if (stateAfter === "critical") {
        hiddenReasoning = "AI detected high resistance in previous message — response aimed at de-escalation or objection handling";
      } else if (stateAfter === "favorable") {
        hiddenReasoning = "AI detected positive signal — response reinforced momentum and advanced the conversation";
      } else {
        hiddenReasoning = "AI responded to neutral/tense context — attempting to build rapport or present value";
      }
      if (isTerminal && data.outcome === "closed") {
        hiddenReasoning = "AI detected closing signal — response attempted to consolidate the close";
      } else if (isTerminal && data.outcome === "lost") {
        hiddenReasoning = "Conversation reached terminal loss state — AI was unable to overcome objections";
      }
    }

    // Attach coach / journey if available for this AI message
    const coachEntry = !isUserMsg && data.coachLiteMap ? data.coachLiteMap[msg.index] : undefined;

    const arena: ArenaTurnData = {
      arena_role_of_user: data.role,
      ai_role_this_turn: aiRole,
      user_message: isUserMsg ? msg.message : (prevMsg?.speaker === "user" ? prevMsg.message : null),
      user_message_origin: isUserMsg ? msg.message_origin : (prevMsg?.speaker === "user" ? prevMsg.message_origin : undefined),
      ai_message: !isUserMsg ? msg.message : (nextMsg?.speaker === "ai" ? nextMsg.message : null),
      conversation_state_before: stateBefore,
      conversation_state_after: stateAfter,
      terminal_state_detected: yesno(isTerminal),
      terminal_state_type: isTerminal ? data.outcome : null,
      terminal_state_source: isTerminal ? data.outcomeSource : null,
      tension_or_momentum: stateAfter,
      hidden_reasoning_summary: hiddenReasoning,
      coach: coachEntry ? { explanation: coachEntry.explanation, fields: coachEntry.fields } : undefined,
      journey: coachEntry?.journey ? {
        stages: coachEntry.journey.stages as Record<string, string>,
        now_help: coachEntry.journey.now_help,
        next_help: coachEntry.journey.next_help,
        premature_close_risk: coachEntry.journey.premature_close_risk,
      } : undefined,
    };

    turns.push({
      turn_index: i,
      timestamp: data.createdAt,
      mode: "arena",
      source_mode: "chat",
      speaker_mode: msg.speaker === "user" ? data.role : aiRole,
      raw_input: isUserMsg ? msg.message : null,
      normalized_input: isUserMsg ? msg.message : null,
      inferred_speaker: msg.speaker === "user"
        ? (data.role === "seller" ? "SELLER" : "CLIENT")
        : (aiRole === "seller" ? "AI_SELLER" : "AI_CLIENT"),
      memory_before: [],
      model_request_summary: !isUserMsg
        ? `arena_turn(role=${aiRole}, history_len=${i}, lang=${data.lang})`
        : null,
      model_output_raw: !isUserMsg ? msg.message : null,
      response_status: "ok",
      parse_error: null,
      notes: i === 0 && !isUserMsg ? "AI opened the conversation" : null,
      arena,
    });
  }

  // Readable transcript — includes note injections inline at the point they occurred
  const allMsgsWithNotes = data.allMessages;
  let conversationTurnNum = 0;
  const readable_transcript: string[] = [];
  for (const m of allMsgsWithNotes) {
    if (m.speaker === "note") {
      readable_transcript.push(`[→ INSTRUCCIÓN AL VENDEDOR]: ${m.message}`);
    } else {
      conversationTurnNum++;
      // Build speaker label — include message origin for seller/user turns when available
      const baseLabel = m.speaker === "user"
        ? (data.role === "seller" ? "VENDEDOR" : "CLIENTE")
        : (aiRole === "seller" ? "IA VENDEDOR" : "IA CLIENTE");
      const originSuffix: string =
        m.speaker === "user" && data.role === "seller" && m.message_origin && m.message_origin !== "unknown"
          ? ` | ${m.message_origin}`
          : "";
      readable_transcript.push(`[${conversationTurnNum}] [${baseLabel}${originSuffix}]: ${m.message}`);
    }
  }

  // Derive final state from last AI message
  const lastAiMsg = [...msgs].reverse().find(m => m.speaker === "ai");
  const finalState = lastAiMsg ? deriveArenaState(lastAiMsg.message, data.lang) : null;

  const aiTurns = msgs.filter(m => m.speaker === "ai").length;
  const isLost = ["lost", "broken"].includes(data.outcome);
  const isClosed = data.outcome === "closed";

  // Origin stats — count how seller turns were composed (only in seller mode)
  const userMsgs = msgs.filter(m => m.speaker === "user");
  const originCounts: Record<string, number> = {};
  for (const m of userMsgs) {
    const o = (m as ArenaMessageEntry).message_origin ?? "unknown";
    originCounts[o] = (originCounts[o] ?? 0) + 1;
  }
  const hasOriginData = Object.values(originCounts).some(c => c > 0) &&
    !Object.keys(originCounts).every(k => k === "unknown");

  const auditNotes: string[] = [];
  if (isLost) auditNotes.push(`session ended as "${data.outcome}" — audit objection handling and closing approach`);
  if (isClosed) auditNotes.push("session closed successfully — useful as positive training example");
  if (data.debrief) auditNotes.push(`debrief score: ${data.debrief.score}/10`);
  if (data.exitNote?.text) auditNotes.push(`exit note from user: "${data.exitNote.text}"`);
  if (msgs.length > 20) auditNotes.push("conversation was long (>20 messages) — check for close-timing issues");
  if (data.role === "seller" && hasOriginData) {
    const parts = Object.entries(originCounts)
      .filter(([, c]) => c > 0)
      .map(([k, c]) => `${k}: ${c}`)
      .join(", ");
    auditNotes.push(`message origin breakdown — ${parts}`);
  }

  const summary: SessionSummary = {
    final_outcome: data.outcome,
    final_outcome_source: data.outcomeSource,
    final_score: data.debrief?.score ?? null,
    final_global_state: finalState,
    final_result_label: data.outcome,
    final_momentum_or_state: finalState,
    total_turns: msgs.length,
    total_user_turns: msgs.filter(m => m.speaker === "user").length,
    total_ai_turns: aiTurns,
    session_end_reason: data.exitNote?.text
      ? `user_declared: ${data.exitNote.text}`
      : `outcome_type: ${data.outcome}`,
    strongest_moment: null,
    weakest_moment: null,
    unresolved_objections: null,
    missed_closing_window: null,
    final_call_memory: [],
    strengths: [],
    improvements: data.debrief?.critique ?? [],
    full_report: null,
  };

  const hints: AuditHints = {
    likely_primary_failure: isLost ? "seller" : "none",
    suspected_prompt_issue: "no",
    suspected_ui_issue: "no",
    suspected_support_gap: yesno(isLost),
    suspected_close_timing_issue: yesno(isLost || msgs.length > 20),
    suspected_repetition_issue: "no",
    suspected_claim_risk: "no",
    suspected_unresolved_technical_objection: "no",
    suspected_false_confidence: "no",
    suspected_soft_next_step: "no",
    audit_notes: auditNotes.length > 0 ? auditNotes : ["no anomalies detected in this session"],
  };

  return { meta, context, config, turns, readable_transcript, summary, audit_hints: hints };
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

export function renderAuditLogMarkdown(log: AuditLog, whisperStatus?: WhisperStatus): string {
  const sections: string[] = [];

  // ── Header
  sections.push(`# ${BRAND_NAME} AUDIT LOG`);
  sections.push("");

  // ── SESSION_META
  sections.push("## SESSION_META");
  sections.push("");
  sections.push(`app_mode: ${log.meta.app_mode}`);
  sections.push(`session_id: ${nul(log.meta.session_id)}`);
  sections.push(`exported_at: ${log.meta.exported_at}`);
  sections.push(`app_version: ${log.meta.app_version}`);
  sections.push(`model: ${log.meta.model}`);
  sections.push(`lang: ${log.meta.lang}`);
  sections.push(`ui_mode: ${nul(log.meta.ui_mode)}`);
  sections.push(`source_mode: ${nul(log.meta.source_mode)}`);
  sections.push(`speaker_mode_default: ${nul(log.meta.speaker_mode_default)}`);
  sections.push(`role_in_arena: ${nul(log.meta.role_in_arena)}`);
  sections.push(`context_label: ${nul(log.meta.context_label)}`);
  sections.push(`session_status: ${nul(log.meta.session_status)}`);
  sections.push("");

  // ── SESSION_CONTEXT
  sections.push("## SESSION_CONTEXT");
  sections.push("");
  sections.push(`raw_context: |`);
  sections.push(`  ${log.context.raw_context.replace(/\n/g, "\n  ")}`);
  sections.push(`objective: ${nul(log.context.objective)}`);
  if (log.context.known_objections?.length) {
    sections.push("known_objections:");
    log.context.known_objections.forEach(o => sections.push(`- ${o}`));
  } else {
    sections.push("known_objections: null");
  }
  sections.push(`relevant_data: ${nul(log.context.relevant_data)}`);
  sections.push("");

  // ── SESSION_CONFIG
  sections.push("## SESSION_CONFIG");
  sections.push("");
  sections.push(`input_mode: ${nul(log.config.input_mode)}`);
  sections.push(`speaker_mode_default: ${nul(log.config.speaker_mode_default)}`);
  sections.push(`arena_role: ${nul(log.config.arena_role)}`);
  sections.push(`arena_variant: ${nul(log.config.arena_variant)}`);
  sections.push(`arena_state_model: ${nul(log.config.arena_state_model)}`);
  sections.push(`runtime_instructions_active: ${log.config.runtime_instructions && log.config.runtime_instructions.length > 0 ? "yes" : "no"}`);
  sections.push("");

  // ── HIDDEN_RUNTIME_INSTRUCTIONS
  if (log.config.runtime_instructions && log.config.runtime_instructions.length > 0) {
    sections.push("## HIDDEN_RUNTIME_INSTRUCTIONS");
    sections.push("");
    sections.push("# These constraints were injected mid-session by the trainer/user and applied");
    sections.push("# to the AI seller in real-time. They are not visible in the conversation");
    sections.push("# transcript but directly influenced the seller's responses from that point on.");
    sections.push("");
    log.config.runtime_instructions.forEach((instr, i) => {
      sections.push(`${i + 1}. ${instr}`);
    });
    sections.push("");
  }

  // ── TURN_LOG
  sections.push("## TURN_LOG");
  if (log.turns.length === 0) {
    sections.push("");
    sections.push("(no turns recorded)");
    sections.push("");
  }

  for (const t of log.turns) {
    sections.push("");
    sections.push(`### TURN ${t.turn_index + 1}`);
    sections.push("");
    sections.push(`turn_index: ${t.turn_index}`);
    sections.push(`timestamp: ${t.timestamp}`);
    sections.push(`mode: ${t.mode}`);
    sections.push(`source_mode: ${nul(t.source_mode)}`);
    sections.push(`speaker_mode: ${nul(t.speaker_mode)}`);
    sections.push(`raw_input: ${nul(t.raw_input)}`);
    sections.push(`normalized_input: ${nul(t.normalized_input)}`);
    sections.push(`inferred_speaker: ${nul(t.inferred_speaker)}`);
    sections.push("");
    sections.push("memory_before:");
    sections.push(listLines(t.memory_before));
    sections.push("");
    sections.push(`model_request_summary: ${nul(t.model_request_summary)}`);
    sections.push(`model_output_raw: ${t.model_output_raw ? "(see copilot/arena section below)" : "null"}`);
    sections.push(`response_status: ${t.response_status}`);
    sections.push(`parse_error: ${nul(t.parse_error)}`);
    sections.push(`notes: ${nul(t.notes)}`);

    // Copilot-specific
    if (t.copilot) {
      const c = t.copilot;
      sections.push("");
      sections.push("#### COPILOT_ANALYSIS");
      sections.push("");
      sections.push(`signal: ${nul(c.signal)}`);
      sections.push(`say_now: ${nul(c.say_now)}`);
      sections.push(`avoid: ${nul(c.avoid)}`);
      sections.push(`reading: ${nul(c.reading)}`);
      sections.push(`mission: ${nul(c.mission)}`);
      sections.push(`next_move: ${nul(c.next_move)}`);
      sections.push(`support: ${nul(c.support)}`);
      sections.push(`journey_past: ${nul(c.journey_past)}`);
      sections.push(`journey_now: ${nul(c.journey_now)}`);
      sections.push(`journey_next: ${nul(c.journey_next)}`);
      sections.push(`momentum: ${nul(c.momentum)}`);
      sections.push(`why_this_turn_exists: ${nul(c.why_this_turn_exists)}`);
      sections.push("");
      sections.push("memory_after:");
      sections.push(listLines(c.memory_after));
    }

    // Arena-specific
    if (t.arena) {
      const a = t.arena;
      sections.push("");
      sections.push("#### ARENA_TURN");
      sections.push("");
      sections.push(`arena_role_of_user: ${a.arena_role_of_user}`);
      sections.push(`ai_role_this_turn: ${a.ai_role_this_turn}`);
      sections.push(`user_message: ${nul(a.user_message)}`);
      sections.push(`ai_message: ${nul(a.ai_message)}`);
      sections.push(`conversation_state_before: ${nul(a.conversation_state_before)}`);
      sections.push(`conversation_state_after: ${nul(a.conversation_state_after)}`);
      sections.push(`terminal_state_detected: ${a.terminal_state_detected}`);
      sections.push(`terminal_state_type: ${nul(a.terminal_state_type)}`);
      sections.push(`terminal_state_source: ${nul(a.terminal_state_source)}`);
      sections.push(`tension_or_momentum: ${nul(a.tension_or_momentum)}`);
      sections.push(`hidden_reasoning_summary: ${nul(a.hidden_reasoning_summary)}`);

      if (a.coach) {
        sections.push("");
        sections.push("#### COACH_ANALYSIS");
        sections.push("");
        if (a.coach.fields) {
          const f = a.coach.fields;
          sections.push(`signal: ${f.signal}`);
          sections.push(`reading: ${f.reading}`);
          sections.push(`mission: ${f.mission}`);
          sections.push(`next_move: ${f.next_move}`);
          sections.push(`strategy: ${f.strategy}`);
          sections.push(`why_this_response: ${f.why_this_response}`);
          sections.push(`alternative: ${f.alternative}`);
        } else {
          sections.push(`explanation: |`);
          sections.push(`  ${a.coach.explanation.replace(/\n/g, "\n  ")}`);
        }
      }

      if (a.journey) {
        sections.push("");
        sections.push("#### JOURNEY_STATE");
        sections.push("");
        if (a.journey.stages && Object.keys(a.journey.stages).length > 0) {
          const STAGE_LABELS: Record<string, string> = {
            context: "context (situación del cliente)",
            problem: "problem (dolor o necesidad real)",
            blocker: "blocker (objeción principal)",
            fit: "fit (encaje solución–criterio)",
            advance: "advance (microcompromiso)",
            close: "close (cierre)",
          };
          sections.push("stages:");
          for (const [stageId, status] of Object.entries(a.journey.stages)) {
            const label = STAGE_LABELS[stageId] ?? stageId;
            sections.push(`  ${label}: ${status}`);
          }
        }
        sections.push(`now_help: ${nul(a.journey.now_help)}`);
        sections.push(`next_help: ${nul(a.journey.next_help)}`);
        sections.push(`premature_close_risk: ${nul(a.journey.premature_close_risk)}`);
      }
    }
  }

  // ── READABLE_TRANSCRIPT
  sections.push("");
  sections.push("## READABLE_TRANSCRIPT");
  sections.push("");
  if (log.readable_transcript.length === 0) {
    sections.push("(no transcript available)");
  } else {
    log.readable_transcript.forEach(line => sections.push(line));
  }
  sections.push("");

  // ── SESSION_SUMMARY
  const s = log.summary;
  sections.push("## SESSION_SUMMARY");
  sections.push("");
  sections.push(`final_outcome: ${nul(s.final_outcome)}`);
  sections.push(`final_outcome_source: ${s.final_outcome_source}`);
  sections.push(`final_score: ${s.final_score != null ? s.final_score.toFixed(1) : "null"}`);
  sections.push(`final_global_state: ${nul(s.final_global_state)}`);
  sections.push(`final_result_label: ${nul(s.final_result_label)}`);
  sections.push(`final_momentum_or_state: ${nul(s.final_momentum_or_state)}`);
  sections.push(`total_turns: ${s.total_turns}`);
  sections.push(`total_user_turns: ${s.total_user_turns ?? "null"}`);
  sections.push(`total_ai_turns: ${s.total_ai_turns ?? "null"}`);
  sections.push(`session_end_reason: ${nul(s.session_end_reason)}`);
  sections.push(`strongest_moment: ${nul(s.strongest_moment)}`);
  sections.push(`weakest_moment: ${nul(s.weakest_moment)}`);
  if (s.unresolved_objections?.length) {
    sections.push("unresolved_objections:");
    s.unresolved_objections.forEach(o => sections.push(`- ${o}`));
  } else {
    sections.push("unresolved_objections: null");
  }
  sections.push(`missed_closing_window: ${nul(s.missed_closing_window)}`);
  sections.push("");
  sections.push("final_call_memory:");
  sections.push(listLines(s.final_call_memory));
  sections.push("");
  sections.push("strengths:");
  sections.push(listLines(s.strengths));
  sections.push("");
  sections.push("improvements:");
  sections.push(listLines(s.improvements));
  if (s.speaker_session_metrics) {
    const m = s.speaker_session_metrics;
    sections.push("");
    sections.push("speaker_attribution_quality:");
    sections.push(`  unknown_rate: ${(m.unknown_rate * 100).toFixed(0)}%`);
    sections.push(`  avg_confidence: ${m.avg_confidence.toFixed(2)}`);
    sections.push(`  high_conf_rate: ${(m.high_conf_rate * 100).toFixed(0)}%`);
    sections.push(`  low_conf_rate: ${(m.low_conf_rate * 100).toFixed(0)}%`);
    sections.push(`  carryover_rate: ${(m.carryover_rate * 100).toFixed(0)}%`);
    sections.push(`  auto_reassigned_count: ${m.auto_reassigned_count}`);
    if (m.ai_retropass_reclassified_count !== undefined) {
      sections.push(`  ai_retropass_reclassified_count: ${m.ai_retropass_reclassified_count}`);
    }
  }
  if (s.full_report) {
    sections.push("");
    sections.push("full_report: |");
    sections.push(`  ${s.full_report.replace(/\n/g, "\n  ")}`);
  }
  sections.push("");

  // ── AUDIT_HINTS
  const h = log.audit_hints;
  sections.push("## AUDIT_HINTS");
  sections.push("");
  sections.push(`likely_primary_failure: ${h.likely_primary_failure}`);
  sections.push(`suspected_prompt_issue: ${h.suspected_prompt_issue}`);
  sections.push(`suspected_ui_issue: ${h.suspected_ui_issue}`);
  sections.push(`suspected_support_gap: ${h.suspected_support_gap}`);
  sections.push(`suspected_close_timing_issue: ${h.suspected_close_timing_issue}`);
  sections.push(`suspected_repetition_issue: ${h.suspected_repetition_issue}`);
  sections.push(`suspected_claim_risk: ${h.suspected_claim_risk}`);
  sections.push(`suspected_unresolved_technical_objection: ${h.suspected_unresolved_technical_objection}`);
  sections.push(`suspected_false_confidence: ${h.suspected_false_confidence}`);
  sections.push(`suspected_soft_next_step: ${h.suspected_soft_next_step}`);
  sections.push("");
  sections.push("audit_notes:");
  h.audit_notes.forEach(n => sections.push(`- ${n}`));
  sections.push("");

  // ── WHISPER_STATUS
  if (whisperStatus) {
    sections.push("## WHISPER_STATUS");
    sections.push("");
    sections.push(`whisper_received: ${whisperStatus.whisper_received ? "yes" : "no"}`);
    sections.push(`whisper_clean_done: ${whisperStatus.whisper_clean_done ? "yes" : "no"}`);
    sections.push(`whisper_chars: ${whisperStatus.whisper_chars}`);
    sections.push(`whisper_preview: |`);
    sections.push(`  ${whisperStatus.whisper_preview.replace(/\n/g, "\n  ")}`);
    sections.push("");
  }

  return sections.join("\n");
}

// ── Whisper status type ───────────────────────────────────────────────────────

export interface WhisperStatus {
  whisper_received: boolean;
  whisper_clean_done: boolean;
  whisper_chars: number;
  whisper_preview: string;
}

// ── Download helper ───────────────────────────────────────────────────────────

export function triggerAuditLogDownload(log: AuditLog, sessionId: string | null, whisperStatus?: WhisperStatus): void {
  const md = renderAuditLogMarkdown(log, whisperStatus);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const sid = sessionId || log.meta.app_mode;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  a.download = `cw-audit-${sid}-${ts}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Canonical Copilot Session Log ─────────────────────────────────────────────
// Single source of truth for the downloadable forensic log.
// BOTH the live download and the history download must call buildCopilotCanonicalLog.
// The resulting markdown is stored in DB as canonicalLogMd.

export interface PrebriefBundle {
  rawInput: string | null;
  interpretedContext: unknown | null;
  briefing: unknown | null;
  brainId: string | null;
  prebriefId: string | null;
  userEdited: boolean;
  confirmedAt?: string | null;
  briefingReadyAt?: string | null;
}

export interface CanonicalTimelineSnapshot {
  session_started_at: string | null;
  session_ended_at: string | null;
  prebrief_created_at: string | null;
  prebrief_briefing_ready_at: string | null;
  whisper_raw_ready_at: string | null;
  whisper_clean_ready_at: string | null;
  summary_ready_at: string | null;
  brutal_audit_ready_at: string | null;
  vela_audit_ready_at: string | null;
  saved_at: string | null;
}

export type CanonicalTranscriptSource = "whisper_clean" | "fallback_web_speech" | "imported" | "none";

export interface CopilotCanonicalSessionInput {
  sessionId: string | null;
  sourceSessionId: string | null;
  prebriefId: string | null;
  brainId: string | null;
  lang: AuditLang;
  sessionContext: string | null;
  contextLabel: string | null;
  speakerMode: string;
  callOutcome: string | null;
  isSessionSaved: boolean;
  savedAt: string | null;
  webSpeechLines: string[];
  whisperRawTranscript: string | null;
  whisperCleanTranscript: string | null;
  whisperCleanDone: boolean;
  importedTranscript?: string | null;
  transcriptUsedForSummary: CanonicalTranscriptSource;
  transcriptUsedForBrutalAudit: CanonicalTranscriptSource;
  transcriptUsedForVelaAudit: CanonicalTranscriptSource;
  callSummary: {
    score: number;
    globalState: string;
    resultLabel: string;
    strengths: string[];
    improvements: string[];
    fullReport?: string;
    debriefReliable?: boolean;
    speakerLowConf?: boolean;
  } | null;
  brutalAudit: Record<string, unknown> | null;
  velaAudit: Record<string, unknown> | null;
  turnLog: CopilotTurnEntry[];
  finalMemory: string[];
  structuredContext?: CopilotStructuredContext;
  speakerSessionMetrics?: SpeakerSessionMetricsForLog;
  aiRetropassReclassifiedCount: number;
  maxSayNowLoop: number;
  analyzeErrorCount: number;
  prebriefBundle: PrebriefBundle | null;
  costSnapshot: unknown | null;
  timelineSnapshot: CanonicalTimelineSnapshot | null;
}

// Internal helper — extract client name using same heuristics as backend
function extractClientNameFromRaw(raw: string): string | null {
  const m1 = raw.match(/[Cc]liente\s*[=:]\s*([^\n,.]+)/);
  if (m1) return m1[1].trim();
  const m2 = raw.match(/^([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})\s*[,.\n]/u);
  if (m2) return m2[1].trim();
  const m3 = raw.match(/(?:con|para)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/u);
  if (m3) return m3[1].trim();
  return null;
}

export function buildCopilotCanonicalLog(input: CopilotCanonicalSessionInput): string {
  const s: string[] = [];
  const now = new Date().toISOString();
  const N = (v: string | null | undefined): string => (v != null && v !== "") ? v : "no disponible";
  const J = (v: unknown): string => {
    if (v == null) return "no disponible";
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };
  const lineCount = (t: string | null | undefined): number => t ? t.split("\n").filter(Boolean).length : 0;

  const clientName = input.prebriefBundle?.rawInput
    ? (extractClientNameFromRaw(input.prebriefBundle.rawInput) ?? "sin nombre")
    : (input.sessionContext ? (extractClientNameFromRaw(input.sessionContext) ?? "sin nombre") : "sin nombre");

  // ───────────────────────────────────────────────────────────────────────────
  // 1. CABECERA
  // ───────────────────────────────────────────────────────────────────────────
  s.push("# VELA — LOG FORENSE CANÓNICO DE SESIÓN COPILOTO");
  s.push("");
  s.push("```");
  s.push(`CLIENTE:         ${clientName}`);
  s.push(`BRAIN:           ${N(input.brainId)}`);
  s.push(`OUTCOME:         ${N(input.callOutcome)}`);
  s.push(`SCORE:           ${input.callSummary?.score != null ? input.callSummary.score.toFixed(1) + " / 10" : "no disponible"}`);
  s.push(`FECHA:           ${new Date(now).toLocaleString("es-ES")}`);
  s.push(`EXPORTADO:       ${now}`);
  s.push(`GUARDADO EN DB:  ${input.isSessionSaved ? "sí" : "no"}`);
  if (input.isSessionSaved && input.savedAt) s.push(`SAVED AT:        ${input.savedAt}`);
  s.push(`SOURCE SESSION:  ${N(input.sourceSessionId)}`);
  s.push(`DB SESSION ID:   ${N(input.sessionId)}`);
  s.push(`PREBRIEF ID:     ${N(input.prebriefId)}`);
  s.push("```");
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 2. RESUMEN EJECUTIVO
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 2. RESUMEN EJECUTIVO");
  s.push("");
  const degradedMode = !input.whisperCleanDone;
  s.push(`modo_degradado:      ${degradedMode ? "SÍ — Whisper limpio no disponible al auditar" : "no"}`);
  s.push(`fuente_principal:    ${input.transcriptUsedForSummary}`);
  s.push(`turns_analizados:    ${input.turnLog.length}`);
  s.push(`errores_análisis:    ${input.analyzeErrorCount}`);
  if (input.callSummary?.fullReport) {
    s.push("");
    s.push("informe_completo: |");
    s.push(`  ${input.callSummary.fullReport.replace(/\n/g, "\n  ")}`);
  }
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 3. CONTEXTO ORIGINAL
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 3. CONTEXTO ORIGINAL");
  s.push("");
  s.push("### Raw Input (pegado por el usuario)");
  s.push("```");
  s.push(N(input.prebriefBundle?.rawInput ?? input.sessionContext));
  s.push("```");
  s.push("");
  s.push("### Session Context (usado en live)");
  s.push("```");
  s.push(N(input.sessionContext));
  s.push("```");
  s.push("");
  if (input.structuredContext && Object.keys(input.structuredContext).length > 0) {
    s.push("### Structured Context");
    s.push("```json");
    s.push(J(input.structuredContext));
    s.push("```");
    s.push("");
  }
  s.push(`context_label: ${N(input.contextLabel)}`);
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 4. PREBRIEF COMPLETO
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 4. PREBRIEF COMPLETO");
  s.push("");
  const pb = input.prebriefBundle;
  if (!pb) {
    s.push("No se usó prebrief en esta sesión.");
  } else {
    s.push(`prebrief_id:    ${N(pb.prebriefId)}`);
    s.push(`brain_usado:    ${N(pb.brainId)}`);
    s.push(`user_edited:    ${pb.userEdited ? "sí" : "no"}`);
    s.push("");
    s.push("### Interpreted Context");
    s.push("```json");
    s.push(J(pb.interpretedContext));
    s.push("```");
    s.push("");
    s.push("### Briefing (preparación de llamada)");
    s.push("```json");
    s.push(J(pb.briefing));
    s.push("```");
    // Extract structured briefing fields for quick reading
    const briefObj = pb.briefing && typeof pb.briefing === "object" ? pb.briefing as Record<string, unknown> : null;
    if (briefObj) {
      s.push("");
      s.push("### Resumen operativo (campos clave)");
      if (briefObj["real_call_goal"]) s.push(`objetivo_real:        ${String(briefObj["real_call_goal"])}`);
      if (briefObj["must_get_today"]) s.push(`conseguir_hoy:        ${String(briefObj["must_get_today"])}`);
      const expectedObj = Array.isArray(briefObj["expected_objections"]) ? briefObj["expected_objections"] as string[] : null;
      if (expectedObj?.length) {
        s.push("objeciones_esperadas:");
        expectedObj.forEach(o => s.push(`  - ${o}`));
      }
      if (briefObj["suggested_opening"]) { s.push(""); s.push(`apertura_sugerida:    ${String(briefObj["suggested_opening"])}`); }
      if (briefObj["suggested_next_step_close"]) s.push(`cierre_siguiente:     ${String(briefObj["suggested_next_step_close"])}`);
      if (briefObj["brief_for_live"]) {
        s.push("");
        s.push("brief_for_live: |");
        s.push(`  ${String(briefObj["brief_for_live"]).replace(/\n/g, "\n  ")}`);
      }
    }
    // Extract structured interpreted context fields
    const icObj = pb.interpretedContext && typeof pb.interpretedContext === "object" ? pb.interpretedContext as Record<string, unknown> : null;
    if (icObj) {
      s.push("");
      s.push("### Contexto interpretado (campos clave)");
      if (icObj["detected_phase"])     s.push(`fase_detectada:       ${String(icObj["detected_phase"])}`);
      if (icObj["call_type"])          s.push(`tipo_llamada:         ${String(icObj["call_type"])}`);
      if (icObj["today_decision"])     s.push(`decisión_hoy:         ${String(icObj["today_decision"])}`);
      if (icObj["valid_outcome_today"]) s.push(`outcome_válido_hoy:   ${String(icObj["valid_outcome_today"])}`);
      const flags = Array.isArray(icObj["special_context_flags"]) ? icObj["special_context_flags"] as string[] : null;
      if (flags?.length) { s.push("flags_contexto:"); flags.forEach(f => s.push(`  - ${f}`)); }
      const constraints = Array.isArray(icObj["decision_constraints"]) ? icObj["decision_constraints"] as string[] : null;
      if (constraints?.length) { s.push("decision_constraints:"); constraints.forEach(c => s.push(`  - ${c}`)); }
      const risks = Array.isArray(icObj["case_specific_risks"]) ? icObj["case_specific_risks"] as string[] : null;
      if (risks?.length) { s.push("riesgos_específicos:"); risks.forEach(r => s.push(`  - ${r}`)); }
    }
    if (pb.confirmedAt) s.push(`\nconfirmed_at:         ${pb.confirmedAt}`);
    if (pb.briefingReadyAt) s.push(`briefing_ready_at:    ${pb.briefingReadyAt}`);
  }
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 5. RASTRO DEL SISTEMA EN VIVO
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 5. RASTRO DEL SISTEMA EN VIVO");
  s.push("");
  const inputMode = input.turnLog.length > 0
    ? [...new Set(input.turnLog.map(t => t.source_mode))].join("+")
    : "none";
  s.push(`input_mode:                  ${inputMode}`);
  s.push(`speaker_mode:                ${input.speakerMode}`);
  s.push(`source_session_id:           ${N(input.sourceSessionId)}`);
  s.push(`db_session_id:               ${N(input.sessionId)}`);
  s.push(`prebrief_id:                 ${N(input.prebriefId)}`);
  s.push(`brain_activo:                ${N(input.brainId)}`);
  s.push(`total_turns:                 ${input.turnLog.length}`);
  s.push(`analyze_errors:              ${input.analyzeErrorCount}`);
  s.push(`ai_retropass_reclassified:   ${input.aiRetropassReclassifiedCount}`);
  s.push(`max_say_now_loop:             ${input.maxSayNowLoop}`);
  s.push(`loops_detectados:            ${input.maxSayNowLoop >= 3 ? "sí (" + input.maxSayNowLoop + " repeticiones)" : "no"}`);
  const sm = input.speakerSessionMetrics;
  if (sm) {
    s.push(`speaker_unknown_rate:        ${(sm.unknown_rate * 100).toFixed(0)}%`);
    s.push(`speaker_avg_confidence:      ${sm.avg_confidence.toFixed(2)}`);
    s.push(`speaker_high_conf_rate:      ${(sm.high_conf_rate * 100).toFixed(0)}%`);
    s.push(`speaker_auto_reassigned:     ${sm.auto_reassigned_count}`);
    if (sm.ai_retropass_reclassified_count !== undefined) {
      s.push(`ai_retropass_reclassified:   ${sm.ai_retropass_reclassified_count}`);
    }
  }
  s.push(`whisper_clean_disponible:    ${input.whisperCleanDone ? "sí" : "no"}`);
  s.push(`transcript_fuente_summary:   ${input.transcriptUsedForSummary}`);
  s.push(`transcript_fuente_brutal:    ${input.transcriptUsedForBrutalAudit}`);
  s.push(`transcript_fuente_vela:      ${input.transcriptUsedForVelaAudit}`);
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 6. TRANSCRIPTOS
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 6. TRANSCRIPTOS");
  s.push("");
  s.push("### 6.1 Web Speech (turnos del copiloto)");
  if (input.webSpeechLines.length > 0) {
    input.webSpeechLines.forEach((line, i) => s.push(`${i + 1}. ${line}`));
  } else {
    s.push("(no disponible)");
  }
  s.push("");

  s.push("### 6.2 Whisper Bruto");
  if (input.whisperRawTranscript) {
    s.push("```");
    s.push(input.whisperRawTranscript);
    s.push("```");
  } else {
    s.push("(no disponible)");
  }
  s.push("");

  s.push("### 6.3 Whisper Limpio con Hablantes");
  s.push(`fuente_de_verdad: ${input.transcriptUsedForSummary === "whisper_clean" ? "SÍ — usado para todos los análisis" : "NO — fallback activo"}`);
  if (input.whisperCleanTranscript) {
    s.push("```");
    s.push(input.whisperCleanTranscript);
    s.push("```");
  } else {
    s.push("(no disponible)");
  }
  s.push("");

  if (input.importedTranscript) {
    s.push("### 6.4 Transcript Importado");
    s.push("```");
    s.push(input.importedTranscript);
    s.push("```");
    s.push("");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. COMPARATIVA DE TRANSCRIPTOS
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 7. COMPARATIVA DE TRANSCRIPTOS");
  s.push("");
  const wsChars = input.webSpeechLines.join(" ").length;
  const rawLines = lineCount(input.whisperRawTranscript);
  const rawChars = input.whisperRawTranscript?.length ?? 0;
  const cleanLines = lineCount(input.whisperCleanTranscript);
  const cleanChars = input.whisperCleanTranscript?.length ?? 0;
  s.push(`Web Speech:     ${input.webSpeechLines.length} turnos, ~${wsChars} chars`);
  s.push(`Whisper Bruto:  ${rawLines} líneas, ~${rawChars} chars`);
  s.push(`Whisper Limpio: ${cleanLines} líneas, ~${cleanChars} chars`);
  if (rawChars > 0 && wsChars > 0) {
    s.push(`Ratio whisper/webSpeech: ${(rawChars / wsChars).toFixed(1)}x`);
  }
  if (!input.whisperCleanTranscript && !input.whisperRawTranscript) {
    s.push("⚠ Sin datos de Whisper — análisis basado en Web Speech o memoria de VELA");
  }
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 8. GUÍA TÁCTICA TURNO A TURNO
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 8. GUÍA TÁCTICA TURNO A TURNO");
  s.push("");
  if (input.turnLog.length === 0) {
    s.push("(sin turnos registrados)");
  } else {
    for (const t of input.turnLog) {
      const o = t.system_output;
      s.push(`### Turno ${t.turn_index + 1}`);
      s.push(`turn_index:   ${t.turn_index}`);
      s.push(`timestamp:    ${t.timestamp}`);
      s.push(`speaker:      ${t.inferred_speaker}`);
      s.push(`raw_input:    ${t.raw_fragment}`);
      s.push(`normalized:   ${t.normalized_fragment}`);
      if (o) {
        s.push(`signal:       ${o.signal}`);
        s.push(`say_now:      ${o.say_now}`);
        s.push(`avoid:        ${o.avoid ?? "null"}`);
        s.push(`reading:      ${o.detail?.reading ?? "null"}`);
        s.push(`mission:      ${o.detail?.mission ?? "null"}`);
        s.push(`next_move:    ${o.detail?.next_move ?? "null"}`);
        s.push(`support:      ${o.detail?.support ?? "null"}`);
        s.push(`journey:      ${o.journey?.past ?? "null"} → ${o.journey?.now ?? "null"} → ${o.journey?.next ?? "null"}`);
        s.push(`momentum:     ${o.momentum}`);
        const memBefore = t.memory_before.length > 0 ? t.memory_before.map(m => `  · ${m}`).join("\n") : "  (vacía)";
        const memAfter = t.memory_after.length > 0 ? t.memory_after.map(m => `  · ${m}`).join("\n") : "  (vacía)";
        s.push(`memory_before:\n${memBefore}`);
        s.push(`memory_after:\n${memAfter}`);
        const fragmentClip = t.raw_fragment.slice(0, 80);
        const memContext = t.memory_before.length > 0 ? `+ ${t.memory_before.length} mem items` : null;
        const ctxNote = input.sessionContext ? "+ session context" : null;
        const sourceBasis = [fragmentClip, memContext, ctxNote].filter(Boolean).join("; ");
        s.push(`source_basis: ${sourceBasis}`);
      } else {
        s.push(`(sin output — status: ${t.response_status})`);
      }
      s.push("");
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 9. SUMMARY POST-LLAMADA
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 9. SUMMARY POST-LLAMADA");
  s.push("");
  const cs = input.callSummary;
  if (!cs) {
    s.push("no disponible");
  } else {
    s.push(`score:            ${cs.score.toFixed(1)}`);
    s.push(`global_state:     ${cs.globalState}`);
    s.push(`result_label:     ${cs.resultLabel}`);
    s.push(`debrief_reliable: ${cs.debriefReliable !== false ? "sí" : "no"}`);
    s.push(`speaker_low_conf: ${cs.speakerLowConf ? "sí" : "no"}`);
    s.push(`analysis_source:  ${input.transcriptUsedForSummary}`);
    s.push("");
    if (cs.strengths.length > 0) {
      s.push("strengths:");
      cs.strengths.forEach(x => s.push(`  - ${x}`));
    }
    if (cs.improvements.length > 0) {
      s.push("improvements:");
      cs.improvements.forEach(x => s.push(`  - ${x}`));
    }
  }
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 10. AUDITORÍA BRUTAL
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 10. AUDITORÍA BRUTAL");
  s.push("");
  const ba = input.brutalAudit;
  if (!ba) {
    s.push("no disponible");
  } else {
    if (ba["verdict"]) { s.push(`VEREDICTO: ${String(ba["verdict"])}`); s.push(""); }
    const listField = (label: string, key: string) => {
      const arr = ba[key];
      if (Array.isArray(arr) && arr.length > 0) {
        s.push(`${label}:`);
        (arr as string[]).forEach(x => s.push(`  - ${x}`));
        s.push("");
      }
    };
    listField("FUNCIONÓ", "what_worked");
    listField("FALLÓ", "what_failed");
    listField("DUEÑO DEL FALLO", "failure_owner");
    listField("CIERRES PERDIDOS", "missed_closes");
    listField("REGLAS VIOLADAS", "rules_violated");
    listField("CAMBIOS PRIORITARIOS", "priority_changes");
    if (ba["what_i_would_have_done"]) {
      s.push("LO QUE YO HABRÍA HECHO:");
      s.push(String(ba["what_i_would_have_done"]));
      s.push("");
    }
    if (ba["perfect_conversation"]) {
      s.push("CONVERSACIÓN PERFECTA:");
      s.push(String(ba["perfect_conversation"]));
      s.push("");
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 11. AUDITORÍA VELA
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 11. AUDITORÍA VELA");
  s.push("");
  if (!input.velaAudit) {
    s.push("no disponible");
  } else {
    s.push("```json");
    s.push(J(input.velaAudit));
    s.push("```");
  }
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 12. COSTE
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 12. COSTE");
  s.push("");
  const costSnap = input.costSnapshot as Record<string, unknown> | null;
  if (costSnap && costSnap["totalCostUsd"] != null) {
    const usd = Number(costSnap["totalCostUsd"]);
    s.push(`total_cost_usd:  $${usd.toFixed(6)}`);
    s.push(`total_cost_eur:  ~€${(usd * 0.93).toFixed(4)} (estimado)`);
    s.push("");
    s.push("costSnapshot (detalle):");
    s.push("```json");
    s.push(J(input.costSnapshot));
    s.push("```");
  } else {
    s.push("no disponible — getSessionStats no devolvió datos para este sourceSessionId");
  }
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 13. TIMELINE
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 13. TIMELINE");
  s.push("");
  const tl = input.timelineSnapshot;
  if (tl) {
    s.push(`session_started_at:          ${N(tl.session_started_at)}`);
    s.push(`session_ended_at:            ${N(tl.session_ended_at)}`);
    s.push(`prebrief_created_at:         ${N(tl.prebrief_created_at)}`);
    s.push(`prebrief_briefing_ready_at:  ${N(tl.prebrief_briefing_ready_at)}`);
    s.push(`whisper_raw_ready_at:        ${N(tl.whisper_raw_ready_at)}`);
    s.push(`whisper_clean_ready_at:      ${N(tl.whisper_clean_ready_at)}`);
    s.push(`summary_ready_at:            ${N(tl.summary_ready_at)}`);
    s.push(`brutal_audit_ready_at:       ${N(tl.brutal_audit_ready_at)}`);
    s.push(`vela_audit_ready_at:         ${N(tl.vela_audit_ready_at)}`);
    s.push(`saved_at:                    ${N(tl.saved_at)}`);
  } else {
    s.push("no disponible");
  }
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 14. SNAPSHOT CRUDO
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 14. SNAPSHOT CRUDO");
  s.push("");
  const snapshotData = {
    session_id: input.sessionId,
    source_session_id: input.sourceSessionId,
    brain_id: input.brainId,
    outcome: input.callOutcome,
    lang: input.lang,
    speaker_mode: input.speakerMode,
    total_turns: input.turnLog.length,
    analyze_errors: input.analyzeErrorCount,
    retropass_reclassified: input.aiRetropassReclassifiedCount,
    max_say_now_loop: input.maxSayNowLoop,
    final_memory: input.finalMemory,
    call_summary: input.callSummary,
    speaker_metrics: input.speakerSessionMetrics ?? null,
  };
  s.push("```json");
  s.push(J(snapshotData));
  s.push("```");
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 15. ESTADO DE GENERACIÓN
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 15. ESTADO DE GENERACIÓN");
  s.push("");
  s.push(`prebrief_usado:            ${input.prebriefBundle ? "sí" : "no — no se usó prebrief en esta sesión"}`);
  s.push(`brutal_audit_generada:     ${input.brutalAudit ? "sí" : "no — auditoría brutal no ejecutada o no disponible"}`);
  s.push(`vela_audit_generada:       ${input.velaAudit ? "sí" : "no — auditoría VELA no ejecutada o no disponible"}`);
  s.push(`whisper_raw:               ${input.whisperRawTranscript ? `disponible (${input.whisperRawTranscript.length} chars)` : "no disponible"}`);
  s.push(`whisper_limpio:            ${input.whisperCleanTranscript ? `disponible (${input.whisperCleanTranscript.length} chars)` : "no disponible"}`);
  s.push(`web_speech_turns:          ${input.webSpeechLines.length > 0 ? `${input.webSpeechLines.length} turnos` : "no disponible"}`);
  s.push(`summary_generado:          ${input.callSummary ? "sí" : "no"}`);
  s.push(`session_guardada_en_db:    ${input.isSessionSaved ? "sí" : "no — sesión no guardada"}`);
  const costAvail = (input.costSnapshot as Record<string, unknown> | null)?.["totalCostUsd"] != null;
  s.push(`coste_disponible:          ${costAvail ? "sí" : !input.sourceSessionId ? "no — sin source_session_id" : "no — tracker sin datos para este source_session_id"}`);
  s.push("");

  // ───────────────────────────────────────────────────────────────────────────
  // 16. PREGUNTAS QUE ESTE LOG PERMITE RESPONDER
  // ───────────────────────────────────────────────────────────────────────────
  s.push("## 16. PREGUNTAS QUE ESTE LOG PERMITE RESPONDER");
  s.push("");
  s.push("- ¿Qué se dijo y cuándo? → Sección 6 (Transcriptos) + Sección 8 (Guía táctica turno a turno)");
  s.push("- ¿Por qué VELA sugirió lo que sugirió? → Sección 8, campo `source_basis` de cada turno");
  s.push("- ¿Qué fuente se usó para auditar? → Sección 5 (transcript_fuente_*) + Sección 7 (Comparativa)");
  s.push("- ¿Si la lectura comercial fue coherente? → Sección 8 (signal, reading, mission por turno) + Sección 10");
  s.push("- ¿Si la atribución de hablantes fue fiable? → Sección 5 (speaker_unknown_rate) + Sección 6.3");
  s.push("- ¿Si la auditoría brutal coincide con el transcript limpio? → Sección 6.3 vs Sección 10");
  s.push("- ¿Si hubo fallos del sistema o de fuente? → Sección 5 (analyze_errors, loops) + Sección 11 (VELA audit)");
  s.push("");
  s.push("---");
  s.push(`_Generado por VELA · ${now}_`);

  return s.join("\n");
}

export function triggerCanonicalLogDownload(markdown: string, sessionId: string | null): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const sid = sessionId || "session";
  const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  a.download = `vela-canonical-${sid}-${ts}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
