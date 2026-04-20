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
  private contextSet = false; // true once setContext() has been called for this session

  constructor(lang: "es" | "en" = "es") {
    this.lang = lang;
  }

  setLang(lang: "es" | "en"): void { this.lang = lang; }

  /**
   * Provide the session context string so the classifier can learn session-specific
   * patterns (primarily turn-length calibration from established history).
   * Safe to call multiple times — idempotent after the first call per session.
   */
  setContext(_contextStr: string): void {
    // Context text itself isn't reliably parseable for speaker vocabulary
    // (both speakers use the same domain terms). The real gain comes from
    // turn-length calibration which is computed dynamically from session history.
    // Mark context as set so calibration can activate earlier.
    this.contextSet = true;
  }

  /**
   * Classify a text fragment.
   * Always call recordTurn() after to persist the result.
   */
  classify(text: string): SpeakerResult {
    const { cs, vs } = this.ruleScore(text);
    const total = cs + vs;

    // Confidence = spread relative to total mass, capped at 0.95
    const rawConf = total > 0
      ? Math.min(0.95, Math.abs(cs - vs) / Math.max(total * 0.45, 4))
      : 0;

    // High-confidence rule classification
    if (rawConf >= 0.55 && total >= 4) {
      const speaker: SpeakerLabel = cs > vs ? "client" : "me";
      return { speaker, confidence: Math.min(0.92, rawConf), source: "rule", label: this.lbl(speaker) };
    }

    // Try carryover (streak of high-conf turns)
    const co = this.attemptCarryover(cs, vs, rawConf);
    if (co) return co;

    // Medium rule signal with clear direction — low-confidence classification.
    // Threshold raised to 0.38 to reduce false positives on ambiguous speech.
    if (total >= 2 && rawConf >= 0.38) {
      const speaker: SpeakerLabel = cs > vs ? "client" : "me";
      return { speaker, confidence: rawConf * 0.62, source: "rule", label: this.lbl(speaker) };
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

    if (latestResult.confidence < 0.65 || latestResult.speaker === "unknown") return repairs;

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
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

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
