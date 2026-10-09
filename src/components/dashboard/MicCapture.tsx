import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { LiveBroadcaster, type BroadcasterEvent } from "@/lib/live-audio";
import { getLanguage } from "@/lib/languages";

interface Props {
  sessionId: string;
  deviceId?: string;
}

export function MicCapture({ sessionId, deviceId }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [latency, setLatency] = useState<Record<string, number>>({});
  const [level, setLevel] = useState(0);
  const bRef = useRef<LiveBroadcaster | null>(null);

  const onEvent = useCallback((e: BroadcasterEvent) => {
    if (e.type === "source_delta") setSource((s) => (s + e.delta).slice(-600));
    if (e.type === "status") setStatuses((p) => ({ ...p, [e.lang]: e.status }));
    if (e.type === "latency") setLatency((p) => ({ ...p, [e.lang]: e.ms }));
    if (e.type === "error") { setStreamError(e.message); toast.error(e.message); }
    if (e.type === "closed") {
      setRecording(false);
      setStreamError("Connection to the live audio server was lost. Tap to reconnect.");
      bRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (bRef.current) return;
    setConnecting(true);
    setStreamError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const b = new LiveBroadcaster({ sessionId, token, deviceId, onEvent });
      bRef.current = b;
      await b.start();
      setRecording(true);
    } catch (e) {
      bRef.current?.stop();
      bRef.current = null;
      const msg = (e as Error).message || "Could not start broadcasting";
      setStreamError(msg);
      toast.error(msg);
    } finally {
      setConnecting(false);
    }
  }, [sessionId, deviceId, onEvent]);

  const stop = useCallback(() => {
    bRef.current?.stop();
    bRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setLevel(bRef.current?.level ?? 0), 150);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => () => bRef.current?.stop(), []);

  return (
    <div className="surface-elevated border border-border rounded-2xl p-6 space-y-5">
      <div className="flex items-center gap-5">
        <button
          onClick={recording ? stop : start}
          disabled={connecting}
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
            {recording ? "Streaming live…" : connecting ? "Connecting…" : "Tap to start broadcasting"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Continuous live interpretation in the pastor's voice — no waiting for pauses.
          </p>
          {recording && (
            <div className="mt-2 h-1.5 w-48 rounded-full bg-secondary overflow-hidden" aria-label="Input level">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, level * 140)}%` }} />
            </div>
          )}
          {streamError && <p className="text-xs text-destructive mt-2">{streamError}</p>}
        </div>
      </div>

      {recording && Object.keys(statuses).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(statuses).map(([lang, s]) => (
            <span key={lang} className="text-xs px-2.5 py-1 rounded-full border border-border bg-background/40">
              {getLanguage(lang).flag} {s}
              {latency[lang] != null && ` · ${(latency[lang] / 1000).toFixed(1)}s`}
            </span>
          ))}
        </div>
      )}

      {source && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Live capture</h3>
          <div className="bg-background/40 border border-border rounded-lg p-3 text-sm max-h-44 overflow-y-auto">
            <p className="text-foreground/80">{source}</p>
          </div>
        </div>
      )}
    </div>
  );
}
