import { useRef, useCallback, useState } from "react";

const CHUNK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface UseAudioRecorderOptions {
  onChunkReady?: (blob: Blob) => void;
}

export function useAudioRecorder({ onChunkReady }: UseAudioRecorderOptions = {}) {
  const mediaRecorderRef   = useRef<MediaRecorder | null>(null);
  const chunksRef          = useRef<Blob[]>([]);
  const chunkIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  // const audioContextRef    = useRef<AudioContext | null>(null);   // [DISPLAY-MEDIA DISABLED]
  const micStreamRef       = useRef<MediaStream | null>(null);
  // const sysStreamRef       = useRef<MediaStream | null>(null);   // [DISPLAY-MEDIA DISABLED]

  const [isRecording,       setIsRecording]       = useState(false);
  const [systemAudioActive, setSystemAudioActive] = useState(false); // always false while disabled

  const flushChunks = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    const toFlush  = chunksRef.current;
    chunksRef.current = [];
    if (toFlush.length > 0 && onChunkReady) {
      const mimeType = recorder?.mimeType ?? "audio/webm";
      const blob = new Blob(toFlush, { type: mimeType });
      if (blob.size > 0) onChunkReady(blob);
    }
  }, [onChunkReady]);

  const startRecording = useCallback(async () => {
    try {
      // ── [DISPLAY-MEDIA DISABLED — MIC ONLY TEST] ────────────────────────────
      // To re-enable: uncomment the getDisplayMedia block + AudioContext mixing below
      //
      // let sysStream: MediaStream | null = null;
      // try {
      //   console.log("[vela:recorder] requesting getDisplayMedia for system audio");
      //   sysStream = await navigator.mediaDevices.getDisplayMedia({
      //     video: { width: 1, height: 1 },
      //     audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      //   } as MediaStreamConstraints);
      //   sysStream.getVideoTracks().forEach((t) => { t.stop(); });
      //   const sysAudioTracks = sysStream.getAudioTracks();
      //   if (sysAudioTracks.length === 0) { sysStream = null; }
      //   else { console.log("[vela:recorder] system audio track:", sysAudioTracks[0].label); }
      // } catch (sysErr) {
      //   console.warn("[vela:recorder] getDisplayMedia skipped:", (sysErr as Error)?.message ?? sysErr);
      //   sysStream = null;
      // }
      // ── END DISPLAY-MEDIA BLOCK ─────────────────────────────────────────────

      // ── Step 1: getUserMedia for microphone ──
      console.log("[vela:recorder] requesting getUserMedia (mic-only mode)");
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log("[vela:recorder] mic track:", micStream.getAudioTracks()[0]?.label);

      // ── [DISPLAY-MEDIA DISABLED] AudioContext mixing skipped ─────────────────
      // const ctx  = new AudioContext();
      // const dest = ctx.createMediaStreamDestination();
      // ctx.createMediaStreamSource(micStream).connect(dest);
      // if (sysStream) { ctx.createMediaStreamSource(sysStream).connect(dest); }
      // audioContextRef.current = ctx;
      // sysStreamRef.current    = sysStream;
      // Record dest.stream instead of micStream when mixing is active
      // ── END AUDIOCTX BLOCK ──────────────────────────────────────────────────

      micStreamRef.current = micStream;

      // ── Step 2: record mic stream directly ──
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(micStream, { mimeType }); // micStream (not dest.stream)
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(5000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setSystemAudioActive(false); // always false while display-media is disabled

      console.log(
        "[vela:recorder] recording started — mimeType:", mimeType,
        "| systemAudio: false (display-media disabled)"
      );

      // Auto-flush every 10 minutes
      if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = setInterval(() => {
        const rec = mediaRecorderRef.current;
        if (rec && rec.state === "recording") {
          rec.requestData();
        }
        setTimeout(flushChunks, 300);
      }, CHUNK_INTERVAL_MS);

    } catch (err) {
      console.error("[vela:recorder] failed to start recording:", err);
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
        chunksRef.current    = [];
        mediaRecorderRef.current = null;

        micStreamRef.current?.getTracks().forEach((t) => t.stop());
        // sysStreamRef.current?.getTracks().forEach((t) => t.stop());   // [DISPLAY-MEDIA DISABLED]
        // audioContextRef.current?.close().catch(() => {});              // [DISPLAY-MEDIA DISABLED]
        micStreamRef.current    = null;
        // sysStreamRef.current    = null;                                // [DISPLAY-MEDIA DISABLED]
        // audioContextRef.current = null;                                // [DISPLAY-MEDIA DISABLED]

        setIsRecording(false);
        setSystemAudioActive(false);

        console.log("[vela:recorder] stopped — blob size:", blob.size, "bytes");
        resolve(blob.size > 0 ? blob : null);
      };

      recorder.stop();
    });
  }, []);

  return { startRecording, stopRecording, isRecording, systemAudioActive };
}
