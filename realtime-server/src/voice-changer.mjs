// Speech-aware segmenter + ElevenLabs Voice Changer (speech-to-speech).
// Translated 24 kHz PCM16 is cut at natural pauses into short phrases, converted
// to the pastor's cloned voice, and emitted in order. If conversion fails or is
// too slow, the original translated audio is emitted instead, so listeners never
// hear silence because of the voice layer.

const SR = 24000;
const SILENCE_RMS = 350;
const MIN_SEG_MS = 1200;
const MAX_SEG_MS = 5000;
const PAUSE_MS = 250;
const CONVERT_TIMEOUT_MS = 6000;

function rms(buf) {
  let s = 0; const n = buf.length >> 1;
  for (let i = 0; i < n; i++) { const v = buf.readInt16LE(i * 2); s += v * v; }
  return Math.sqrt(s / Math.max(1, n));
}

// 24k -> 16k linear resample (ElevenLabs pcm_s16le_16 input is lowest latency)
function to16k(pcm24) {
  const n = pcm24.length >> 1; const out = Math.floor(n * 2 / 3);
  const o = Buffer.alloc(out * 2);
  for (let i = 0; i < out; i++) {
    const p = i * 1.5; const a = Math.floor(p); const f = p - a;
    const s0 = pcm24.readInt16LE(Math.min(a, n - 1) * 2);
    const s1 = pcm24.readInt16LE(Math.min(a + 1, n - 1) * 2);
    o.writeInt16LE(Math.round(s0 + (s1 - s0) * f), i * 2);
  }
  return o;
}

export class VoiceChangerStage {
  constructor({ apiKey, voiceId, enabled, log, emit }) {
    Object.assign(this, { apiKey, voiceId, enabled, log, emit });
    this.chunks = []; this.bytes = 0; this.silentMs = 0;
    this.chain = Promise.resolve(); // preserves phrase order
    this.failures = 0;
  }

  push(pcm) {
    if (!this.enabled || this.failures >= 5) { this.emit(pcm); return; }
    this.chunks.push(pcm); this.bytes += pcm.length;
    const ms = (pcm.length / 2 / SR) * 1000;
    this.silentMs = rms(pcm) < SILENCE_RMS ? this.silentMs + ms : 0;
    const segMs = (this.bytes / 2 / SR) * 1000;
    if ((segMs >= MIN_SEG_MS && this.silentMs >= PAUSE_MS) || segMs >= MAX_SEG_MS) this.flush();
  }

  flush() {
    if (!this.bytes) return;
    const seg = Buffer.concat(this.chunks); this.chunks = []; this.bytes = 0; this.silentMs = 0;
    const job = this.convert(seg);
    this.chain = this.chain.then(() => job).then((out) => this.emit(out)).catch(() => this.emit(seg));
  }

  async convert(seg) {
    if (rms(seg) < SILENCE_RMS) return seg; // pure silence: no need to convert
    const t0 = Date.now();
    const form = new FormData();
    form.append("audio", new Blob([to16k(seg)]), "seg.pcm");
    form.append("model_id", "eleven_multilingual_sts_v2");
    form.append("file_format", "pcm_s16le_16");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONVERT_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/speech-to-speech/${this.voiceId}/stream?output_format=pcm_24000`,
        { method: "POST", headers: { "xi-api-key": this.apiKey }, body: form, signal: ctrl.signal },
      );
      if (!res.ok) {
        this.failures++;
        this.log("[voice] HTTP", res.status, (await res.text()).slice(0, 200));
        return seg;
      }
      const out = Buffer.from(await res.arrayBuffer());
      this.failures = 0;
      this.log(`[voice] converted ${(seg.length / 48000).toFixed(1)}s in ${Date.now() - t0}ms`);
      return out.length ? out : seg;
    } catch (e) {
      this.failures++;
      this.log("[voice] failed", e.message);
      return seg;
    } finally { clearTimeout(timer); }
  }
}
