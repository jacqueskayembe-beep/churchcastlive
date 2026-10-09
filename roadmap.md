# Roadmap

- [ ] Dedicated Node.js WebSocket audio server (`realtime-server/`): broadcaster ingest → gpt-realtime-translate per language → ElevenLabs Voice Changer (pastor voice) → one shared channel per language
- [ ] Modular distribution layer (swap in LiveKit/WebRTC later)
- [ ] Broadcaster capture: AudioWorklet → 24 kHz PCM16 over WebSocket
- [ ] Listener playback: AudioWorklet, jitter buffer, sequence numbers, continuous playback, reconnect, bounded buffers, per-listener backpressure
- [ ] Preserve existing UI, church management, database
- [ ] Demo English→French continuous audio with two browser windows
- [ ] Multi-listener test + latency measurement
- [ ] Routine package security update
