import { useRef, useCallback, useState } from "react";

const CHUNK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface UseAudioRecorderOptions {
  onChunkReady?: (blob: Blob) => void;
}

export function useAudioRecorder({ onChunkReady }: UseAudioRecorderOptions = {}) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const flushChunks = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    const toFlush = chunksRef.current;
    chunksRef.current = [];
    if (toFlush.length > 0 && onChunkReady) {
      const mimeType = recorder?.mimeType ?? "audio/webm";
      const blob = new Blob(toFlush, { type: mimeType });
      if (blob.size > 0) onChunkReady(blob);
    }
  }, [onChunkReady]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(5000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);

      // Auto-flush every 10 minutes
      if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = setInterval(() => {
        const rec = mediaRecorderRef.current;
        if (rec && rec.state === "recording") {
          rec.requestData(); // force latest audio into ondataavailable before flushing
        }
        setTimeout(flushChunks, 300);
      }, CHUNK_INTERVAL_MS);
    } catch (err) {
      console.error("[vela:recorder] failed to start", err);
    }
  }, [flushChunks]);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (chunkIntervalRef.current) {
        clearInterval(chunkIntervalRef.current);
        chunkIntervalRef.current = null;
      }
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        setIsRecording(false);
        recorder.stream.getTracks().forEach(t => t.stop());
        resolve(blob.size > 0 ? blob : null);
      };
      recorder.stop();
    });
  }, []);

  return { startRecording, stopRecording, isRecording };
}
