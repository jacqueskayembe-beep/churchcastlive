// Browser-only live audio clients for the ChurchCast realtime server.
// Only call these from event handlers / effects (never during SSR render).

export function realtimeServerUrl(): string {
  const env = (import.meta.env.VITE_REALTIME_SERVER_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return "ws://localhost:8787";
  return "";
}

const httpBase = (ws: string) => ws.replace(/^ws/, "http");

export interface ListenerStats {
  state: "idle" | "connecting" | "live" | "reconnecting" | "ended" | "unavailable";
  bufferedMs: number;
  underruns: number;
  droppedMs: number;
  lostFrames: number;
  networkMs: number | null;
}

/** Subscribes to one language channel and plays it continuously. */
export class LiveListener {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private ws: WebSocket | null = null;
  private stopped = false;
  private retry = 0;
  private expectedSeq: number | null = null;
  stats: ListenerStats = { state: "idle", bufferedMs: 0, underruns: 0, droppedMs: 0, lostFrames: 0, networkMs: null };

  constructor(
    private opts: {
      sessionId: string;
      lang: string;
      onStats?: (s: ListenerStats) => void;
      onCaptionDelta?: (d: string) => void;
    },
  ) {}

  /** Must be called from a user gesture (autoplay policy). */
  async start() {
    const base = realtimeServerUrl();
    if (!base) { this.update({ state: "unavailable" }); return; }
    this.stopped = false;
    this.ctx = new AudioContext({ sampleRate: 24000, latencyHint: "interactive" });
    await this.ctx.audioWorklet.addModule(`${httpBase(base)}/player-worklet.js`);
    this.node = new AudioWorkletNode(this.ctx, "player-processor", { outputChannelCount: [1] });
    this.gain = this.ctx.createGain();
    this.node.connect(this.gain).connect(this.ctx.destination);
    this.node.port.onmessage = (e) => this.update(e.data);
    await this.ctx.resume();
    this.connect(base);
  }

  setMuted(m: boolean) { if (this.gain) this.gain.gain.value = m ? 0 : 1; }

  private connect(base: string) {
    if (this.stopped) return;
    this.update({ state: this.retry ? "reconnecting" : "connecting" });
    const ws = new WebSocket(`${base}/listen?session=${encodeURIComponent(this.opts.sessionId)}&lang=${encodeURIComponent(this.opts.lang)}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.expectedSeq = null; this.node?.port.postMessage("reset"); this.update({ state: "live" }); };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        const msg = JSON.parse(e.data);
        if (msg.type === "caption_delta") this.opts.onCaptionDelta?.(msg.delta);
        if (msg.type === "ended") this.update({ state: "ended" });
        return;
      }
      const view = new DataView(e.data as ArrayBuffer);
      const seq = view.getUint32(0, true);
      const sentAt = view.getFloat64(4, true);
      if (this.expectedSeq !== null && seq > this.expectedSeq) this.stats.lostFrames += seq - this.expectedSeq;
      this.expectedSeq = seq + 1;
      this.stats.networkMs = Math.max(0, Date.now() - sentAt);
      const pcm = (e.data as ArrayBuffer).slice(12);
      this.node?.port.postMessage(pcm, [pcm]);
    };
    ws.onclose = (ev) => {
      if (this.stopped) return;
      if (ev.code === 4004) { this.update({ state: "unavailable" }); return; }
      const delay = Math.min(10000, 500 * 2 ** this.retry++);
      this.update({ state: "reconnecting" });
      setTimeout(() => this.connect(base), delay);
    };
  }

  private update(p: Partial<ListenerStats>) {
    this.stats = { ...this.stats, ...p };
    this.opts.onStats?.(this.stats);
  }

  stop() {
    this.stopped = true;
    try { this.ws?.close(); } catch { /* noop */ }
    try { this.ctx?.close(); } catch { /* noop */ }
    this.update({ state: "idle" });
  }
}

export type BroadcasterEvent =
  | { type: "ready"; langs: string[] }
  | { type: "status"; lang: string; status: string }
  | { type: "latency"; lang: string; ms: number }
  | { type: "listeners"; lang: string; count: number }
  | { type: "source_delta"; delta: string }
  | { type: "caption_delta"; lang: string; delta: string }
  | { type: "error"; message: string }
  | { type: "closed" };

/** Streams mic / system input as 24 kHz PCM16 to the realtime server. */
export class LiveBroadcaster {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private ws: WebSocket | null = null;
  private stopped = false;
  level = 0;

  constructor(private opts: { sessionId: string; token: string; deviceId?: string; onEvent: (e: BroadcasterEvent) => void }) {}

  async start() {
    const base = realtimeServerUrl();
    if (!base) throw new Error("The live audio server isn't configured yet.");
    this.stopped = false;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.opts.deviceId ? { exact: this.opts.deviceId } : undefined,
        echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1,
      },
    });
    this.ctx = new AudioContext({ sampleRate: 24000 });
    await this.ctx.audioWorklet.addModule(`${httpBase(base)}/capture-worklet.js`);
    const src = this.ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.ctx, "capture-processor");
    src.connect(node);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${base}/broadcast?session=${encodeURIComponent(this.opts.sessionId)}&token=${encodeURIComponent(this.opts.token)}`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as BroadcasterEvent;
        if (msg.type === "ready") resolve();
        if (msg.type === "error") reject(new Error(msg.message));
        this.opts.onEvent(msg);
      };
      ws.onerror = () => reject(new Error("Could not reach the live audio server."));
      ws.onclose = () => { if (!this.stopped) this.opts.onEvent({ type: "closed" }); };
    });
    node.port.onmessage = (e) => {
      const buf = e.data as ArrayBuffer;
      const v = new Int16Array(buf);
      let peak = 0; for (let i = 0; i < v.length; i += 8) peak = Math.max(peak, Math.abs(v[i]));
      this.level = peak / 32768;
      // Bounded upload: if the network stalls, drop mic frames rather than queue.
      if (this.ws?.readyState === 1 && this.ws.bufferedAmount < 96_000) this.ws.send(buf);
    };
  }

  stop() {
    this.stopped = true;
    try { this.ws?.close(); } catch { /* noop */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    try { this.ctx?.close(); } catch { /* noop */ }
  }
}
