# ChurchCast Realtime Audio Server

Dedicated Node.js WebSocket server: broadcaster mic in → GPT Realtime Translate →
ElevenLabs Voice Changer (pastor's cloned voice) → one shared audio channel per
language → listeners over WebSocket.

## Deploy to Railway (recommended)

1. Create an account at https://railway.app (free trial credit is enough to start).
2. Click **New Project → Deploy from GitHub repo** and pick this repository.
   - If the repo isn't on GitHub yet: in the Lovable editor use
     **GitHub → Connect** (top right) to push it first.
3. Railway detects the root app; tell it to use the `realtime-server` folder:
   - In the service settings set **Root Directory** to `realtime-server`
   - It will build from the included `Dockerfile` automatically.
4. Add these environment variables (Service → Variables):
   - `OPENAI_API_KEY` — your OpenAI key (for GPT Realtime Translate)
   - `ELEVENLABS_API_KEY` — your ElevenLabs key (voice changer)
   - `PASTOR_VOICE_ID` — the cloned voice ID (default: IxJypvU0tw5K9RWyTN8y)
   - `SUPABASE_URL` — https://prnuyqaaodcxztmoxzun.supabase.co
   - `SUPABASE_PUBLISHABLE_KEY` — the project's publishable (anon) key
5. In **Settings → Networking**, click **Generate Domain** to get a public URL
   like `https://churchcast-realtime.up.railway.app`.
6. Verify: open `https://<your-domain>/health` — you should see `{"ok":true,...}`.
7. Send the domain to Lovable so the app can be pointed at it
   (it becomes `VITE_REALTIME_SERVER_URL`, e.g. `wss://churchcast-realtime.up.railway.app`).

## Render alternative

New → Web Service → same repo → Root Directory `realtime-server` →
Runtime: Docker. Same environment variables. Render gives you an
`https://<name>.onrender.com` URL.

## Run locally (for testing on your own machine)

```bash
cd realtime-server
npm install
OPENAI_API_KEY=... ELEVENLABS_API_KEY=... \
SUPABASE_URL=https://prnuyqaaodcxztmoxzun.supabase.co \
SUPABASE_PUBLISHABLE_KEY=... \
node src/server.mjs
```

Then open the app at http://localhost:8080 — it connects to
`ws://localhost:8787` automatically. For broadcaster testing without sign-in,
add `DEV_NO_AUTH=1` (never set this in production).

## Endpoints

- `GET /health` — liveness check
- `GET /stats` — per-language latency/listener stats
- `WS /broadcast?session=<id>&token=<jwt>` — broadcaster ingest (PCM16 24kHz binary frames)
- `WS /listen?session=<id>&lang=<code>` — listener channel (binary audio + caption events)
- `GET /player-worklet.js`, `GET /capture-worklet.js` — AudioWorklet modules served to browsers
