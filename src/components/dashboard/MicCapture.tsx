import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CommitStrategy, RealtimeEvents, Scribe, type RealtimeConnection } from "@elevenlabs/client";
import { getScribeToken, translateCommitted } from "@/lib/realtime-pipeline.functions";

interface Props {
  sessionId: string;
  deviceId?: string;
}

export function MicCapture({ sessionId, deviceId }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const inFlightRef = useRef(0);
  const connectionRef = useRef<RealtimeConnection | null>(null);

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

  const start = useCallback(async () => {
    if (connectionRef.current) return;
    setConnecting(true);
    setStreamError(null);
    try {
      const tok = await getScribeToken({ data: undefined });
      if (!tok.ok) throw new Error(tok.error);
      const connection = Scribe.connect({
        token: tok.token,
        modelId: "scribe_v2_realtime",
        commitStrategy: CommitStrategy.VAD,
        microphone: { deviceId, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      connectionRef.current = connection;
      connection.on(RealtimeEvents.OPEN, () => { setConnecting(false); setRecording(true); });
      connection.on(RealtimeEvents.SESSION_STARTED, () => setRecording(true));
      connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => setPartial(data.text || ""));
      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
        setPartial("");
        handleCommitted(data.text || "");
      });
      connection.on(RealtimeEvents.ERROR, (error) => {
        const message = error instanceof Error ? error.message : "error" in error ? error.error : "Streaming error";
        setStreamError(message);
        toast.error(message);
      });
      connection.on(RealtimeEvents.CLOSE, () => {
        connectionRef.current = null;
        setConnecting(false);
        setRecording(false);
      });
    } catch (e) {
      connectionRef.current = null;
      setRecording(false);
      setStreamError((e as Error).message || "Could not start streaming");
      toast.error((e as Error).message || "Could not start streaming");
      setConnecting(false);
    }
  }, [deviceId, handleCommitted]);

  const stop = useCallback(() => {
    try { connectionRef.current?.close(); } catch { /* noop */ }
    connectionRef.current = null;
    setConnecting(false);
    setRecording(false);
  }, []);

  useEffect(() => () => { try { connectionRef.current?.close(); } catch { /* noop */ } }, []);

  const busy = connecting;

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
          {streamError && <p className="text-xs text-destructive mt-2">{streamError}</p>}
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
