# ChurchCast — Build Plan

A real-time multilingual translation broadcasting platform for churches. Broadcaster speaks → near-real-time transcript → parallel Gemini translations → ElevenLabs TTS → public per-language listener rooms (link + QR, no auth).

## Stack & infra

- **Frontend:** TanStack Start (already scaffolded), Tailwind v4, shadcn/ui
- **Backend:** Lovable Cloud (Supabase) — auth, Postgres, Realtime channels, Storage for audio chunks
- **Auth:** Google OAuth via Lovable broker (broadcasters only; listeners are anonymous)
- **STT:** Deepgram streaming WebSocket (lower latency + better streaming than ElevenLabs Scribe for live use)
- **Translation:** Lovable AI Gateway → `google/gemini-3-flash-preview` (one parallel call per target language)
- **TTS:** ElevenLabs `eleven_turbo_v2_5` (low latency multilingual), per-language voice mapping
- **Realtime transport:** Supabase Realtime channels keyed by `session_id:lang` — broadcast translated text + audio chunk URLs; presence tracks listener count
- **Audio delivery:** TTS MP3 chunks uploaded to Supabase Storage (public bucket), URL broadcast over channel; listener plays sequentially via Web Audio queue

## Data model

```
profiles           (id → auth.users, display_name, email, avatar_url)
sessions           (id, broadcaster_id, church_name, source_lang, target_langs[], context, status, started_at, ended_at)
transcripts        (id, session_id, lang, text, is_source, created_at)   -- append-only log for replay/history
```

Public read on transcripts (RLS). Sessions readable by anyone when status='live' (for listener page metadata).

## Pipeline (broadcaster side, runs in browser)

```
mic / device input / mp3 file
   ↓  MediaRecorder → 3s opus chunks
   ↓  WebSocket → server fn → Deepgram streaming
   ↓  partial transcript chunks emitted
   ↓  for each target lang in parallel:
        Gemini translate (with context system prompt)
        ElevenLabs TTS (turbo v2.5) → mp3 bytes
        upload to Storage → broadcast {text, audio_url, seq} on `session:{id}:{lang}` channel
```

Server functions handle Deepgram (needs API key), Gemini, ElevenLabs, and Storage uploads. Browser owns audio capture + chunking + orchestration.

## Routes

```
/                            marketing landing (hero, "Sign in to broadcast")
/auth                        Google sign-in
/_authenticated/dashboard    broadcaster dashboard (setup + live panel + past sessions)
/room/$sessionId/$lang       public listener room (QR target)
/api/public/stt              POST audio chunk → returns transcript (Deepgram)
                             (server fn for translate + tts called from browser)
```

## UI direction

- **Aesthetic:** deep navy/charcoal base, warm stained-glass accents (amber, deep rose, teal), elegant serif (Cormorant Garamond) for headings/room names, Inter for UI
- **Dashboard:** command-center grid — left: setup form, right: live transcript + per-language cards (each with QR, URL copy, listener count, mini scrolling translation)
- **Listener room:** mobile-first, centered, big "Tap to Listen" pill, large fading transcript lines, live indicator dot
- **Past sessions:** simple table below dashboard

## Build order

1. Enable Lovable Cloud + ElevenLabs connector; add Deepgram + Gemini keys (Gemini via Lovable AI Gateway, no user key needed)
2. Design system in `src/styles.css` (palette, fonts, gradient/glow tokens)
3. DB migration: profiles, sessions, transcripts + RLS + grants + auth trigger
4. Landing page + Google auth + `_authenticated` layout (already managed by integration)
5. Dashboard: session setup form, device enumeration, context field
6. Server fns: `translateChunk` (Gemini), `synthesizeTts` (ElevenLabs → Storage), `transcribeChunk` (Deepgram REST for MVP — see note)
7. Broadcaster orchestrator: MediaRecorder 3s loop → STT → fan-out translate+TTS → publish to realtime
8. Listener room: subscribe to channel, audio queue player, scrolling transcript, presence count
9. QR generation (`qrcode` lib) + share URL copy
10. Past sessions list
11. SEO: sitemap, robots, route metadata

## Technical notes / tradeoffs

- **STT:** Using Deepgram REST with 3s chunks (simpler than wiring a browser↔server↔Deepgram WebSocket tunnel through a serverless worker, which has connection-lifetime limits). True streaming can be a v2 upgrade. Latency target 3–6s is achievable with REST + chunking.
- **Audio delivery:** Chunked MP3 over Storage URLs (broadcast via Realtime) instead of a binary WebSocket — works inside the serverless worker constraints and gives listeners automatic CDN + replay.
- **Parallel translation:** `Promise.all` over target langs inside the orchestrator; each lang has independent latency.
- **Worker runtime:** No `child_process`/native bins; all server fns use `fetch`. ✓
- **Secrets needed:** `DEEPGRAM_API_KEY` (will prompt user), `ELEVENLABS_API_KEY` (via connector), `LOVABLE_API_KEY` (auto for Gemini)

## What I'll ask the user before/during build

- Confirm Deepgram is OK for STT (vs. waiting on ElevenLabs Scribe realtime which is newer/less battle-tested). If they prefer ElevenLabs, we use Scribe v2 realtime.
- They'll need to provide a Deepgram API key when we get to the STT step.

## Out of scope for v1

- Session recording/playback
- Listener-side language switching mid-session
- Custom voice per broadcaster
- Payment/tiers
- Native mobile app

Ready to build on approval.