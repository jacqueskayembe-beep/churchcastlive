
## Goal

Make ChurchCast voice-only. The preacher speaks; the backend transcribes, translates, and synthesizes the destination-language voice. Listeners hear the translated voice and see live captions.

## Changes

### 1. Frontend — dashboard becomes voice-only
- Remove the "type to broadcast" textarea, send button, and `⌘/Ctrl+Enter` handler from `LiveBroadcast.tsx`.
- Promote `MicCapture` to the primary control: prominent "Start broadcasting" / "Stop" mic button with live level meter and recording state.
- Keep the source-language live transcript panel (now populated by Whisper) and the per-language room cards.
- Each captured audio chunk is uploaded + sent to a `processChunk` server fn which runs STT → fan-out translate → TTS, then inserts a `transcripts` row per language with an `audio_url`.

### 2. Frontend — listener room
- Audio-first: big "Tap to listen" pill that unlocks autoplay, then sequentially plays each new `audio_url` arriving on the realtime channel via a Web Audio queue.
- Live captions: translated text fades in below the player as each chunk arrives (already plumbed via `transcripts` realtime; just render).

### 3. Backend pipeline (TanStack server functions, all on Lovable Cloud)
New file `src/lib/pipeline.functions.ts`:
- `processAudioChunk({ sessionId, audioBase64, mimeType })` — auth-gated to the session's broadcaster.
  1. **STT**: POST audio to OpenAI `audio/transcriptions` (`whisper-1`), language = session.source_lang. Insert source-language `transcripts` row.
  2. **Translate (parallel)**: for each `target_lang`, call Lovable AI Gateway (`google/gemini-3-flash-preview`) — keeps existing `translateChunk` logic.
  3. **TTS (parallel)**: for each translation, POST to OpenAI `audio/speech` (`gpt-4o-mini-tts`, voice `alloy`, format `mp3`).
  4. Upload each MP3 to a new public Storage bucket `broadcast-audio` at `{sessionId}/{lang}/{uuid}.mp3`.
  5. Insert one `transcripts` row per target language with `text` + `audio_url`.

All three providers run inside one server fn so a single round-trip from the browser per chunk delivers everything via realtime to listeners.

### 4. Storage + secrets
- Create public Storage bucket `broadcast-audio` with broadcaster-only insert policy and public read.
- Add secret `OPENAI_API_KEY` (used for both Whisper and TTS).

### 5. MicCapture cleanup
- Keep silence-boundary chunking (already implemented).
- Replace local queue/preview UI with auto-upload-on-finalize calling `processAudioChunk`. Show per-chunk status (uploading → transcribing → broadcasting → done / error).

### 6. Files
- Edit: `src/components/dashboard/LiveBroadcast.tsx`, `src/components/dashboard/MicCapture.tsx`, `src/components/dashboard/LanguageRoomCard.tsx` (remove text-typing affordances if any), `src/routes/room.$sessionId.$lang.tsx` (audio queue + captions).
- Create: `src/lib/pipeline.functions.ts`, `src/lib/audio-queue.ts` (listener-side sequential MP3 player).
- Delete: nothing structural; `translateChunk` stays as a helper but is no longer called from the browser.
- Migration: create `broadcast-audio` bucket + storage policies.

## Tradeoffs / notes

- **Latency budget per chunk**: Whisper ~1–2s + Gemini translate ~0.5–1s + OpenAI TTS ~1–2s per language, in parallel = ~3–5s end-to-end per sentence. Well under 10s.
- **Chunking**: silence-boundary (already chosen). 1.2–8s sentences.
- **Cost**: OpenAI is billed to the user's `OPENAI_API_KEY`. Gemini translation stays on Lovable AI Gateway.
- **Public route SSR**: `room.$sessionId.$lang.tsx` keeps SSR for the page shell + OG tags; realtime + audio queue mount client-side.
- **No live mic streaming protocol** (WebSocket/Deepgram) in v1; sentence-chunked REST keeps things robust on the Cloudflare Worker runtime.

Ready to build on approval.
