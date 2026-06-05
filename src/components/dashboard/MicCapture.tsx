import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Trash2, AudioLines } from "lucide-react";
import { toast } from "sonner";

interface QueuedChunk {
  id: string;
  blob: Blob;
  durationMs: number;
  recordedAt: number;
  url: string;
}

interface Props {
  /** Device id from SessionSetup (optional) */
  deviceId?: string;
  /** Called when a chunk is finalized — wire this up to STT later. */
  onChunk?: (chunk: QueuedChunk) => void;
}

// Silence detection thresholds
const SILENCE_RMS = 0.012;          // anything below this counts as silence
const SILENCE_MS = 700;             // silence duration that ends a sentence
const MIN_CHUNK_MS = 1200;          // ignore micro-bursts
const MAX_CHUNK_MS = 8000;          // hard cap so latency stays < 10s
const TIMESLICE_MS = 250;           // MediaRecorder slice cadence

export function MicCapture({ deviceId, onChunk }: Props) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [queue, setQueue] = useState<QueuedChunk[]>([]);

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

  useEffect(() => () => { teardown(); queue.forEach((c) => URL.revokeObjectURL(c.url)); }, [teardown]); // eslint-disable-line react-hooks/exhaustive-deps

  const finalizeCurrent = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    // stop() flushes a final dataavailable — wait for it via the cycleResolver
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
        const chunk: QueuedChunk = {
          id: crypto.randomUUID(),
          blob,
          durationMs,
          recordedAt: Date.now(),
          url: URL.createObjectURL(blob),
        };
        setQueue((q) => [...q, chunk]);
        onChunk?.(chunk);
      }
      resolver?.();
    };

    rec.start(TIMESLICE_MS);
    recorderRef.current = rec;
  }, [onChunk]);

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

  const removeChunk = (id: string) => {
    setQueue((q) => {
      const target = q.find((c) => c.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return q.filter((c) => c.id !== id);
    });
  };

  const clearAll = () => {
    queue.forEach((c) => URL.revokeObjectURL(c.url));
    setQueue([]);
  };

  return (
    <div className="surface-elevated border border-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={recording ? stop : start}
            className={`size-12 rounded-full grid place-items-center transition shadow-card ${
              recording
                ? "bg-rose-glow text-white animate-pulse-dot"
                : "bg-primary text-primary-foreground hover:opacity-90"
            }`}
            aria-label={recording ? "Stop recording" : "Start recording"}
          >
            {recording ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
          <div>
            <p className="text-sm font-medium">
              {recording ? "Listening…" : "Microphone idle"}
            </p>
            <p className="text-xs text-muted-foreground">
              Chunks auto-finalize on a {SILENCE_MS}ms pause (max {MAX_CHUNK_MS / 1000}s).
            </p>
          </div>
        </div>

        {/* Level meter */}
        <div className="flex items-center gap-1.5 h-8" aria-hidden>
          {Array.from({ length: 12 }).map((_, i) => {
            const active = level * 12 > i;
            return (
              <span
                key={i}
                className={`w-1 rounded-full transition-all ${active ? "bg-primary" : "bg-border"}`}
                style={{ height: `${8 + i * 1.6}px`, opacity: active ? 1 : 0.5 }}
              />
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <AudioLines className="size-3.5" /> Local chunk queue ({queue.length})
          </h3>
          {queue.length > 0 && (
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground transition"
            >
              Clear all
            </button>
          )}
        </div>
        {queue.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No chunks yet. Recordings will queue here until speech-to-text is wired up.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {queue.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center gap-3 bg-background/40 border border-border rounded-lg px-3 py-2 animate-fade-up"
              >
                <span className="text-xs font-mono text-muted-foreground w-8">#{i + 1}</span>
                <audio src={c.url} controls className="h-8 flex-1 min-w-0" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {(c.durationMs / 1000).toFixed(1)}s
                </span>
                <button
                  onClick={() => removeChunk(c.id)}
                  className="text-muted-foreground hover:text-destructive transition"
                  aria-label="Remove chunk"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
