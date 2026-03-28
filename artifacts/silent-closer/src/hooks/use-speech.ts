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
}

export function useSpeech({ onAnalyzeReady, analysisIntervalMs = 8000 }: UseSpeechProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interimText, setInterimText] = useState("");

  const recognitionRef = useRef<any>(null);
  const transcriptBuffer = useRef<string>("");

  // Intent ref — set by user action only, never by recognition bounces
  const shouldListenRef = useRef(false);

  // Stable callback ref
  const onAnalyzeReadyRef = useRef(onAnalyzeReady);
  onAnalyzeReadyRef.current = onAnalyzeReady;

  // Interval ref — managed by startListening / stopListening, not by isListening state
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startInterval = useCallback(() => {
    if (intervalRef.current) return; // already running
    intervalRef.current = setInterval(() => {
      const text = transcriptBuffer.current.trim();
      if (text.length > 10) {
        onAnalyzeReadyRef.current(text);
        transcriptBuffer.current = "";
        setInterimText("");
      }
    }, analysisIntervalMs);
  }, [analysisIntervalMs]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Initialize Speech Recognition once on mount
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "es-ES";

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: any) => {
      let currentInterim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          transcriptBuffer.current += event.results[i][0].transcript + " ";
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }
      setInterimText(currentInterim);
    };

    recognition.onerror = (event: any) => {
      const errType = event.error;
      if (errType === "not-allowed" || errType === "service-not-allowed") {
        setError("Permiso de micrófono denegado. Abre la app en una pestaña separada y acepta el permiso.");
        shouldListenRef.current = false;
        setIsListening(false);
      } else if (errType === "no-speech" || errType === "aborted") {
        // Non-fatal — recognition will fire onend and we'll restart
      } else {
        setError(`Error: ${errType}`);
        shouldListenRef.current = false;
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Only update UI state — don't touch the interval
      setIsListening(false);
      setInterimText("");

      // Auto-restart if user still wants to listen
      if (shouldListenRef.current) {
        setTimeout(() => {
          if (shouldListenRef.current) {
            try {
              recognition.start();
            } catch {
              // Already starting — ignore
            }
          }
        }, 250);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      try { recognition.stop(); } catch { /* ignore */ }
    };
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setError(null);
    transcriptBuffer.current = "";
    shouldListenRef.current = true;
    startInterval();
    try {
      recognitionRef.current.start();
    } catch {
      // Might already be running
    }
  }, [startInterval]);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    stopInterval();
    setIsListening(false);
    setInterimText("");
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
  }, [stopInterval]);

  return {
    isSupported,
    isListening,
    error,
    interimText,
    startListening,
    stopListening,
  };
}
