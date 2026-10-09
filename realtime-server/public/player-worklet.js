// Listener playback: continuous jitter-buffered PCM16 player.
// - bounded ring buffer (MAX_MS); oldest audio dropped when exceeded so a
//   backgrounded/slow device catches up instead of drifting further behind
// - waits for START_MS of audio before (re)starting playback after underrun
// - outputs silence (never glitches) when the buffer is empty
const SR = 24000;
const START_MS = 200;
const MAX_MS = 8000;      // voice-changed phrases can arrive in bursts
const TARGET_MS = 1500;   // trim back to this when MAX is exceeded

class PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = Math.ceil((SR * MAX_MS) / 1000) * 2;
    this.buf = new Float32Array(this.cap);
    this.r = 0; this.w = 0; this.size = 0;
    this.playing = false;
    this.underruns = 0; this.dropped = 0;
    this.lastReport = 0;
    this.port.onmessage = (e) => {
      if (e.data === "reset") { this.r = this.w = this.size = 0; this.playing = false; return; }
      this.push(new Int16Array(e.data));
    };
  }
  push(pcm) {
    const max = (SR * MAX_MS) / 1000;
    for (let i = 0; i < pcm.length; i++) {
      this.buf[this.w] = pcm[i] / 0x8000;
      this.w = (this.w + 1) % this.cap;
      this.size++;
    }
    if (this.size > max) {
      const drop = this.size - (SR * TARGET_MS) / 1000;
      this.r = (this.r + drop) % this.cap; this.size -= drop; this.dropped += drop;
    }
  }
  process(_in, outputs) {
    const out = outputs[0][0];
    if (!this.playing && this.size >= (SR * START_MS) / 1000) this.playing = true;
    for (let i = 0; i < out.length; i++) {
      if (this.playing && this.size > 0) {
        out[i] = this.buf[this.r]; this.r = (this.r + 1) % this.cap; this.size--;
      } else {
        out[i] = 0;
        if (this.playing) { this.playing = false; this.underruns++; }
      }
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    if (currentTime - this.lastReport > 0.5) {
      this.lastReport = currentTime;
      this.port.postMessage({ bufferedMs: (this.size / SR) * 1000, underruns: this.underruns, droppedMs: (this.dropped / SR) * 1000, playing: this.playing });
    }
    return true;
  }
}
registerProcessor("player-processor", PlayerProcessor);
