import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { WebSocketDistribution } from "./distribution.mjs";
import { TranslationSession } from "./translator.mjs";
import { VoiceChangerStage } from "./voice-changer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const PORT = Number(process.env.PORT || 8787);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const PASTOR_VOICE_ID = process.env.PASTOR_VOICE_ID || "IxJypvU0tw5K9RWyTN8y";
const VOICE_CHANGER = process.env.VOICE_CHANGER !== "off" && !!ELEVENLABS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const DEV_NO_AUTH = process.env.DEV_NO_AUTH === "1"; // local testing only

const log = (...a) => console.log(new Date().toISOString(), ...a);
if (!OPENAI_API_KEY) { console.error("OPENAI_API_KEY is required"); process.exit(1); }

const dist = new WebSocketDistribution({ log });
/** @type {Map<string, any>} live broadcasts keyed by sessionId */
const broadcasts = new Map();

// ---------- Supabase helpers (use the broadcaster's own JWT; RLS applies) ----------
async function sb(pathname, { token, method = "GET", body } = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 || method !== "GET" ? null : res.json();
}

async function authorizeBroadcaster(sessionId, token) {
  const user = await sb("/auth/v1/user", { token });
  const rows = await sb(
    `/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}&select=id,broadcaster_id,source_lang,target_langs,status`,
    { token },
  );
  const s = rows?.[0];
  if (!s || s.broadcaster_id !== user.id) throw new Error("Not authorized for this session");
  return { userId: user.id, session: s };
}

async function sessionExists(sessionId, lang) {
  if (DEV_NO_AUTH) return true;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}&select=id,target_langs`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return !!rows?.[0] && (rows[0].target_langs ?? []).includes(lang);
}

// ---------- Broadcast pipeline ----------
const FRAME_BYTES = 24000 * 2 * 0.1; // 100ms frames to listeners

function startBroadcast({ sessionId, sourceLang, targetLangs, token, userId, control }) {
  const b = {
    sessionId, control, token, sessions: new Map(), stats: {},
    speechStart: null, lastSpeech: 0, inputText: "", captions: {},
  };

  const persist = (row) => {
    if (!token) return;
    sb("/rest/v1/transcripts", { token, method: "POST", body: { session_id: sessionId, ...row } })
      .catch((e) => log("[db] insert failed", e.message));
  };

  for (const lang of targetLangs) {
    const st = (b.stats[lang] = { latencies: [], frames: 0, status: "connecting" });
    b.captions[lang] = "";
    const voice = new VoiceChangerStage({
      apiKey: ELEVENLABS_API_KEY, voiceId: PASTOR_VOICE_ID, enabled: VOICE_CHANGER, log,
      emit: (pcm) => {
        for (let off = 0; off < pcm.length; off += FRAME_BYTES) {
          dist.publishAudio(sessionId, lang, pcm.subarray(off, Math.min(pcm.length, off + FRAME_BYTES)));
        }
        st.frames++;
      },
    });
    const flushCaption = () => {
      const text = b.captions[lang].trim();
      b.captions[lang] = "";
      if (text) persist({ lang, text, is_source: false });
    };
    const t = new TranslationSession({
      apiKey: OPENAI_API_KEY, lang, safetyId: userId ?? "dev", log,
      onStatus: (s) => { st.status = s; send(control, { type: "status", lang, status: s }); },
      onAudio: (pcm) => {
        if (b.speechStart) {
          const ms = Date.now() - b.speechStart;
          st.latencies.push(ms); if (st.latencies.length > 50) st.latencies.shift();
          send(control, { type: "latency", lang, ms });
          log(`[latency ${lang}] speech-onset -> first translated audio: ${ms}ms`);
          b.speechStart = null;
        }
        voice.push(pcm);
      },
      onOutputText: (d) => {
        b.captions[lang] += d;
        dist.publishEvent(sessionId, lang, { type: "caption_delta", delta: d });
        send(control, { type: "caption_delta", lang, delta: d });
        if (/[.!?…。！？]\s*$/.test(b.captions[lang]) && b.captions[lang].length > 40) flushCaption();
      },
      onInputText: targetLangs[0] === lang ? (d) => {
        b.inputText += d;
        send(control, { type: "source_delta", delta: d });
        if (/[.!?]\s*$/.test(b.inputText) && b.inputText.length > 40) {
          persist({ lang: sourceLang, text: b.inputText.trim(), is_source: true }); b.inputText = "";
        }
      } : undefined,
    });
    b.sessions.set(lang, { t, voice, flushCaption });
  }

  b.ingest = (pcm) => {
    // speech onset detection for latency measurement
    let s = 0; const n = pcm.length >> 1;
    for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2); s += v * v; }
    const loud = Math.sqrt(s / Math.max(1, n)) > 500;
    const now = Date.now();
    if (loud) { if (!b.speechStart && now - b.lastSpeech > 600) b.speechStart = now; b.lastSpeech = now; }
    const b64 = pcm.toString("base64");
    for (const { t } of b.sessions.values()) t.sendAudio(b64);
  };

  b.stop = () => {
    for (const { t, voice, flushCaption } of b.sessions.values()) { voice.flush(); flushCaption(); t.close(); }
    if (b.inputText.trim()) persist({ lang: sourceLang, text: b.inputText.trim(), is_source: true });
    dist.closeSession(sessionId);
    broadcasts.delete(sessionId);
    log(`[broadcast] stopped ${sessionId}`);
  };

  broadcasts.set(sessionId, b);
  log(`[broadcast] started ${sessionId} ${sourceLang} -> ${targetLangs.join(",")} voice=${VOICE_CHANGER ? PASTOR_VOICE_ID : "off"}`);
  return b;
}

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

dist.onCountChange = (sessionId, lang, count) => {
  send(broadcasts.get(sessionId)?.control, { type: "listeners", lang, count });
};

// ---------- HTTP (health, stats, static worklets/test pages) ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, broadcasts: broadcasts.size, voiceChanger: VOICE_CHANGER }));
  }
  if (url.pathname === "/stats") {
    const out = {};
    for (const [id, b] of broadcasts) {
      out[id] = Object.fromEntries(Object.entries(b.stats).map(([l, s]) => {
        const sorted = [...s.latencies].sort((a, c) => a - c);
        return [l, { status: s.status, listeners: dist.listenerCount(id, l), samples: sorted.length,
          p50: sorted[Math.floor(sorted.length / 2)] ?? null, max: sorted.at(-1) ?? null }];
      }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(out));
  }
  const file = path.normalize(path.join(PUBLIC_DIR, url.pathname));
  if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(404); res.end("Not found");
});

const wss = new WebSocketServer({ server, maxPayload: 1 << 20 });

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, "http://x");
  const sessionId = url.searchParams.get("session") ?? "";
  if (!/^[0-9a-zA-Z-]{1,64}$/.test(sessionId)) return ws.close(4000, "bad session");

  if (url.pathname === "/listen") {
    const lang = url.searchParams.get("lang") ?? "";
    if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) return ws.close(4000, "bad lang");
    if (!(await sessionExists(sessionId, lang))) return ws.close(4004, "no such booth");
    dist.addListener(sessionId, lang, ws);
    ws.on("message", () => {}); // listeners are receive-only
    return;
  }

  if (url.pathname === "/broadcast") {
    let ctx;
    try {
      if (DEV_NO_AUTH && !url.searchParams.get("token")) {
        ctx = { userId: "dev", session: {
          source_lang: url.searchParams.get("source") ?? "en",
          target_langs: (url.searchParams.get("langs") ?? "fr").split(","),
        } };
      } else {
        ctx = await authorizeBroadcaster(sessionId, url.searchParams.get("token") ?? "");
      }
    } catch (e) { send(ws, { type: "error", message: e.message }); return ws.close(4001, "unauthorized"); }

    broadcasts.get(sessionId)?.stop(); // one broadcaster per session
    const b = startBroadcast({
      sessionId, sourceLang: ctx.session.source_lang, targetLangs: ctx.session.target_langs,
      token: DEV_NO_AUTH && !url.searchParams.get("token") ? null : url.searchParams.get("token"),
      userId: ctx.userId, control: ws,
    });
    send(ws, { type: "ready", langs: ctx.session.target_langs });
    ws.on("message", (data, isBinary) => { if (isBinary) b.ingest(Buffer.from(data)); });
    ws.on("close", () => { if (broadcasts.get(sessionId) === b) b.stop(); });
    return;
  }

  ws.close(4000, "unknown endpoint");
});

server.listen(PORT, () => log(`ChurchCast realtime server on :${PORT} (voiceChanger=${VOICE_CHANGER})`));
