import { useRef, useCallback, useState } from "react";

const CHUNK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface UseAudioRecorderOptions {
  onChunkReady?: (blob: Blob) => void;
}

export function useAudioRecorder({ onChunkReady }: UseAudioRecorderOptions = {}) {
  const mediaRecorderRef   = useRef<MediaRecorder | null>(null);
  const chunksRef          = useRef<Blob[]>([]);
  const chunkIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef    = useRef<AudioContext | null>(null);
  const micStreamRef       = useRef<MediaStream | null>(null);
  const sysStreamRef       = useRef<MediaStream | null>(null);

  const [isRecording,      setIsRecording]      = useState(false);
  const [systemAudioActive, setSystemAudioActive] = useState(false);

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
      // ── Step 1: getDisplayMedia for system audio (OPTIONAL — silent fallback) ──
      let sysStream: MediaStream | null = null;
      try {
        console.log("[vela:recorder] requesting getDisplayMedia for system audio");
        sysStream = await navigator.mediaDevices.getDisplayMedia({
          // Minimal video required — Chrome ignores audio-only getDisplayMedia
          video: { width: 1, height: 1 },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        } as MediaStreamConstraints);

        // Stop video tracks immediately — only audio matters
        sysStream.getVideoTracks().forEach((t) => {
          t.stop();
          console.log("[vela:recorder] stopped unused video track");
        });

        const sysAudioTracks = sysStream.getAudioTracks();
        if (sysAudioTracks.length === 0) {
          // User shared screen but did NOT tick "Share audio"
          console.warn("[vela:recorder] getDisplayMedia: no audio tracks — user did not enable audio sharing");
          sysStream = null;
        } else {
          console.log("[vela:recorder] system audio track:", sysAudioTracks[0].label);
        }
      } catch (sysErr) {
        // User cancelled picker or permission denied — perfectly normal, continue mic-only
        console.warn("[vela:recorder] getDisplayMedia skipped (cancelled or denied):", (sysErr as Error)?.message ?? sysErr);
        sysStream = null;
      }

      // ── Step 2: getUserMedia for microphone ──
      console.log("[vela:recorder] requesting getUserMedia (mic)");
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log("[vela:recorder] mic track:", micStream.getAudioTracks()[0]?.label);

      // ── Step 3: mix both sources in AudioContext ──
      const ctx  = new AudioContext();
      const dest = ctx.createMediaStreamDestination();

      ctx.createMediaStreamSource(micStream).connect(dest);

      if (sysStream) {
        ctx.createMediaStreamSource(sysStream).connect(dest);
        console.log("[vela:recorder] mixing mic + system audio → MediaRecorder");
      } else {
        console.log("[vela:recorder] mic-only → MediaRecorder (no system audio)");
      }

      // Save for cleanup on stop
      audioContextRef.current = ctx;
      micStreamRef.current    = micStream;
      sysStreamRef.current    = sysStream;

      // ── Step 4: record the mixed destination stream ──
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(dest.stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(5000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setSystemAudioActive(!!sysStream);

      console.log(
        "[vela:recorder] recording started — mimeType:", mimeType,
        "| systemAudio:", !!sysStream,
        "| sampleRate:", ctx.sampleRate
      );

      // Auto-flush every 10 minutes
      if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = setInterval(() => {
        const rec = mediaRecorderRef.current;
        if (rec && rec.state === "recording") {
          rec.requestData(); // force latest audio into ondataavailable
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

        // Tear down all sources and context
        micStreamRef.current?.getTracks().forEach((t) => t.stop());
        sysStreamRef.current?.getTracks().forEach((t) => t.stop());
        audioContextRef.current?.close().catch(() => {});
        micStreamRef.current    = null;
        sysStreamRef.current    = null;
        audioContextRef.current = null;

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
