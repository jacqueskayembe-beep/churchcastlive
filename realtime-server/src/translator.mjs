import WebSocket from "ws";

// One persistent gpt-realtime-translate session per target language.
// Emits: onAudio(Buffer pcm16 24k), onOutputText(delta), onInputText(delta), onStatus(str)
export class TranslationSession {
  constructor({ apiKey, lang, safetyId, log, onAudio, onOutputText, onInputText, onStatus }) {
    Object.assign(this, { apiKey, lang, safetyId, log, onAudio, onOutputText, onInputText, onStatus });
    this.ws = null;
    this.closed = false;
    this.ready = false;
    this.pending = []; // bounded pre-connect audio queue
    this.retries = 0;
    this.connect();
  }

  connect() {
    if (this.closed) return;
    this.onStatus?.("connecting");
    const ws = new WebSocket("wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate", {
      headers: { Authorization: `Bearer ${this.apiKey}`, "OpenAI-Safety-Identifier": this.safetyId },
    });
    this.ws = ws;
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "session.update", session: { audio: { output: { language: this.lang } } } }));
    });
    ws.on("message", (raw) => {
      let ev;
      try { ev = JSON.parse(raw.toString()); } catch { return; }
      switch (ev.type) {
        case "session.created":
        case "session.updated":
          if (!this.ready) {
            this.ready = true; this.retries = 0; this.onStatus?.("live");
            for (const b64 of this.pending.splice(0)) this.sendAudio(b64);
          }
          break;
        case "session.output_audio.delta":
          this.onAudio(Buffer.from(ev.delta, "base64"));
          break;
        case "session.output_transcript.delta":
          this.onOutputText?.(ev.delta);
          break;
        case "session.input_transcript.delta":
          this.onInputText?.(ev.delta);
          break;
        case "error":
          this.log(`[translate ${this.lang}] error`, JSON.stringify(ev.error ?? ev).slice(0, 300));
          this.onStatus?.(`error: ${ev.error?.message ?? "unknown"}`);
          break;
        case "session.closed":
          ws.close();
          break;
      }
    });
    ws.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => this.log(`[translate ${this.lang}] HTTP ${res.statusCode}`, body.slice(0, 300)));
    });
    ws.on("error", (e) => this.log(`[translate ${this.lang}] socket error`, e.message));
    ws.on("close", () => {
      this.ready = false;
      if (this.closed) return;
      // Bounded reconnect with backoff.
      if (this.retries >= 6) { this.onStatus?.("failed"); return; }
      const delay = Math.min(8000, 500 * 2 ** this.retries++);
      this.onStatus?.("reconnecting");
      setTimeout(() => this.connect(), delay);
    });
  }

  sendAudio(b64) {
    if (!this.ready || this.ws?.readyState !== 1) {
      this.pending.push(b64);
      if (this.pending.length > 100) this.pending.shift(); // ~2s cap
      return;
    }
    this.ws.send(JSON.stringify({ type: "session.input_audio_buffer.append", audio: b64 }));
  }

  close() {
    this.closed = true;
    try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: "session.close" })); } catch {}
    setTimeout(() => { try { this.ws?.close(); } catch {} }, 3000);
  }
}
