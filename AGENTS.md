# AGENTS.md

- Live interpretation audio runs in the separate Node service `realtime-server/` (broadcaster ingest → one gpt-realtime-translate session per language → ElevenLabs Voice Changer → per-language WebSocket channel); persistent sockets and shared fan-out state can't live in the edge-runtime app.
- The app talks to that service only via `src/lib/live-audio.ts`, reading its address from `VITE_REALTIME_SERVER_URL` (localhost fallback in dev); keep it the single client entry point.
- Audio distribution is isolated in `realtime-server/src/distribution.mjs`; swap that module (e.g. for LiveKit/WebRTC) without touching the translation pipeline.
- Listener playback uses the AudioWorklet in `realtime-server/public/player-worklet.js` (bounded jitter buffer, sequence-numbered frames); slow listeners drop their own frames server-side so nobody delays the shared channel.
- The audio server writes caption lines to the database with the broadcaster's own login token, so normal access rules apply; it never uses admin credentials.
