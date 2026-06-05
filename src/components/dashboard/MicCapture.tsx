import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { processAudioChunk } from "@/lib/pipeline.functions";

interface ChunkStatus {
  id: string;
  state: "uploading" | "done" | "error";
  durationMs: number;
  recordedAt: number;
  error?: string;
  text?: string;
}

interface Props {
  sessionId: string;
  deviceId?: string;
}

// Silence detection thresholds
const SILENCE_RMS = 0.012;
const SILENCE_MS = 700;
const MIN_CHUNK_MS = 1200;
const MAX_CHUNK_MS = 8000;
const TIMESLICE_MS = 250;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const result = r.result as string;
      // strip "data:...;base64,"
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function MicCapture({ sessionId, deviceId }: Props) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [statuses, setStatuses] = useState<ChunkStatus[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkStartRef = useRef<number>(0);
  const lastVoiceRef = useRef<number>(0);
  const hasVoiceRef = useRef<boolean>(false);
  const cycleResolverRef = useRef<(() => void) | null>(null);

  const teardown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { recorderRef.current?.state !== "inactive" && recorderRef.current?.stop(); } catch { /* noop */ }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => () => { teardown(); }, [teardown]);

  const uploadChunk = useCallback(async (blob: Blob, durationMs: number) => {
    const id = crypto.randomUUID();
    setStatuses((p) => [...p, { id, state: "uploading" as const, durationMs, recordedAt: Date.now() }].slice(-12));
    try {
      const base64 = await blobToBase64(blob);
      const result = await processAudioChunk({
        data: { sessionId, audioBase64: base64, mimeType: blob.type || "audio/webm" },
      });
      if (!result.ok) {
        setStatuses((p) => p.map((s) => s.id === id ? { ...s, state: "error", error: result.error } : s));
        toast.error(result.error);
      } else {
        setStatuses((p) => p.map((s) => s.id === id ? { ...s, state: "done", text: result.sourceText } : s));
      }
    } catch (e) {
      const msg = (e as Error).message;
      setStatuses((p) => p.map((s) => s.id === id ? { ...s, state: "error", error: msg } : s));
      toast.error("Failed to process audio chunk.");
    }
  }, [sessionId]);

  const finalizeCurrent = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    return new Promise<void>((resolve) => {
      cycleResolverRef.current = resolve;
      try { rec.stop(); } catch { resolve(); }
    });
  }, []);

  const startRecorderCycle = useCallback((stream: MediaStream) => {
    const mime =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
      MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" :
      MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    chunkStartRef.current = performance.now();
    hasVoiceRef.current = false;

    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blobs = chunksRef.current;
      chunksRef.current = [];
      const durationMs = Math.round(performance.now() - chunkStartRef.current);
      const resolver = cycleResolverRef.current;
      cycleResolverRef.current = null;

      if (hasVoiceRef.current && durationMs >= MIN_CHUNK_MS && blobs.length > 0) {
        const blob = new Blob(blobs, { type: rec.mimeType || "audio/webm" });
        uploadChunk(blob, durationMs);
      }
      resolver?.();
    };

    rec.start(TIMESLICE_MS);
    recorderRef.current = rec;
  }, [uploadChunk]);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId
          ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyserRef.current = analyser;

      setRecording(true);
      startRecorderCycle(stream);

      const buf = new Float32Array(analyser.fftSize);
      lastVoiceRef.current = performance.now();

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 8));

        const now = performance.now();
        const elapsed = now - chunkStartRef.current;

        if (rms > SILENCE_RMS) {
          lastVoiceRef.current = now;
          hasVoiceRef.current = true;
        }

        const silenceGap = now - lastVoiceRef.current;
        const shouldFinalize =
          (hasVoiceRef.current && silenceGap > SILENCE_MS && elapsed > MIN_CHUNK_MS) ||
          elapsed > MAX_CHUNK_MS;

        if (shouldFinalize && recorderRef.current?.state === "recording") {
          const s = streamRef.current;
          if (s) {
            (async () => {
              await finalizeCurrent();
              if (streamRef.current) startRecorderCycle(streamRef.current);
              lastVoiceRef.current = performance.now();
            })();
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.error(err);
      toast.error("Microphone access denied or unavailable.");
      teardown();
      setRecording(false);
    }
  }, [deviceId, startRecorderCycle, finalizeCurrent, teardown]);

  const stop = useCallback(async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    await finalizeCurrent();
    teardown();
    setRecording(false);
  }, [finalizeCurrent, teardown]);

  return (
    <div className="surface-elevated border border-border rounded-2xl p-6 space-y-5">
      <div className="flex items-center gap-5">
        <button
          onClick={recording ? stop : start}
          className={`size-20 rounded-full grid place-items-center transition shadow-glow ${
            recording
              ? "bg-rose-glow text-white animate-pulse-dot"
              : "bg-amber-gradient text-primary-foreground hover:opacity-90"
          }`}
          aria-label={recording ? "Stop broadcasting" : "Start broadcasting"}
        >
          {recording ? <MicOff className="size-8" /> : <Mic className="size-8" />}
        </button>
        <div className="flex-1">
          <p className="font-display text-2xl">
            {recording ? "Broadcasting…" : "Tap to start broadcasting"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Speech is transcribed, translated, and spoken aloud automatically for every listener.
          </p>
          {/* Level meter */}
          <div className="flex items-center gap-1.5 h-6 mt-3" aria-hidden>
            {Array.from({ length: 20 }).map((_, i) => {
              const active = level * 20 > i;
              return (
                <span
                  key={i}
                  className={`w-1 rounded-full transition-all ${active ? "bg-primary" : "bg-border"}`}
                  style={{ height: `${6 + i * 0.8}px`, opacity: active ? 1 : 0.4 }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {statuses.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Recent chunks
          </h3>
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {statuses.slice().reverse().map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 bg-background/40 border border-border rounded-lg px-3 py-2 text-sm animate-fade-up"
              >
                <span className="shrink-0">
                  {s.state === "uploading" && <Loader2 className="size-4 animate-spin text-primary" />}
                  {s.state === "done" && <CheckCircle2 className="size-4 text-emerald-400" />}
                  {s.state === "error" && <AlertCircle className="size-4 text-destructive" />}
                </span>
                <span className="flex-1 min-w-0 truncate text-muted-foreground">
                  {s.state === "done" ? (s.text || "(no speech detected)") :
                   s.state === "error" ? s.error :
                   "Transcribing & translating…"}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {(s.durationMs / 1000).toFixed(1)}s
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
