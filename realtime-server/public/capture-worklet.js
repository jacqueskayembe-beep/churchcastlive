// Broadcaster capture: Float32 mic samples at the context rate (24 kHz) ->
// 20ms PCM16 frames posted to the main thread for WebSocket upload.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(480); // 20ms @ 24kHz
    this.i = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let k = 0; k < ch.length; k++) {
      const s = Math.max(-1, Math.min(1, ch[k]));
      this.frame[this.i++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.i === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(480);
        this.i = 0;
      }
    }
    return true;
  }
}
registerProcessor("capture-processor", CaptureProcessor);
