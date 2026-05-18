// @refresh reset
import { useRef, useCallback, useState } from "react";

const CHUNK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface UseAudioRecorderOptions {
  onChunkReady?: (blob: Blob) => void;
}

export function useAudioRecorder({ onChunkReady }: UseAudioRecorderOptions = {}) {
  // All refs kept as real declarations regardless of mode — changing the count causes HMR hook-order crashes
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef  = useRef<AudioContext | null>(null);
  const micStreamRef     = useRef<MediaStream | null>(null);
  const sysStreamRef     = useRef<MediaStream | null>(null);

  const [isRecording,       setIsRecording]       = useState(false);
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

  // captureSystemAudio: true  → getDisplayMedia + AudioContext mix (client on browser speaker)
  // captureSystemAudio: false → mic only, no picker (client on phone / in-person / external app)
  const startRecording = useCallback(async (captureSystemAudio = false) => {
    try {
      let sysStream: MediaStream | null = null;

      if (captureSystemAudio) {
        try {
          console.log("[vela:recorder] requesting getDisplayMedia for system audio");
          sysStream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: 1, height: 1 },
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          } as MediaStreamConstraints);

          // Stop video tracks immediately — only audio needed
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
          // User cancelled picker or permission denied — fall back to mic only
          console.warn("[vela:recorder] getDisplayMedia skipped (cancelled or denied):", (sysErr as Error)?.message ?? sysErr);
          sysStream = null;
        }
      } else {
        console.log("[vela:recorder] skipping getDisplayMedia (client not on browser)");
      }

      // Microphone — always
      console.log("[vela:recorder] requesting getUserMedia (mic)");
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log("[vela:recorder] mic track:", micStream.getAudioTracks()[0]?.label);

      // Mix in AudioContext when system audio is available
      let recordStream: MediaStream;
      if (sysStream) {
        const ctx  = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(micStream).connect(dest);
        ctx.createMediaStreamSource(sysStream).connect(dest);
        audioContextRef.current = ctx;
        recordStream = dest.stream;
        console.log("[vela:recorder] mixing mic + system audio → MediaRecorder | sampleRate:", ctx.sampleRate);
      } else {
        audioContextRef.current = null;
        recordStream = micStream;
        console.log("[vela:recorder] mic-only → MediaRecorder");
      }

      micStreamRef.current = micStream;
      sysStreamRef.current = sysStream;

      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(recordStream, { mimeType });
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
        "| systemAudio:", !!sysStream
      );

      if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = setInterval(() => {
        const rec = mediaRecorderRef.current;
        if (rec && rec.state === "recording") rec.requestData();
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
