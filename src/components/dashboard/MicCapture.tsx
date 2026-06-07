import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import { getScribeToken, translateCommitted } from "@/lib/realtime-pipeline.functions";

interface Props {
  sessionId: string;
  deviceId?: string;
}

export function MicCapture({ sessionId, deviceId }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [partial, setPartial] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const inFlightRef = useRef(0);

  const handleCommitted = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setRecent((p) => [...p, clean].slice(-6));
      inFlightRef.current += 1;
      try {
        const res = await translateCommitted({ data: { sessionId, text: clean } });
        if (!res.ok) toast.error(res.error);
      } catch (e) {
        toast.error((e as Error).message || "Translate failed");
      } finally {
        inFlightRef.current -= 1;
      }
    },
    [sessionId],
  );

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    onPartialTranscript: (d: { text: string }) => setPartial(d.text || ""),
    onCommittedTranscript: (d: { text: string }) => {
      setPartial("");
      handleCommitted(d.text);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Streaming error"),
    onAuthError: (data) => toast.error(data.error),
    onInputError: (data) => toast.error(data.error),
    onTranscriberError: (data) => toast.error(data.error),
  });
  const scribeRef = useRef(scribe);

  useEffect(() => {
    scribeRef.current = scribe;
  }, [scribe]);

  const start = useCallback(async () => {
    setConnecting(true);
    try {
      const tok = await getScribeToken({ data: undefined });
      if (!tok.ok) throw new Error(tok.error);
      await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId } : true,
      }).then((stream) => stream.getTracks().forEach((track) => track.stop()));
      await scribe.connect({
        token: tok.token,
        microphone: { deviceId, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      toast.error((e as Error).message || "Could not start streaming");
    } finally {
      setConnecting(false);
    }
  }, [deviceId, scribe]);

  const stop = useCallback(() => {
    try { scribe.disconnect(); } catch { /* noop */ }
  }, [scribe]);

  useEffect(() => () => { try { scribeRef.current.disconnect(); } catch { /* noop */ } }, []);

  const recording = scribe.isConnected;
  const busy = connecting || scribe.status === "connecting";

  return (
    <div className="surface-elevated border border-border rounded-2xl p-6 space-y-5">
      <div className="flex items-center gap-5">
        <button
          onClick={recording ? stop : start}
          disabled={busy}
          className={`size-20 rounded-full grid place-items-center transition shadow-glow ${
            recording
              ? "bg-rose-glow text-white animate-pulse-dot"
              : "bg-amber-gradient text-primary-foreground hover:opacity-90"
          } disabled:opacity-60`}
          aria-label={recording ? "Stop broadcasting" : "Start broadcasting"}
        >
          {connecting ? <Loader2 className="size-8 animate-spin" /> :
           recording ? <MicOff className="size-8" /> : <Mic className="size-8" />}
        </button>
        <div className="flex-1">
          <p className="font-display text-2xl">
            {recording ? "Streaming live…" : busy ? "Connecting…" : "Tap to start broadcasting"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time streaming transcription. Each phrase is translated and spoken aloud the moment you pause.
          </p>
          {scribe.error && <p className="text-xs text-destructive mt-2">{scribe.error}</p>}
        </div>
      </div>

      {(partial || recent.length > 0) && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Live capture
          </h3>
          <div className="bg-background/40 border border-border rounded-lg p-3 text-sm space-y-1 max-h-44 overflow-y-auto">
            {recent.map((t, i) => (
              <p key={i} className="text-foreground/80 animate-fade-up">{t}</p>
            ))}
            {partial && (
              <p className="text-muted-foreground italic">{partial}…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
