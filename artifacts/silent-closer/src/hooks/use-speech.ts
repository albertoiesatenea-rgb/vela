import { useState, useEffect, useRef, useCallback } from "react";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface UseSpeechProps {
  onAnalyzeReady: (text: string) => void;
  analysisIntervalMs?: number;
  lang?: "es" | "en";
}

// ── Batching thresholds ──────────────────────────────────────────────────────
// If this many ms pass between two consecutive final results, the next one is
// treated as a probable new speaker turn: the existing buffer is flushed first.
const INTER_TURN_GAP_MS     = 1500; // longer gap = more reliable turn-change detection
// If the accumulated buffer exceeds this, force a flush regardless of timing.
const MAX_BATCH_CHARS       = 280;  // smaller cap keeps blobs manageable for attribution
// Minimum meaningful content before we bother sending a batch to analyze.
const MIN_FLUSH_CHARS       = 12;
// A single final fragment this long or more is a "complete thought" — flush
// immediately so it gets its own analysis batch instead of merging with
// the next speaker's words.
const IMMEDIATE_FLUSH_CHARS = 60;   // raised — short fragments can afford to batch

type FlushReason = "interval" | "inter_turn_gap" | "max_chars" | "stop" | "immediate";

export function useSpeech({ onAnalyzeReady, analysisIntervalMs = 5000, lang = "es" }: UseSpeechProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interimText, setInterimText] = useState("");

  // ── Refs — all mutable state that must be synchronous ──────────────────
  const recognitionRef   = useRef<any>(null);
  const transcriptBuffer = useRef<string>("");
  const shouldListenRef  = useRef(false);   // user intent
  const isActiveRef      = useRef(false);   // recognition actually running right now
  const lastStartRef     = useRef(0);       // throttle rapid restarts
  const langRef          = useRef(lang);    // always current lang without re-creating recognition
  langRef.current = lang;

  const onAnalyzeReadyRef = useRef(onAnalyzeReady);
  onAnalyzeReadyRef.current = onAnalyzeReady;

  // ── Batch timing ────────────────────────────────────────────────────────
  // Timestamp (ms) of the last `isFinal` result received from the browser.
  // 0 = no finals yet in this session. Used to detect inter-turn pauses.
  const lastFinalAtRef = useRef<number>(0);

  // ── Analysis interval ──────────────────────────────────────────────────
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Flush — defined as a ref so recognition callbacks always see latest ─
  const flushBufferRef = useRef<(reason: FlushReason) => void>(() => {});
  flushBufferRef.current = (reason) => {
    const text = transcriptBuffer.current.trim();
    if (text.length < MIN_FLUSH_CHARS) return;
    console.debug(
      `[vela:speech] flush reason=${reason} chars=${text.length} preview="${text.slice(0, 60).replace(/\n/g, " ")}..."`,
    );
    onAnalyzeReadyRef.current(text);
    transcriptBuffer.current = "";
    setInterimText("");
  };

  const stopInterval = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const startInterval = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      const buf = transcriptBuffer.current.trim();
      if (buf.length >= MIN_FLUSH_CHARS) {
        flushBufferRef.current("interval");
      }
    }, analysisIntervalMs);
  }, [analysisIntervalMs]);

  // ── tryStart — throttled, safe to call inside onend ────────────────────
  const tryStartRef = useRef<() => void>(() => {});
  tryStartRef.current = () => {
    if (!recognitionRef.current) return;
    if (!shouldListenRef.current) return;
    if (isActiveRef.current) return;
    const now = Date.now();
    if (now - lastStartRef.current < 300) return;
    lastStartRef.current = now;
    recognitionRef.current.lang = langRef.current === "en" ? "en-US" : "es-ES";
    try {
      recognitionRef.current.start();
    } catch {
      // Ignore — watchdog will retry
    }
  };

  // ── Watchdog — every 2.5s, restart if we should be listening but aren't ─
  const startWatchdog = useCallback(() => {
    if (watchdogRef.current) return;
    watchdogRef.current = setInterval(() => {
      if (shouldListenRef.current && !isActiveRef.current) {
        tryStartRef.current();
      }
    }, 2500);
  }, []);

  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
  }, []);

  // ── Build recognition once on mount ───────────────────────────────────
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setIsSupported(false); return; }
    setIsSupported(true);

    const recognition = new SpeechRecognition();
    // continuous = true: recognition never auto-stops between pauses, so we
    // never lose audio during the restart gap (was 120ms, caused 50-80% loss
    // in fast conversations). The old continuous=false note about 2000+ char
    // blobs was a batching problem — now solved by MAX_BATCH_CHARS=280,
    // IMMEDIATE_FLUSH_CHARS=60, and a 5s interval flush safety net.
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.lang            = "es-ES";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isActiveRef.current = true;
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const fragment: string = event.results[i][0].transcript;
          const now = Date.now();

          // ── Inter-turn gap detection ───────────────────────────────────
          // If enough time passed since the last final, this fragment likely
          // belongs to a new speaker turn — flush the existing buffer first,
          // so they don't get merged into one analysis blob.
          if (
            lastFinalAtRef.current > 0 &&
            now - lastFinalAtRef.current > INTER_TURN_GAP_MS &&
            transcriptBuffer.current.trim().length >= MIN_FLUSH_CHARS
          ) {
            console.debug(
              `[vela:speech] inter_turn_gap=${now - lastFinalAtRef.current}ms — ` +
              `flushing buffer (${transcriptBuffer.current.trim().length} chars) before new fragment`,
            );
            onAnalyzeReadyRef.current(transcriptBuffer.current.trim());
            transcriptBuffer.current = "";
          }

          lastFinalAtRef.current = now;

          // ── Long-fragment splitter ────────────────────────────────────
          // With continuous=true the browser can deliver a single isFinal
          // that covers 400–2000 chars of speech. Accumulating that whole
          // chunk would produce one massive blob that attribution can't
          // separate. Split at word boundaries into ≤MAX_CHUNK segments,
          // flushing each one directly, and put only the tail in the buffer.
          const MAX_CHUNK = 250;
          if (fragment.length > MAX_CHUNK) {
            const words = fragment.split(" ");
            let chunk = "";
            for (const word of words) {
              const candidate = chunk ? chunk + " " + word : word;
              if (candidate.length > MAX_CHUNK && chunk.length >= MIN_FLUSH_CHARS) {
                onAnalyzeReadyRef.current(chunk.trim());
                chunk = word;
              } else {
                chunk = candidate;
              }
            }
            // Remaining tail goes into the normal buffer
            if (chunk.trim().length >= MIN_FLUSH_CHARS) {
              transcriptBuffer.current += chunk + " ";
            }
          } else {
            transcriptBuffer.current += fragment + " ";
          }

          const bufLen = transcriptBuffer.current.trim().length;
          console.debug(
            `[vela:speech] final_fragment chars=${fragment.length} ` +
            `buffer_total=${bufLen}`,
          );

          // ── Max chars guard ────────────────────────────────────────────
          if (bufLen >= MAX_BATCH_CHARS) {
            flushBufferRef.current("max_chars");
          }
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setInterimText(interim);
    };

    recognition.onerror = (event: any) => {
      const e = event.error;
      if (e === "not-allowed" || e === "service-not-allowed") {
        setError("Permiso de micrófono denegado. Abre la app en una pestaña separada y acepta el permiso.");
        shouldListenRef.current = false;
        isActiveRef.current = false;
        setIsListening(false);
      } else if (e === "no-speech" || e === "aborted" || e === "network") {
        // Non-fatal — onend will fire and watchdog/restart will recover
        isActiveRef.current = false;
      } else {
        setError(`Error de audio: ${e}`);
        shouldListenRef.current = false;
        isActiveRef.current = false;
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      isActiveRef.current = false;
      setIsListening(false);
      setInterimText("");
      // With continuous=true, onend only fires when the user explicitly stops
      // or on a browser error — not after every natural pause.
      // Restart with 300ms delay; watchdog covers any case we miss.
      if (shouldListenRef.current) {
        setTimeout(() => tryStartRef.current(), 300);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      isActiveRef.current = false;
      try { recognition.stop(); } catch { /* ignore */ }
    };
  }, []); // only once

  // ── Public API ─────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setError(null);
    transcriptBuffer.current = "";
    lastFinalAtRef.current = 0;
    shouldListenRef.current = true;
    startInterval();
    startWatchdog();
    tryStartRef.current();
  }, [startInterval, startWatchdog]);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    isActiveRef.current = false;
    stopInterval();
    stopWatchdog();
    setIsListening(false);
    setInterimText("");
    // Flush any remaining content as a final turn
    flushBufferRef.current("stop");
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  }, [stopInterval, stopWatchdog]);

  return { isSupported, isListening, error, interimText, startListening, stopListening };
}
