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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // Use a ref for "should be listening" to avoid stale closure issues
  const shouldListenRef = useRef(false);
  const onAnalyzeReadyRef = useRef(onAnalyzeReady);
  onAnalyzeReadyRef.current = onAnalyzeReady;

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
      } else if (errType === "no-speech") {
        // Ignore — no speech is fine, keep listening
      } else if (errType === "aborted") {
        // Ignore — aborted is expected when we stop manually
      } else {
        setError(`Error: ${errType}`);
        shouldListenRef.current = false;
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText("");
      // Auto-restart only if we still intend to listen and no error blocked us
      if (shouldListenRef.current) {
        setTimeout(() => {
          if (shouldListenRef.current) {
            try {
              recognition.start();
            } catch {
              // Recognition might already be starting — ignore
            }
          }
        }, 300);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  // Periodic Analysis Trigger
  useEffect(() => {
    if (isListening) {
      intervalRef.current = setInterval(() => {
        const textToAnalyze = transcriptBuffer.current.trim();
        if (textToAnalyze.length > 10) {
          onAnalyzeReadyRef.current(textToAnalyze);
          transcriptBuffer.current = "";
          setInterimText("");
        }
      }, analysisIntervalMs);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isListening, analysisIntervalMs]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setError(null);
    transcriptBuffer.current = "";
    shouldListenRef.current = true;
    try {
      recognitionRef.current.start();
    } catch {
      // Might already be running — that's fine
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    setIsListening(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  return {
    isSupported,
    isListening,
    error,
    interimText,
    startListening,
    stopListening,
  };
}
