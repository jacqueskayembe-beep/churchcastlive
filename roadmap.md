# Roadmap

- [x] Dedicated Node.js WebSocket audio server (`realtime-server/`)
- [x] Modular distribution layer (swap in LiveKit/WebRTC later)
- [x] Broadcaster capture: AudioWorklet → 24 kHz PCM16 over WebSocket
- [x] Listener playback: AudioWorklet jitter buffer, sequence numbers, reconnect, bounded buffers, per-listener backpressure
- [x] Preserve existing UI, church management, database
- [x] Demo English→French with two listener windows
- [x] Multi-listener test (6) + latency measurement
- [ ] Host the audio server online and set its address in the app — blocked: needs a hosting account (e.g. Railway/Fly/Render) from the user
