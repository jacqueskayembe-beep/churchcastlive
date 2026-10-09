// Audio distribution layer. The pipeline only talks to this interface:
//   publishAudio(sessionId, lang, pcm16Buffer)  -> fan out to listeners
//   publishEvent(sessionId, lang, obj)          -> JSON captions / status
//   listenerCount(sessionId, lang)
// Swap this module for a LiveKit/WebRTC implementation later without touching
// the translation pipeline.

const FRAME_HEADER_BYTES = 12; // u32 seq + f64 server send time (ms)
const MAX_BUFFERED_BYTES = 192 * 1024; // ~4s of 24kHz PCM16 per listener

export class WebSocketDistribution {
  constructor({ log }) {
    this.log = log;
    /** @type {Map<string, {seq:number, listeners:Set<any>}>} */
    this.channels = new Map();
    this.onCountChange = () => {};
  }

  key(sessionId, lang) { return `${sessionId}/${lang}`; }

  channel(sessionId, lang) {
    const k = this.key(sessionId, lang);
    let ch = this.channels.get(k);
    if (!ch) { ch = { seq: 0, listeners: new Set() }; this.channels.set(k, ch); }
    return ch;
  }

  addListener(sessionId, lang, ws) {
    const ch = this.channel(sessionId, lang);
    ws._stats = { dropped: 0, sent: 0 };
    ch.listeners.add(ws);
    ws.send(JSON.stringify({ type: "hello", seq: ch.seq, sampleRate: 24000 }));
    this.onCountChange(sessionId, lang, ch.listeners.size);
    ws.on("close", () => {
      ch.listeners.delete(ws);
      this.onCountChange(sessionId, lang, ch.listeners.size);
    });
  }

  listenerCount(sessionId, lang) {
    return this.channels.get(this.key(sessionId, lang))?.listeners.size ?? 0;
  }

  publishAudio(sessionId, lang, pcm) {
    const ch = this.channel(sessionId, lang);
    const seq = ch.seq++;
    const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + pcm.length);
    frame.writeUInt32LE(seq >>> 0, 0);
    frame.writeDoubleLE(Date.now(), 4);
    pcm.copy(frame, FRAME_HEADER_BYTES);
    for (const ws of ch.listeners) {
      if (ws.readyState !== 1) continue;
      // Per-listener backpressure: a slow device drops its own frames,
      // it never delays the shared channel or other listeners.
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) { ws._stats.dropped++; continue; }
      ws.send(frame, { binary: true });
      ws._stats.sent++;
    }
  }

  publishEvent(sessionId, lang, obj) {
    const ch = this.channels.get(this.key(sessionId, lang));
    if (!ch) return;
    const msg = JSON.stringify(obj);
    for (const ws of ch.listeners) {
      if (ws.readyState === 1 && ws.bufferedAmount < MAX_BUFFERED_BYTES) ws.send(msg);
    }
  }

  closeSession(sessionId) {
    for (const [k, ch] of this.channels) {
      if (!k.startsWith(`${sessionId}/`)) continue;
      for (const ws of ch.listeners) ws.send(JSON.stringify({ type: "ended" }));
    }
  }
}
