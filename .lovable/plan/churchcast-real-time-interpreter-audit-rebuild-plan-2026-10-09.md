# ChurchCast Real-Time Interpreter — Audit & Rebuild Plan

## Technical audit (current state)

**Current pipeline (verified in code):**
1. Broadcaster's browser opens ElevenLabs Scribe realtime STT (`MicCapture.tsx`, `scribe_v2_realtime`, VAD commit).
2. Each committed phrase is sent to `translateCommitted` (server fn) → one Gemini 2.5 Pro call per target language via the gateway.
3. Each translation inserts a `transcripts` row whose `audio_url` points at `/api/public/tts/$id`, a route that synthesizes ElevenLabs MP3 **on every listener request** (stock male voice "George").
4. Listener rooms (`/room/$sessionId/$lang`) receive rows via Supabase Realtime and play MP3 clips back-to-back through a single `<audio>` element.

**What is broken / root causes:**
- **Segment-based, not continuous**: each ~15s phrase is a full STT→translate→TTS cycle; the listener hears discrete clips with gaps, not flowing speech.
- **No live audio channel**: audio travels as per-segment MP3 files triggered by database rows; there is no persistent media path, so latency = STT commit + translation + full TTS synthesis + playback queueing.
- **Repeated work and duplicated speech**: the TTS route re-synthesizes the same text per listener request; audio cache headers hide but don't fix this.
- **No per-language continuity**: every translation call is stateless; no rolling context beyond the broadcaster's static context field.
- **Wrong voice**: stock "George" voice, not the pastor's clone.
- **No degradation handling**: if any step fails mid-session, the listener just hears silence — no status, no fallback.

**What works and is reused:** Google OAuth + dashboard, two-stage booth creation (pending → live), QR codes/share links, `sessions`/`transcripts` tables + RLS, Supabase Realtime for captions and listener presence, ElevenLabs Scribe STT (proven in browser), NDI guidance, styling, public booth routes.

## Target architecture (per your decisions)

```
Pastor mic / NDI (browser)
  → ElevenLabs Scribe realtime STT (kept — works)
  → OpenAI gpt-realtime-translate  (persistent server WebSocket session)
  → streaming translated text + translated speech per language
  → ElevenLabs TTS with the pastor's cloned voice (IxJypvU0tw5K9RWyTN8y)
  → LiveKit: one audio track per target language, unlimited listeners
  → listener room: LiveKit audio + Supabase Realtime captions (unchanged UI)
```

Modular adapters wrap each step so OpenAI/Scribe/Gemini can be swapped without touching the UI (master-prompt requirement).

## Implementation steps

1. **Secrets & accounts (needs you)**
   - Request LiveKit Cloud credentials (URL, API key, API secret) via the secure form — create a free LiveKit Cloud project first.
   - Verify `OPENAI_API_KEY` has Realtime access; confirm the exact `gpt-realtime-translate` model ID against OpenAI's current API docs. If it is unavailable, fall back to Scribe STT + a gateway translation model, keeping the same adapter interface.
2. **Voice profile**: store the pastor's clone voice ID (IxJypvU0tw5K9RWyTN8y) in the sessions/voice configuration so TTS uses it everywhere; male-only voice preserved.
3. **Realtime translation session (server route)**: a WebSocket-based server route holds one persistent OpenAI Realtime session per live broadcast. Broadcaster audio (relayed from the browser) streams in; translated text and audio stream out per target language. Speech-aware segmentation buffers translated text into speakable sentences before TTS.
4. **TTS with cloned voice**: ElevenLabs streaming TTS using the pastor voice ID, fed sentence-by-sentence; tone/energy matched from the source audio (excited stays excited).
5. **LiveKit distribution**: broadcaster's session creates a LiveKit room (one per session); the server publishes one audio track per target language; a public token endpoint issues listener join tokens for a single room/language — no login required.
6. **Listener room rewrite**: same peaceful UI, but audio joins via LiveKit ( Tap to Listen → connect + subscribe to the language track). Captions still flow through Supabase Realtime. Fallback to the existing MP3-clip playback if LiveKit is unreachable.
7. **Diagnostics & resilience**: latency logging per pipeline stage, live error surface on the dashboard, auto-reconnect for the realtime session, listener "reconnecting" state.
8. **Verification**: end-to-end test with a real broadcast — speak, confirm caption + audible translated voice on a booth within target latency, multiple listeners, stop/restart.

## Notes

- Staying inside Lovable first: the persistent WebSocket session is the riskiest piece in this environment; if the edge runtime blocks it, the plan falls back to Scribe STT + gateway translation + ElevenLabs cloned TTS over LiveKit (same listener experience), and we revisit a dedicated backend only if needed.
- Existing authentication, dashboard, booths, QR codes, database records, and styling are preserved.
