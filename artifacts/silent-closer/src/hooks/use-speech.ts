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

// Minimum meaningful content before we bother sending a batch to analyze.
const MIN_FLUSH_CHARS = 12;

type FlushReason = "interval" | "stop" | "interim_fallback";

export function useSpeech({ onAnalyzeReady, analysisIntervalMs = 5000, lang = "es" }: UseSpeechProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interimText, setInterimText] = useState("");

  // ── Refs — all mutable state that must be synchronous ──────────────────
  const recognitionRef      = useRef<any>(null);
  const transcriptBuffer    = useRef<string>("");
  const shouldListenRef     = useRef(false);   // user intent
  const isActiveRef         = useRef(false);   // recognition actually running right now
  const lastStartRef        = useRef(0);       // throttle rapid restarts
  const langRef             = useRef(lang);    // always current lang without re-creating recognition
  langRef.current = lang;

  const onAnalyzeReadyRef   = useRef(onAnalyzeReady);
  onAnalyzeReadyRef.current = onAnalyzeReady;

  // Tracks the most recent interim transcript so the interval can promote it
  // to "final" when Chrome never generates isFinal (speaker audio scenario).
  const latestInterimRef = useRef<string>("");
  // Tracks the last interim text that was flushed, so we can diff against it
  // and send only the new portion — prevents repeated prefixes when Chrome
  // restarts recognition mid-utterance and re-transcribes from the beginning.
  const lastInterimFlushedRef = useRef<string>("");

  // ── Analysis interval ──────────────────────────────────────────────────
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Flush — picks up isFinal buffer, falls back to interim if empty ───
  const flushBufferRef = useRef<(reason: FlushReason) => void>(() => {});
  flushBufferRef.current = (reason) => {
    // Primary: committed isFinal fragments
    let text = transcriptBuffer.current.trim();

    // Fallback: if Chrome never fired isFinal (speaker-audio quirk), use
    // the latest interim text so the session keeps flowing.
    if (text.length < MIN_FLUSH_CHARS) {
      const interim = latestInterimRef.current.trim();
      if (interim.length >= MIN_FLUSH_CHARS) {
        // Chrome re-transcribes from the start of each recognition cycle, so
        // each new interim is a growing prefix of all previous interims.
        // Extract only the truly new suffix to avoid sending repeated text.
        const lastSent = lastInterimFlushedRef.current;
        let newText = interim;
        if (lastSent.length > 0 && interim.startsWith(lastSent)) {
          newText = interim.slice(lastSent.length).trim();
        }
        if (newText.length < MIN_FLUSH_CHARS) return; // no new content yet
        lastInterimFlushedRef.current = interim;
        latestInterimRef.current = "";
        setInterimText("");
        console.debug(
          `[vela:speech] flush reason=interim_fallback chars=${newText.length} ` +
          `preview="${newText.slice(0, 60).replace(/\n/g, " ")}..."`,
        );
        onAnalyzeReadyRef.current(newText);
        return;
      }
      return; // nothing to flush
    }

    console.debug(
      `[vela:speech] flush reason=${reason} chars=${text.length} ` +
      `preview="${text.slice(0, 60).replace(/\n/g, " ")}..."`,
    );
    onAnalyzeReadyRef.current(text);
    transcriptBuffer.current = "";
    latestInterimRef.current = "";
    lastInterimFlushedRef.current = "";
    setInterimText("");
  };

  const stopInterval = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const startInterval = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      flushBufferRef.current("interval");
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
    // continuous=false: Chrome does not generate isFinal events when audio
    // comes from a speaker/playback source with continuous=true.
    // With continuous=false the browser fires onend after each utterance
    // and we restart in 50ms. For the speaker-audio case where isFinal
    // never arrives, latestInterimRef carries the interim text into the
    // 5-second interval flush as a fallback.
    recognition.continuous      = false;
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
          transcriptBuffer.current += fragment + " ";
          // A real isFinal means the prefix-growth cycle resets — clear
          // both interim tracking refs so the next fallback diff is clean.
          latestInterimRef.current = "";
          lastInterimFlushedRef.current = "";
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (interim) {
        // Keep the latest interim snapshot so the interval can fall back to it
        // if isFinal never arrives (speaker-audio scenario).
        latestInterimRef.current = interim;
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
      // Restart immediately — 50ms keeps the gap too short to lose audio
      // between utterances. Watchdog covers any edge case we miss.
      if (shouldListenRef.current) {
        setTimeout(() => tryStartRef.current(), 50);
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
    latestInterimRef.current = "";
    lastInterimFlushedRef.current = "";
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
    // Flush any remaining content — isFinal buffer first, interim fallback second
    flushBufferRef.current("stop");
    latestInterimRef.current = "";
    lastInterimFlushedRef.current = "";
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  }, [stopInterval, stopWatchdog]);

  return { isSupported, isListening, error, interimText, startListening, stopListening };
}
