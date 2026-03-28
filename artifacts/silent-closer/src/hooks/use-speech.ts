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
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interimText, setInterimText] = useState("");

  const recognitionRef = useRef<any>(null);
  const transcriptBuffer = useRef<string>("");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setIsSupported(false);
      setError("Speech recognition is not supported in this browser. Use Simulate mode.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "es-ES"; // Default to Spanish as requested in the prompt, but can be configured

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
      console.error("Speech recognition error", event.error);
      if (event.error !== "no-speech") {
        setError(`Mic error: ${event.error}`);
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Auto-restart if we are supposed to be listening (continuous listening resilience)
      if (isListening) {
        try {
          recognition.start();
        } catch (e) {
          // Ignore restart errors
        }
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [isListening]);

  // Periodic Analysis Trigger
  useEffect(() => {
    if (isListening) {
      intervalRef.current = setInterval(() => {
        const textToAnalyze = transcriptBuffer.current.trim();
        if (textToAnalyze.length > 5) { // Only analyze if there's meaningful text
          onAnalyzeReady(textToAnalyze);
          transcriptBuffer.current = ""; // Clear buffer after sending
          setInterimText(""); // Clear interim too
        }
      }, analysisIntervalMs);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isListening, onAnalyzeReady, analysisIntervalMs]);

  const startListening = useCallback(() => {
    setError(null);
    transcriptBuffer.current = "";
    try {
      if (recognitionRef.current) {
        recognitionRef.current.start();
        setIsListening(true);
      }
    } catch (err) {
      console.error("Failed to start recognition", err);
    }
  }, []);

  const stopListening = useCallback(() => {
    setIsListening(false);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  return {
    isSupported,
    isListening,
    error,
    interimText,
    startListening,
    stopListening
  };
}
