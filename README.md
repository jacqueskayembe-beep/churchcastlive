# Global Church Voices

Project: ChurchCast — Real-Time Multilingual Translation Broadcasting Platform

Build a full-stack web application called ChurchCast — a real-time speech translation and broadcasting platform designed specifically for churches. The platform allows a broadcaster to stream live audio (from a microphone or audio device), translate it in near-real-time into multiple languages simultaneously, and broadcast each language to a dedicated public room that anyone with a link or QR code can join — no account required for listeners.

Authentication

Google OAuth (Gmail sign-in) for broadcasters only

Listeners do not need an account — rooms are publicly accessible via shareable link or QR code

After login, the broadcaster lands on their personal Dashboard

Dashboard (Broadcaster View)

The main control center for authenticated users. It should include:

Session Setup Panel:

A "From Language" selector (source language being spoken)

A multi-select "Translate To" selector for one or more target languages (support all languages available via Gemini)

An audio source selector:

Live microphone (via browser getUserMedia)

System/device audio input (list all available audio input devices via MediaDevices.enumerateDevices())

MP3/audio file upload (for pre-recorded content)

A Context Field — a free-text box where the broadcaster can provide background context (e.g., "This is a Sunday sermon about forgiveness. Speaker uses biblical references.") — this context is injected into the translation model system prompt to improve accuracy

A "Start Broadcast" button that generates the session and rooms

Active Broadcast Panel (after starting):

Shows the live transcription (speech-to-text output) in real time

Shows each translated language output as it's generated

For each target language, displays:

The room name (e.g., "French Room")

A unique shareable URL (e.g., churchcast.app/room/[unique-id]/fr)

A QR code for that room (generated client-side)

A listener count (live, via WebSocket)

A Stop Broadcast button

Past Sessions Section:

List of previous broadcasts with timestamps, languages used, and duration

Translation Pipeline (Backend)

Use the following architecture for near-real-time translation:

Step 1 — Speech to Text (ElevenLabs / Deepgram)

Capture audio from the selected input source

Stream audio in ~3-second chunks to a speech-to-text service

Use ElevenLabs for STT if available, otherwise Deepgram (streaming WebSocket API preferred for low latency)

Output: raw transcript text in the source language, chunked in ~3-second segments

Do NOT wait for a full sentence — process and forward partial chunks immediately as they arrive

Step 2 — Translation (Gemini)

Pass each transcript chunk to Google Gemini (use gemini-1.5-flash or gemini-pro for speed)

Run one parallel Gemini call per target language simultaneously (not sequentially)

Include the broadcaster's context in the system prompt for each call

System prompt template:

"You are a professional live interpreter for a church service. Context provided by the broadcaster: [CONTEXT]. Translate the following spoken text from [SOURCE_LANGUAGE] to [TARGET_LANGUAGE]. Preserve tone, religious terminology, and natural spoken cadence. Output only the translated text, no explanations."

Output: translated text chunk per language

Step 3 — Text to Speech (ElevenLabs)

Pass each translated text chunk to ElevenLabs TTS API

Use a consistent, natural-sounding voice per language (pick appropriate multilingual voice)

Stream the audio output immediately to the room's WebSocket channel as it's generated

Do NOT wait for the full paragraph — begin TTS as soon as translation returns

Timing Goal:

Target end-to-end latency of ~3–6 seconds from spoken word to listener's ear

Pipeline runs: Audio capture → 3s chunk → STT → parallel Gemini translations → parallel ElevenLabs TTS → broadcast to room

Listener Room (Public — No Auth Required)

Each language has its own public room URL and QR code. When a listener opens the link:

They land on a clean, minimal Listener Page showing:

The room name (e.g., "🇫🇷 French Translation Room")

Church/session name (if set by broadcaster)

A "Tap to Listen" button (required for browser autoplay policy)

A live translated text feed (transcript display, scrolling)

A small status indicator: "🔴 Live" or "⚫ Offline"

Audio plays automatically after the user taps the button

The page works on mobile (optimized for phone screens — churchgoers will use phones)

No controls needed beyond play/pause — this is a passive listening experience

Real-Time Infrastructure

Use WebSockets (or Supabase Realtime) for:

Streaming transcript text to the dashboard

Streaming translated audio chunks to listener rooms

Broadcasting listener count back to the dashboard

Each room subscription is keyed by [session_id]/[language_code]

If using Supabase: use Realtime channels for text, and a CDN or blob URL approach for audio chunk delivery

Design & UI Direction

Aesthetic: Warm, reverent, and trustworthy — think stained glass color accents on a deep navy or charcoal background. Clean sans-serif for UI text, a slightly elegant serif or display font for room names and headings.

Broadcaster dashboard: Dense but organized — a command center feel, not cluttered

Listener room: Extremely simple, peaceful, spiritual — centered layout, large text, gentle fade-in animations for new transcript lines

Mobile-first for listener pages

Responsive for dashboard (tablet/desktop)

use what you think is best after all. I trust you.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://churchcastlive.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/85dd65d9-cd2d-49b9-a508-5d2fdbd2d138).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
