/**
 * VELA — Speaker Attribution Session
 *
 * Stateful, multi-layer speaker classifier for AUTO mode in Copilot.
 *
 * Pipeline per turn:
 *   text → rule scoring → carryover check → confidence threshold → result
 *
 * After each turn:
 *   history updated → retrospective repair triggered on UNKNOWN/low-conf entries
 *
 * NO audio processing, NO diarization — works from text + session state only.
 * Designed to be swappable if real diarization becomes available (see K).
 */

export type SpeakerLabel = "client" | "me" | "unknown";
export type SpeakerSource = "rule" | "carryover" | "manual" | "unknown";

export interface SpeakerResult {
  speaker: SpeakerLabel;
  confidence: number;     // 0.0 (no signal) → 1.0 (certain)
  source: SpeakerSource;
  label: string;          // display label: "yo" | "cliente" | "me" | "client" | ""
}

interface HistoryEntry {
  turnIndex: number;
  speaker: SpeakerLabel;
  confidence: number;
  source: SpeakerSource;
  textLength: number;
  autoRepaired: boolean;
}

export interface SpeakerSessionMetrics {
  total: number;
  client_count: number;
  me_count: number;
  unknown_count: number;
  unknown_rate: number;
  avg_confidence: number;
  high_conf_rate: number;
  low_conf_rate: number;
  carryover_rate: number;
  auto_reassigned_count: number;
}

export type SpeakerQualityLevel = "normal" | "watch" | "low";

export class SpeakerAttributionSession {
  private history: HistoryEntry[] = [];
  private autoReassigned = 0;
  private lang: "es" | "en";
  private contextSet = false;

  // Names extracted from session context or learned from live speech.
  // Null when not detected (no regression: falls back to vocabulary-only classification).
  private vendorName: string | null = null;
  private clientName: string | null = null;

  // Counter incremented each time a name is newly learned from live speech.
  // Lets the caller decide whether to run a retroactive re-pass.
  private namesLearnedCount = 0;

  constructor(lang: "es" | "en" = "es") {
    this.lang = lang;
  }

  setLang(lang: "es" | "en"): void { this.lang = lang; }

  /**
   * Provide the session context string.
   * Parses speaker names (e.g. "Alberto = vendedor") and uses them as the
   * strongest attribution signal — far more reliable than vocabulary patterns alone.
   * Safe to call multiple times; idempotent after the first successful name parse.
   */
  setContext(contextStr: string): void {
    this.contextSet = true;
    if (!this.vendorName && !this.clientName) {
      const { vendor, client } = this.parseNames(contextStr);
      this.vendorName = vendor;
      this.clientName = client;
    }
  }

  /**
   * Returns the speaker names detected from session context or learned live, or null.
   * Use this in the calling layer to enrich backend API payloads.
   */
  getDetectedNames(): { vendor: string | null; client: string | null } {
    return { vendor: this.vendorName, client: this.clientName };
  }

  /**
   * Returns how many names have been newly learned from live speech since the
   * last call to this method (consuming the count). Use this to decide whether
   * to run a retroactive re-pass of earlier turns.
   */
  getAndResetLearnCount(): number {
    const n = this.namesLearnedCount;
    this.namesLearnedCount = 0;
    return n;
  }

  /**
   * Classify a blob that may contain multiple speaker turns.
   *
   * Splits the blob into mini-turns at probable speaker-switch boundaries,
   * attributes each segment independently, and records them into session
   * history in order so that history-based alternation bias flows naturally
   * from segment to segment.
   *
   * This is the main entry point for listen-mode classification (AUTO mode).
   * It replaces the classify() + recordTurn() pair at the call site.
   *
   * @param text         - Raw transcribed blob (may be multi-turn)
   * @param firstTurnIdx - Turn index for the first segment (subsequent segments increment)
   * @returns Array of { text, result, turnIdx } — always at least 1 element.
   */
  classifySequence(text: string, firstTurnIdx: number): Array<{ text: string; result: SpeakerResult; turnIdx: number }> {
    const segments = this.splitIntoMiniTurns(text);
    const out: Array<{ text: string; result: SpeakerResult; turnIdx: number }> = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const tidx = firstTurnIdx + i;
      const result = this.classify(seg);
      // Record immediately — next segment's classify() will see this turn in history,
      // which activates the history-based alternation signal naturally.
      this.recordTurn(result, tidx, seg.length);
      out.push({ text: seg, result, turnIdx: tidx });
    }

    return out;
  }

  /**
   * Split a potentially multi-speaker blob into individual conversational acts.
   *
   * Uses a tiered set of linguistic markers to find probable speaker-switch
   * boundaries. Never over-splits — a minimum segment size and a hard cap on
   * the number of segments prevent noise from becoming spurious turns.
   */
  private splitIntoMiniTurns(text: string): string[] {
    const MIN_SEG  = 22; // minimum viable segment (chars) — filters whisper noise
    const MAX_SEGS = 5;  // cap — never produce more than 5 segments per blob

    if (text.length < MIN_SEG * 2) return [text]; // too short to split meaningfully

    const lower = text.toLowerCase();
    const candidates: number[] = [];

    // Mark candidate split positions. minOffset prevents splitting at blob start.
    const mark = (re: RegExp, minOffset = MIN_SEG): void => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        if (m.index >= minOffset) candidates.push(m.index);
      }
    };

    // ── Tier 1: Strongest signals — almost always start a new speaker turn ──
    mark(/\bhola\b/g);                              // greeting
    mark(/\bbuenos días\b/g);
    mark(/\bbuenas tardes\b/g);
    mark(/\bmucho gusto\b/g);
    mark(/\bencantad[oa]\b/g);                      // "encantado/a" — intro
    mark(/\bsoy [a-záéíóúñ]{2,}/g);                // "soy Alberto" — self-id
    mark(/\bme llamo [a-záéíóúñ]{2,}/g);
    mark(/\bmi nombre es [a-záéíóúñ]{2,}/g);

    // Known speaker names from session context — direct address or start of a turn
    if (this.vendorName) {
      const vn = this.vendorName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      mark(new RegExp(`\\b${vn}\\b`, "g"), MIN_SEG);
    }
    if (this.clientName) {
      const cn = this.clientName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      mark(new RegExp(`\\b${cn}\\b`, "g"), MIN_SEG);
    }

    // ── Tier 2: Moderate signals — require more preceding content ────────────
    // These are common conversational openers but can appear mid-sentence,
    // so we demand ≥ 2× MIN_SEG chars of context before them.
    const T2 = MIN_SEG * 2;
    mark(/\bno no\b/g, T2);           // emphatic denial — nearly always starts a response
    mark(/\bclaro claro\b/g, T2);     // emphatic agreement — starts a response
    mark(/\bsí sí\b/g, T2);           // emphatic agreement
    mark(/\ba ver[,\s]/g, T2);        // "a ver" — client response opener
    mark(/\bpues mira[,\s]/g, T2);    // vendor elaboration opener
    mark(/\bpues claro[,\s]/g, T2);
    mark(/\bes que[,\s]/g, T2);       // client hesitation opener
    mark(/\bla verdad[,\s]/g, T2);    // "la verdad es que"

    // ── Punctuation-based splits (when ASR outputs punctuation) ─────────────
    // Split at sentence-final punctuation only when followed by a known response starter.
    const sentEnd = /[.?!]\s+/g;
    let sm: RegExpExecArray | null;
    while ((sm = sentEnd.exec(lower)) !== null) {
      const after = sm.index + sm[0].length;
      if (after >= MIN_SEG) {
        const next = lower.slice(after, after + 15);
        if (/^(sí|no|claro|pues|mira|bueno|hola|oye|vale|a ver|exacto|perfecto|encantad|soy|me llamo)/.test(next)) {
          candidates.push(after);
        }
      }
    }

    if (candidates.length === 0) return [text];

    // Sort and remove near-duplicates (must be at least MIN_SEG apart)
    const sorted = [...new Set(candidates)].sort((a, b) => a - b);
    const merged: number[] = [];
    for (const c of sorted) {
      if (merged.length === 0 || c - merged[merged.length - 1]! >= MIN_SEG) {
        merged.push(c);
      }
    }

    // Build segments from position boundaries
    const boundaries = [0, ...merged, text.length];
    const segments: string[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const seg = text.slice(boundaries[i]!, boundaries[i + 1]!).trim();
      if (seg.length < MIN_SEG) continue; // skip whisper-length fragments
      if (segments.length < MAX_SEGS) {
        segments.push(seg);
      } else {
        // Merge remaining into last segment (respect MAX_SEGS cap)
        segments[segments.length - 1] += " " + seg;
      }
    }

    if (segments.length >= 2) {
      console.debug(`[vela:speaker] split blob (${text.length} chars) → ${segments.length} mini-turns`);
    }
    return segments.length >= 2 ? segments : [text];
  }

  /**
   * Classify a text fragment.
   * Always call recordTurn() after to persist the result.
   *
   * The blob-size guard is NAME-AWARE:
   *  - Without name signals: large blobs → UNKNOWN (they mix multiple speakers)
   *  - With name signals:    even large blobs can be confidently attributed because
   *                          a name mention is unambiguous regardless of blob size
   */
  classify(text: string): SpeakerResult {
    const HUGE_BLOB  = 350;
    const LARGE_BLOB = 180;
    const LARGE_CAP  = 0.40;

    // ── In-speech name learning ────────────────────────────────────────────
    // Must run BEFORE nameScore() is called so that a turn saying "soy Alberto"
    // immediately benefits from the name signal in the same classification cycle.
    this.learnNamesFromSpeech(text);

    // ── Rule score FIRST (name signals are included here) ─────────────────
    // Must run before the blob-size guard so name presence can override it.
    const { cs, vs } = this.ruleScore(text);
    const total = cs + vs;

    // A name signal contributes ≥ 8 points. If present, we have strong ground-truth.
    const hasNameSignal = (cs >= 8 || vs >= 8);

    // ── Blob-size guard (name-aware) ──────────────────────────────────────
    // Without a name signal: a large blob almost certainly mixes multiple speakers.
    // Attributing it with confidence would mean being "confident and wrong."
    // With a name signal: proceed — a blob with "soy Alberto" IS clearly the vendor.
    if (text.length > HUGE_BLOB && !hasNameSignal) {
      console.debug(`[vela:speaker] blob too large (${text.length} chars), no name signal → UNKNOWN`);
      return { speaker: "unknown", confidence: 0, source: "unknown", label: "" };
    }
    // Large blobs without name signals are capped; with name signals, proceed normally.
    const isLargeBlob = text.length > LARGE_BLOB && !hasNameSignal;

    // Confidence = spread relative to total mass, capped at 0.95
    const rawConf = total > 0
      ? Math.min(0.95, Math.abs(cs - vs) / Math.max(total * 0.45, 4))
      : 0;

    // ── High-confidence rule classification ───────────────────────────────
    // Large blobs without name signals are excluded from high-conf path.
    // Large blobs WITH name signals: allow up to 0.88 (slightly lower than 0.92
    // to acknowledge that even name-matched blobs may have some mixed content).
    const highConfCap = hasNameSignal ? 0.88 : 0.92;
    if (!isLargeBlob && rawConf >= 0.55 && total >= 4) {
      const speaker: SpeakerLabel = cs > vs ? "client" : "me";
      return { speaker, confidence: Math.min(highConfCap, rawConf), source: "rule", label: this.lbl(speaker) };
    }

    // ── Carryover ─────────────────────────────────────────────────────────
    const co = this.attemptCarryover(cs, vs, rawConf);
    if (co) {
      const conf = isLargeBlob ? Math.min(LARGE_CAP, co.confidence) : co.confidence;
      return { ...co, confidence: conf };
    }

    // ── Medium rule signal ────────────────────────────────────────────────
    if (total >= 2 && rawConf >= 0.38) {
      const speaker: SpeakerLabel = cs > vs ? "client" : "me";
      const conf = Math.min(isLargeBlob ? LARGE_CAP : 1, rawConf * 0.62);
      return { speaker, confidence: conf, source: "rule", label: this.lbl(speaker) };
    }

    // ── Session turn-length calibration ──────────────────────────────────
    // After the session has established clear patterns for both speakers,
    // use text length as a weak data-driven signal. This is not fragile rule
    // matching — it learns from what has actually happened in THIS conversation.
    const lengthSignal = this.turnLengthCalibration(text.length);
    if (lengthSignal) {
      return { speaker: lengthSignal.speaker, confidence: lengthSignal.confidence, source: "carryover", label: this.lbl(lengthSignal.speaker) };
    }

    return { speaker: "unknown", confidence: 0, source: "unknown", label: "" };
  }

  /**
   * Persist a classified turn to session history.
   */
  recordTurn(result: SpeakerResult, turnIndex: number, textLength: number): void {
    this.history.push({
      turnIndex,
      speaker: result.speaker,
      confidence: result.confidence,
      source: result.source,
      textLength,
      autoRepaired: false,
    });
    // Keep a rolling window of last 15 turns
    if (this.history.length > 15) this.history.shift();
  }

  /**
   * After a high-confidence classification, attempt to retroactively
   * re-attribute recent UNKNOWN / low-confidence turns.
   *
   * Returns Map<turnIndex, {speaker, confidence}> for entries to update.
   * The caller should apply these repairs to the turnLog state.
   */
  retrospectiveRepair(
    latestResult: SpeakerResult,
  ): Map<number, { speaker: SpeakerLabel; confidence: number }> {
    const repairs = new Map<number, { speaker: SpeakerLabel; confidence: number }>();

    if (latestResult.confidence < 0.50 || latestResult.speaker === "unknown") return repairs;

    // Need at least 2 recent high-conf turns (excluding the very last one we just recorded)
    const recentHighConf = this.history
      .filter(h => h.confidence >= 0.62 && h.speaker !== "unknown")
      .slice(-4);

    if (recentHighConf.length < 2) return repairs;

    // Check that the recent high-conf pattern agrees on dominant speaker
    const dominant = recentHighConf[recentHighConf.length - 1]!.speaker;
    const agreeing = recentHighConf.filter(h => h.speaker === dominant);
    if (agreeing.length < 2) return repairs;

    // Examine the last 5 entries (before the current one) for repair candidates
    const window = this.history.slice(-6, -1);

    for (let i = 0; i < window.length; i++) {
      const entry = window[i]!;
      if (entry.autoRepaired) continue;
      // Already confident enough — skip
      if (entry.confidence >= 0.52) continue;

      const prev = i > 0 ? window[i - 1] : null;
      const next = i < window.length - 1 ? window[i + 1] : null;

      // Pattern 1: sandwich — same dominant speaker on both sides with good confidence
      if (
        prev && next &&
        prev.speaker === dominant && prev.confidence >= 0.55 &&
        next.speaker === dominant && next.confidence >= 0.55
      ) {
        repairs.set(entry.turnIndex, { speaker: dominant, confidence: 0.52 });
        entry.autoRepaired = true;
        entry.speaker = dominant;
        entry.confidence = 0.52;
        this.autoReassigned++;
        continue;
      }

      // Pattern 2: short utterance after a high-conf same-speaker → likely continuation
      if (
        prev &&
        prev.speaker === dominant && prev.confidence >= 0.65 &&
        entry.textLength < 65 &&
        entry.speaker === "unknown"
      ) {
        repairs.set(entry.turnIndex, { speaker: dominant, confidence: 0.44 });
        entry.autoRepaired = true;
        entry.speaker = dominant;
        entry.confidence = 0.44;
        this.autoReassigned++;
      }
    }

    return repairs;
  }

  /**
   * Session-wide attribution metrics for observability and audit log.
   */
  getMetrics(): SpeakerSessionMetrics {
    const total = this.history.length;
    if (total === 0) {
      return {
        total: 0, client_count: 0, me_count: 0, unknown_count: 0,
        unknown_rate: 0, avg_confidence: 0, high_conf_rate: 0,
        low_conf_rate: 0, carryover_rate: 0, auto_reassigned_count: 0,
      };
    }
    const client_count = this.history.filter(h => h.speaker === "client").length;
    const me_count = this.history.filter(h => h.speaker === "me").length;
    const unknown_count = this.history.filter(h => h.speaker === "unknown").length;
    const avg_confidence = this.history.reduce((a, h) => a + h.confidence, 0) / total;
    const high_conf_rate = this.history.filter(h => h.confidence >= 0.70).length / total;
    const low_conf_rate = this.history.filter(h => h.confidence < 0.40).length / total;
    const carryover_rate = this.history.filter(h => h.source === "carryover").length / total;
    return {
      total, client_count, me_count, unknown_count,
      unknown_rate: unknown_count / total,
      avg_confidence,
      high_conf_rate,
      low_conf_rate,
      carryover_rate,
      auto_reassigned_count: this.autoReassigned,
    };
  }

  /**
   * Passive quality indicator for UI.
   */
  getQualityLevel(): SpeakerQualityLevel {
    const m = this.getMetrics();
    if (m.total < 5) return "normal"; // not enough history to judge
    if (m.unknown_rate > 0.52 || m.avg_confidence < 0.30) return "low";
    if (m.unknown_rate > 0.32 || m.avg_confidence < 0.48) return "watch";
    return "normal";
  }

  /** Reset — call when session is cleared. */
  reset(): void {
    this.history = [];
    this.autoReassigned = 0;
    this.contextSet = false;
    this.vendorName = null;
    this.clientName = null;
    this.namesLearnedCount = 0;
  }

  /**
   * Re-classify a set of historical turns using the CURRENT session state
   * (names learned, history patterns). Returns a repair map for all entries
   * that were UNKNOWN or low-confidence that can now be attributed.
   *
   * This is the canonical "make retrospective real" pass — call it:
   *  1. After names are newly learned from live speech (in-session fix)
   *  2. Before any post-call export / debrief (end-of-session fix)
   *
   * The caller applies the returned Map to turnLog state.
   * classify() is pure (it reads but does NOT mutate this.history), so
   * calling it here for old entries is safe and side-effect-free.
   */
  fullRetroPass(
    entries: Array<{ turnIndex: number; text: string; currentSpeaker: SpeakerLabel; currentConf: number }>,
  ): Map<number, { speaker: SpeakerLabel; confidence: number }> {
    const repairs = new Map<number, { speaker: SpeakerLabel; confidence: number }>();
    for (const entry of entries) {
      // Only revisit low-confidence or unknown turns — skip already-confident ones
      if (entry.currentConf >= 0.52 && entry.currentSpeaker !== "unknown") continue;
      const result = this.classify(entry.text);
      if (result.speaker !== "unknown" && result.speaker !== entry.currentSpeaker) {
        repairs.set(entry.turnIndex, { speaker: result.speaker, confidence: result.confidence });
        this.autoReassigned++;
      }
    }
    if (repairs.size > 0) {
      console.debug(`[vela:speaker] fullRetroPass repaired ${repairs.size} turn(s)`);
    }
    return repairs;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Extract speaker names from a free-text context string.
   * Handles the most common Spanish patterns users actually type.
   *
   * Examples matched:
   *  "Alberto = vendedor de Immvest, Wendy = clienta"
   *  "vendedor: Alberto, cliente: Wendy"
   *  "yo soy Alberto, la clienta es Carmen"
   *  "seller: John, client: Mary"
   */
  private parseNames(ctx: string): { vendor: string | null; client: string | null } {
    const VENDOR_WORDS = ["vendedor", "vendor", "comercial", "asesor", "seller", "sales", "closer", "representante"];
    const CLIENT_WORDS = ["cliente", "clienta", "prospecto", "prospect", "buyer", "comprador", "compradora", "lead", "decisor", "decisora"];

    // NAME_PAT: Capitalized name — first letter MUST be uppercase (no 'i' flag on regex).
    // Supports common accented capital letters. Matches 1 or 2 words.
    // BUG-FIXED: using 'g' flag only (not 'gi') — with 'gi' every two-letter word
    // like "es" or "de" would satisfy the pattern since case is ignored.
    const NAME_PAT = "([A-ZÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑÇÃÕÂÊÎÔÛ][a-záéíóúàèìòùäëïöüñçãõâêîôû]+(?:\\s+[A-ZÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑÇÃÕÂÊÎÔÛ][a-záéíóúàèìòùäëïöüñçãõâêîôû]+)?)";

    let vendor: string | null = null;
    let client: string | null = null;

    // Pattern 1: "NAME = role_keyword" — e.g. "Alberto = vendedor", "Wendy = clienta"
    // Role capture uses [\\w/áéíóúñ]+ WITHOUT spaces so it stops after the first role word
    // and does NOT consume the rest of the string (greedy \s bug fixed).
    const eqPattern = new RegExp(`${NAME_PAT}\\s*=\\s*([\\w/áéíóúñ]+)`, "g");
    for (const m of ctx.matchAll(eqPattern)) {
      const name = m[1]!.trim().split(" ")[0]!;
      const role = m[2]!.toLowerCase();
      if (!vendor && VENDOR_WORDS.some(w => role.startsWith(w))) vendor = name;
      if (!client && CLIENT_WORDS.some(w => role.startsWith(w))) client = name;
    }

    // Pattern 2: "role: NAME" or "role = NAME" — e.g. "vendedor: Alberto"
    if (!vendor || !client) {
      const allRoles = [...VENDOR_WORDS, ...CLIENT_WORDS].join("|");
      const rolePattern = new RegExp(`\\b(${allRoles})\\b[:\\s=]+${NAME_PAT}`, "g");
      for (const m of ctx.matchAll(rolePattern)) {
        const role = m[1]!.toLowerCase();
        const name = m[2]!.trim().split(" ")[0]!;
        if (!vendor && VENDOR_WORDS.includes(role)) vendor = name;
        if (!client && CLIENT_WORDS.includes(role)) client = name;
      }
    }

    // Pattern 3: "NAME (role)" — e.g. "Alberto (vendedor de Inmvest)"
    if (!vendor || !client) {
      const parenPattern = new RegExp(`${NAME_PAT}\\s*\\(([^)]+)\\)`, "g");
      for (const m of ctx.matchAll(parenPattern)) {
        const name = m[1]!.trim().split(" ")[0]!;
        const role = m[2]!.toLowerCase();
        if (!vendor && VENDOR_WORDS.some(w => role.includes(w))) vendor = name;
        if (!client && CLIENT_WORDS.some(w => role.includes(w))) client = name;
      }
    }

    if (vendor || client) {
      console.debug(`[vela:speaker] names detected — vendor="${vendor}", client="${client}"`);
    }

    // Sanity: don't assign the same name to both roles
    if (vendor && client && vendor.toLowerCase() === client.toLowerCase()) {
      client = null;
    }

    return { vendor, client };
  }

  /**
   * Attempt to extract speaker names from LIVE SPEECH.
   *
   * When the vendor says "soy Alberto" or "me llamo Wendy" in the transcript,
   * we can infer their name in real-time — even when the session context didn't
   * provide explicit name declarations. This is the key to unblocking the
   * HUGE_BLOB guard in sessions where context was generic.
   *
   * Called at the START of classify() so that the name is available for
   * nameScore() WITHIN THE SAME TURN that introduced it.
   *
   * Updates vendorName / clientName in-place; increments namesLearnedCount.
   */
  private learnNamesFromSpeech(text: string): void {
    const SELF_ID = ["soy ", "me llamo ", "i'm ", "i am ", "my name is "];
    const CAPITAL_NAME = /([A-ZÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑÇÃÕÂÊÎÔÛ][a-záéíóúàèìòùäëïöüñçãõâêîôû]{2,})/;

    const t = text.toLowerCase();

    if (!this.vendorName) {
      for (const prefix of SELF_ID) {
        const idx = t.indexOf(prefix);
        if (idx === -1) continue;
        // Grab the raw text at the same position (preserving case for extraction)
        const after = text.slice(idx + prefix.length).trimStart();
        const m = CAPITAL_NAME.exec(after);
        if (m) {
          this.vendorName = m[1]!;
          this.namesLearnedCount++;
          console.debug(`[vela:speaker] in-speech vendor name learned: "${this.vendorName}"`);
          break;
        }
      }
    }

    // Detect client self-identification in the same turn (less common but possible)
    if (!this.clientName && this.vendorName) {
      // Only look for a second name if we already know the vendor.
      // Pattern: "yo soy [VendorName]... la cliente es [ClientName]" or "habla [ClientName]"
      const clientHints = ["la cliente es ", "el cliente es ", "habla con ", "con mi cliente "];
      for (const prefix of clientHints) {
        const idx = t.indexOf(prefix);
        if (idx === -1) continue;
        const after = text.slice(idx + prefix.length).trimStart();
        const m = CAPITAL_NAME.exec(after);
        if (m && m[1]!.toLowerCase() !== this.vendorName.toLowerCase()) {
          this.clientName = m[1]!;
          this.namesLearnedCount++;
          console.debug(`[vela:speaker] in-speech client name learned: "${this.clientName}"`);
          break;
        }
      }
    }
  }

  /**
   * Name-based scoring: the strongest attribution signal available.
   * When speaker names are known from context, a mention of that name in
   * the transcript is near-unambiguous ground-truth.
   *
   * Returns bonus scores to add to cs/vs in ruleScore().
   * Score = 10: self-identification (e.g. "soy Alberto")
   * Score = 8: name mention without self-id prefix
   */
  private nameScore(text: string): { csBonus: number; vsBonus: number } {
    if (!this.vendorName && !this.clientName) return { csBonus: 0, vsBonus: 0 };

    const t = text.toLowerCase();
    let csBonus = 0;
    let vsBonus = 0;

    if (this.vendorName) {
      const vn = this.vendorName.toLowerCase();
      // Use word-boundary style: check that name is surrounded by non-alpha chars
      const vnRe = new RegExp(`(?:^|[^a-záéíóúñ])${vn}(?:$|[^a-záéíóúñ])`);
      if (vnRe.test(t)) {
        vsBonus += 8;
        // Extra for explicit self-identification
        if (t.includes(`soy ${vn}`) || t.includes(`me llamo ${vn}`) || t.includes(`i'm ${vn}`) || t.includes(`i am ${vn}`)) {
          vsBonus += 2;
        }
      }
    }

    if (this.clientName) {
      const cn = this.clientName.toLowerCase();
      const cnRe = new RegExp(`(?:^|[^a-záéíóúñ])${cn}(?:$|[^a-záéíóúñ])`);
      if (cnRe.test(t)) {
        csBonus += 8;
        if (t.includes(`soy ${cn}`) || t.includes(`me llamo ${cn}`) || t.includes(`i'm ${cn}`) || t.includes(`i am ${cn}`)) {
          csBonus += 2;
        }
      }
    }

    return { csBonus, vsBonus };
  }

  /**
   * Data-driven turn-length calibration.
   *
   * In most sales conversations the vendor turns are longer (explaining, proposing)
   * and the client turns are shorter (questioning, reacting). After the session
   * has established enough high-confidence examples of both speakers, we can use
   * the text length of a NEW, ambiguous fragment as a weak additional signal.
   *
   * Only fires when:
   *  - ≥ 4 high-confidence "me" turns AND ≥ 3 high-confidence "client" turns
   *  - The length gap between the two speaker averages is meaningful (> 30 chars)
   *  - The new text clearly falls into the territory of one speaker pattern
   *  - The context has been set (opt-in — ensures this is a real session)
   *
   * Returns null when conditions are not met (always prefer UNKNOWN over guessing).
   */
  private turnLengthCalibration(
    textLen: number,
  ): { speaker: SpeakerLabel; confidence: number } | null {
    if (!this.contextSet) return null;

    const myTurns     = this.history.filter(h => h.speaker === "me"     && h.confidence >= 0.60);
    const clientTurns = this.history.filter(h => h.speaker === "client" && h.confidence >= 0.60);

    if (myTurns.length < 4 || clientTurns.length < 3) return null;

    const avgMe     = myTurns.reduce((a, h) => a + h.textLength, 0) / myTurns.length;
    const avgClient = clientTurns.reduce((a, h) => a + h.textLength, 0) / clientTurns.length;
    const lenGap    = Math.abs(avgMe - avgClient);

    // Only apply if there's a clear, consistent length difference
    if (lenGap < 30) return null;

    const midpoint = (avgMe + avgClient) / 2;

    // Text clearly in the "long" zone — vendor territory
    if (textLen > midpoint * 1.3 && avgMe > avgClient) {
      return { speaker: "me", confidence: 0.36 };
    }
    // Text clearly in the "short" zone — client territory
    if (textLen < midpoint * 0.65 && avgClient < avgMe) {
      return { speaker: "client", confidence: 0.36 };
    }

    return null;
  }

  private ruleScore(text: string): { cs: number; vs: number } {
    const t = text.toLowerCase();
    let cs = 0;
    let vs = 0;

    if (this.lang === "en") {
      const clientHigh = [
        "i don't see it", "i'm not convinced", "i'm worried about", "i don't know",
        "that seems expensive", "i don't want to make a mistake", "explain it to me",
        "why should i", "i'm not sure", "i have doubts", "i'm afraid",
        "i don't trust", "seems risky", "i'd rather", "what guarantees",
        "what if it goes wrong", "i don't understand", "that's too much",
        "i was thinking", "my concern is", "the problem for me",
        "honestly i", "i've been thinking", "i'm not ready",
        "how much would it cost", "what does it cost", "what's the price",
        "i expected", "can you explain", "i need to think",
      ];
      const clientMid = [
        "but", "although", "however", "what if", "yes but",
        "still", "i mean", "i guess", "maybe", "possibly",
        "i was wondering", "i'm concerned",
      ];
      const vendorHigh = [
        "i understand your", "i understand that", "if you'd like", "the idea here",
        "what we're looking for", "let me explain", "what matters is",
        "precisely", "what you have here", "this means",
        "let me ask you", "imagine if", "what i'm proposing",
        "the key here", "think of it this way", "let me show you",
        "what we do is", "our approach", "we've seen", "in our experience",
        "we offer", "we provide", "i'll send you", "i'll call you",
        "let's schedule", "i propose", "the numbers are", "the return is",
        "our clients", "to summarize", "in short", "the bottom line is",
        "look", "listen", "here's the thing", "here's what i'd say",
        "let me break it down", "so what this means", "let me be direct",
        "what we want to achieve", "our goal is", "we've helped",
      ];
      const vendorMid = [
        "exactly", "of course", "that is", "in that case", "makes sense",
        "right so", "so the idea", "to be clear",
      ];

      for (const s of clientHigh) if (t.includes(s)) cs += 3;
      for (const s of clientMid)  if (t.includes(s)) cs += 1.5;
      for (const s of vendorHigh) if (t.includes(s)) vs += 3;
      for (const s of vendorMid)  if (t.includes(s)) vs += 1.5;

    } else {
      // ── Spanish ───────────────────────────────────────────────────────────
      const clientHigh = [
        "no lo veo", "no me convence", "me preocupa", "no conozco",
        "me parece caro", "no quiero equivocarme", "explícame",
        "por qué debería", "no sé si", "tengo dudas", "no estoy seguro",
        "me da miedo", "no me fío", "no confío", "parece arriesgado",
        "prefiero", "me gusta más", "qué garantías", "y si sale mal",
        "no lo entiendo", "eso es demasiado", "es que no", "no lo veo claro",
        "cuánto costaría", "cuánto sería", "cuánto cuesta", "cuánto vale",
        "qué precio", "yo creo que no", "no tengo claro",
        "la verdad es que", "te digo la verdad",
        "es que yo", "yo lo que quiero", "lo que me preocupa",
        "sinceramente", "francamente", "honestamente",
        "pensaba que", "esperaba que", "mi duda es", "mi pregunta es",
        "a mí me parece", "yo lo veo", "no me queda claro",
        "tengo una pregunta", "una pregunta", "¿y si", "¿qué pasa si",
        "¿y el precio", "¿cuánto",
      ];
      const clientMid = [
        "pero", "aunque", "sin embargo", "claro pero",
        "sí pero", "es que", "a ver", "no sé", "bueno",
        "pues", "oye", "oiga", "lo que pasa", "el problema es",
        "mi caso es", "la verdad", "a mí", "yo no",
      ];
      const vendorHigh = [
        "entiendo tu", "entiendo que", "si te parece", "la idea aquí",
        "lo que buscamos", "te explico", "lo importante es",
        "de hecho", "precisamente", "lo que tienes", "esto significa",
        "bajemos", "concretemos", "dime una cosa", "pregunto",
        "imagina que", "te propongo", "lo que te ofrezco",
        "la clave aquí", "piénsalo así", "lo que hacemos", "nuestro proceso",
        "nosotros ofrecemos", "os enviamos", "te mandamos", "te envío",
        "os llamamos", "te llamo", "quedamos", "agendamos",
        "nuestros clientes", "en nuestra experiencia", "lo que hemos visto",
        "el retorno es", "la rentabilidad es", "los números son",
        "en resumen", "para resumir", "lo que quiero decirte",
        "voy a explicarte", "voy a contarte", "como te decía",
        "como comentábamos", "escucha", "mira una cosa",
        "déjame preguntarte", "te hago una pregunta", "mi propuesta es",
        "nuestro enfoque", "nuestra solución", "lo que ofrecemos",
        "vendemos", "gestionamos", "trabajamos con",
        "la propuesta es", "el precio es", "el coste es", "la inversión es",
        "lo que os proponemos", "os comento", "te comento",
        "quiero que veas", "fíjate en", "mira el dato",
      ];
      const vendorMid = [
        "exacto", "claro", "por supuesto", "es decir",
        "en ese caso", "tiene sentido", "de acuerdo", "entendido",
        "bien", "perfecto", "correcto",
      ];

      for (const s of clientHigh) if (t.includes(s)) cs += 3;
      for (const s of clientMid)  if (t.includes(s)) cs += 1.5;
      for (const s of vendorHigh) if (t.includes(s)) vs += 3;
      for (const s of vendorMid)  if (t.includes(s)) vs += 1.5;

      // First-person plural → very strong vendor signal (speaking as company)
      const plural = ["nosotros", "nuestro", "nuestra", "nuestros", "nuestras"];
      for (const s of plural) if (t.includes(s)) vs += 2;

      // Short affirmative alone → likely client responding to seller
      const affirmatives = ["sí", "si", "no", "claro", "vale", "de acuerdo", "ok", "bien"];
      if (text.trim().length < 30) {
        for (const s of affirmatives) {
          if (t.trim() === s || t.trim().startsWith(s + " ") || t.trim().startsWith(s + ",")) {
            cs += 2;
            break;
          }
        }
      }
    }

    // ── Name signals (strongest signal — must run every time) ─────────────
    // Names from session context are near-unambiguous ground truth.
    // These high-weight scores allow the blob-size guard to be bypassed
    // when a name is present, giving attribution even on large blobs.
    const { csBonus, vsBonus } = this.nameScore(text);
    cs += csBonus;
    vs += vsBonus;

    // Turn alternation: mild push toward the opposite speaker
    const last = this.history.length > 0 ? this.history[this.history.length - 1] : null;
    if (last?.speaker === "me"     && last.confidence >= 0.50) cs += 1;
    if (last?.speaker === "client" && last.confidence >= 0.50) vs += 1;

    return { cs, vs };
  }

  private attemptCarryover(cs: number, vs: number, rawConf: number): SpeakerResult | null {
    // "me" requires a longer streak (3) to activate carryover — the main source
    // of systematic vendor-bias in AUTO mode. Client needs only 2.
    const streakSpeaker =
      this.getStreakSpeaker("me", 3) ?? this.getStreakSpeaker("client", 2);
    if (!streakSpeaker) return null;

    const oppositeScore = streakSpeaker === "me" ? cs : vs;

    // Strong opposing signal → speaker probably changed
    if (oppositeScore >= 4.5) return null;

    // Moderate opposing signal with no same-direction rule → skip carryover
    if (oppositeScore >= 2.5 && rawConf < 0.15) return null;

    // Carryover: moderate confidence. Longer streak = slightly more confident.
    const streak3 = this.getStreakSpeaker(streakSpeaker, 3);
    const carryConf = streak3 ? 0.66 : 0.52;
    return {
      speaker: streakSpeaker,
      confidence: Math.max(0.42, carryConf - rawConf * 0.25),
      source: "carryover",
      label: this.lbl(streakSpeaker),
    };
  }

  private getStreakSpeaker(candidate: SpeakerLabel, minStreak: number): SpeakerLabel | null {
    if (this.history.length < minStreak) return null;
    const recent = this.history
      .slice(-minStreak)
      .filter(h => h.confidence >= 0.52 && h.speaker === candidate);
    return recent.length >= minStreak ? candidate : null;
  }

  private lbl(speaker: SpeakerLabel): string {
    if (speaker === "unknown") return "";
    if (this.lang === "en") return speaker === "client" ? "client" : "me";
    return speaker === "client" ? "cliente" : "yo";
  }
}
