/**
 * Closer Wizard — Unified Audit Log System
 *
 * Produces forensic, audit-ready markdown logs for both Copiloto and Arena modes.
 * Compatible with the Closer Wizard Auditor GPT without additional explanation.
 *
 * Pipeline: raw session data → buildCopilotAuditLog / buildArenaAuditLog
 *           → AuditLog typed object → renderAuditLogMarkdown → .md file
 */

export type AppMode = "copilot" | "arena";
export type AuditLang = "es" | "en";
export type ResponseStatus = "ok" | "error" | "partial";

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

export interface ArenaTurnData {
  arena_role_of_user: string;
  ai_role_this_turn: string;
  user_message: string | null;
  ai_message: string | null;
  conversation_state_before: string | null;
  conversation_state_after: string | null;
  terminal_state_detected: "yes" | "no";
  terminal_state_type: string | null;
  terminal_state_source: string | null;
  tension_or_momentum: string | null;
  hidden_reasoning_summary: string | null;
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
}

export interface AuditHints {
  likely_primary_failure: string;
  suspected_prompt_issue: "yes" | "no";
  suspected_ui_issue: "yes" | "no";
  suspected_support_gap: "yes" | "no";
  suspected_close_timing_issue: "yes" | "no";
  suspected_repetition_issue: "yes" | "no";
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
}

// ── Arena builder input types ─────────────────────────────────────────────────

export interface ArenaMessageEntry {
  index: number;
  speaker: "user" | "ai";
  message: string;
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
    model: "gpt-4o-mini",
    lang: data.lang,
    ui_mode: "copilot",
    source_mode: inputModeStr,
    speaker_mode_default: data.speakerMode,
    role_in_arena: null,
    context_label: data.contextLabel || null,
    session_status: data.callOutcome ?? "ended_without_declared_outcome",
  };

  // Context — raw + structural decomposition
  const rawCtx = data.sessionContext ?? "(no context provided)";
  const context: SessionContext = {
    raw_context: rawCtx,
    objective: null,
    known_objections: null,
    relevant_data: null,
  };

  // Config
  const config: SessionConfig = {
    input_mode: inputModeStr,
    speaker_mode_default: data.speakerMode,
    arena_role: null,
    arena_variant: null,
    arena_state_model: null,
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

  const hints: AuditHints = {
    likely_primary_failure: isLost ? "seller" : errorTurns > 0 ? "technical" : parseErrors > 0 ? "system" : "none",
    suspected_prompt_issue: yesno(parseErrors > 1 || repetitionCount > 2),
    suspected_ui_issue: "no",
    suspected_support_gap: yesno(isLost),
    suspected_close_timing_issue: yesno(isLost || lastMomentum === "amber"),
    suspected_repetition_issue: yesno(repetitionCount > 1),
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
    model: "gpt-4o-mini",
    lang: data.lang,
    ui_mode: "arena",
    source_mode: "chat",
    speaker_mode_default: null,
    role_in_arena: data.role,
    context_label: null,
    session_status: data.outcome,
  };

  const context: SessionContext = {
    raw_context: data.context || "(no context provided)",
    objective: null,
    known_objections: null,
    relevant_data: null,
  };

  const config: SessionConfig = {
    input_mode: "chat",
    speaker_mode_default: null,
    arena_role: data.role,
    arena_variant: null,
    arena_state_model: "keyword_heuristic + gpt-4o-mini",
  };

  // Build exchange-based turns — group messages as AI-open + user + AI-response triplets
  // Flat approach: one AuditTurn per message, richer cross-referencing
  const turns: AuditTurn[] = [];
  const msgs = data.allMessages;

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

    const arena: ArenaTurnData = {
      arena_role_of_user: data.role,
      ai_role_this_turn: aiRole,
      user_message: isUserMsg ? msg.message : (prevMsg?.speaker === "user" ? prevMsg.message : null),
      ai_message: !isUserMsg ? msg.message : (nextMsg?.speaker === "ai" ? nextMsg.message : null),
      conversation_state_before: stateBefore,
      conversation_state_after: stateAfter,
      terminal_state_detected: yesno(isTerminal),
      terminal_state_type: isTerminal ? data.outcome : null,
      terminal_state_source: isTerminal ? data.outcomeSource : null,
      tension_or_momentum: stateAfter,
      hidden_reasoning_summary: hiddenReasoning,
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

  // Readable transcript
  const readable_transcript = msgs.map((m, i) => {
    const label = m.speaker === "user"
      ? (data.role === "seller" ? "VENDEDOR" : "CLIENTE")
      : (aiRole === "seller" ? "IA VENDEDOR" : "IA CLIENTE");
    return `[${i + 1}] [${label}]: ${m.message}`;
  });

  // Derive final state from last AI message
  const lastAiMsg = [...msgs].reverse().find(m => m.speaker === "ai");
  const finalState = lastAiMsg ? deriveArenaState(lastAiMsg.message, data.lang) : null;

  const aiTurns = msgs.filter(m => m.speaker === "ai").length;
  const isLost = ["lost", "broken"].includes(data.outcome);
  const isClosed = data.outcome === "closed";

  const auditNotes: string[] = [];
  if (isLost) auditNotes.push(`session ended as "${data.outcome}" — audit objection handling and closing approach`);
  if (isClosed) auditNotes.push("session closed successfully — useful as positive training example");
  if (data.debrief) auditNotes.push(`debrief score: ${data.debrief.score}/10`);
  if (data.exitNote?.text) auditNotes.push(`exit note from user: "${data.exitNote.text}"`);
  if (msgs.length > 20) auditNotes.push("conversation was long (>20 messages) — check for close-timing issues");

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
    audit_notes: auditNotes.length > 0 ? auditNotes : ["no anomalies detected in this session"],
  };

  return { meta, context, config, turns, readable_transcript, summary, audit_hints: hints };
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

export function renderAuditLogMarkdown(log: AuditLog): string {
  const sections: string[] = [];

  // ── Header
  sections.push("# CLOSER WIZARD AUDIT LOG");
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
  sections.push("");

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
  sections.push("");
  sections.push("audit_notes:");
  h.audit_notes.forEach(n => sections.push(`- ${n}`));
  sections.push("");

  return sections.join("\n");
}

// ── Download helper ───────────────────────────────────────────────────────────

export function triggerAuditLogDownload(log: AuditLog, sessionId: string | null): void {
  const md = renderAuditLogMarkdown(log);
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
