import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ProcessInput = z.object({
  sessionId: z.string().uuid(),
  audioBase64: z.string().min(1).max(20_000_000),
  mimeType: z.string().min(3).max(64),
});

const LANG_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese",
  it: "Italian", nl: "Dutch", pl: "Polish", ru: "Russian", uk: "Ukrainian",
  zh: "Chinese", ja: "Japanese", ko: "Korean", vi: "Vietnamese", hi: "Hindi",
  ar: "Arabic", he: "Hebrew", tr: "Turkish", sw: "Swahili", tl: "Tagalog",
};
const langName = (c: string) => LANG_NAMES[c] ?? c;

// Map our language codes → OpenAI TTS voices.
// MALE voices only: onyx (deep), echo (warm), ash (bright), fable (British).
function voiceFor(lang: string): string {
  const map: Record<string, string> = {
    en: "onyx", es: "onyx", fr: "echo", de: "onyx", pt: "echo",
    it: "echo", nl: "onyx", pl: "onyx", ru: "onyx", uk: "onyx",
    zh: "echo", ja: "echo", ko: "echo", vi: "echo", hi: "onyx",
    ar: "onyx", he: "onyx", tr: "echo", sw: "onyx", tl: "echo",
  };
  return map[lang] ?? "onyx";
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function extFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

export const processAudioChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProcessInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const openaiKey = process.env.OPENAI_API_KEY;
    const lovableKey = process.env.LOVABLE_API_KEY;
    if (!openaiKey) return { ok: false as const, error: "OPENAI_API_KEY not configured." };
    if (!lovableKey) return { ok: false as const, error: "LOVABLE_API_KEY not configured." };

    // Verify the user owns this session and fetch lang config
    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .select("id, broadcaster_id, source_lang, target_langs, context, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sErr || !session) return { ok: false as const, error: "Session not found." };
    if (session.broadcaster_id !== userId) return { ok: false as const, error: "Not authorized." };
    if (session.status !== "live") return { ok: false as const, error: "Session is not live." };

    const audioBytes = base64ToBytes(data.audioBase64);
    const ext = extFromMime(data.mimeType);

    // 1) Whisper STT
    const sttForm = new FormData();
    sttForm.append("file", new Blob([audioBytes as BlobPart], { type: data.mimeType }), `audio.${ext}`);
    sttForm.append("model", "whisper-1");
    sttForm.append("language", session.source_lang);
    sttForm.append("response_format", "json");

    const sttRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: sttForm,
    });
    if (!sttRes.ok) {
      const body = await sttRes.text();
      console.error("Whisper error", sttRes.status, body);
      return { ok: false as const, error: `Transcription failed (${sttRes.status}).` };
    }
    const sttJson = (await sttRes.json()) as { text?: string };
    const sourceText = (sttJson.text ?? "").trim();
    if (!sourceText) return { ok: true as const, sourceText: "", translations: [] };

    // Insert source transcript
    await supabase.from("transcripts").insert({
      session_id: session.id,
      lang: session.source_lang,
      text: sourceText,
      is_source: true,
    });

    // 2 + 3) For each target lang: translate → TTS → upload → insert
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const targets = session.target_langs as string[];
    const results = await Promise.all(
      targets.map(async (target) => {
        try {
          // Translate via Lovable AI Gateway
          const sysPrompt =
            `You are a professional live interpreter for a church service. ` +
            `Context: ${session.context || "(none)"}. ` +
            `Translate from ${langName(session.source_lang)} to ${langName(target)}. ` +
            `Preserve tone and religious terminology. ` +
            `Output only the translated text — no commentary, no quotation marks.`;

          const tRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Lovable-API-Key": lovableKey,
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: sysPrompt },
                { role: "user", content: sourceText },
              ],
              temperature: 0.3,
            }),
          });
          if (!tRes.ok) {
            const txt = await tRes.text();
            console.error(`translate ${target}`, tRes.status, txt.slice(0, 200));
            return { lang: target, error: `Translate ${tRes.status}` };
          }
          const tJson = (await tRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const translation = (tJson.choices?.[0]?.message?.content ?? "").trim();
          if (!translation) return { lang: target, error: "Empty translation" };

          // TTS via OpenAI
          const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini-tts",
              input: translation,
              voice: voiceFor(target),
              response_format: "mp3",
            }),
          });
          if (!ttsRes.ok) {
            const txt = await ttsRes.text();
            console.error(`tts ${target}`, ttsRes.status, txt.slice(0, 200));
            return { lang: target, error: `TTS ${ttsRes.status}` };
          }
          const mp3Bytes = new Uint8Array(await ttsRes.arrayBuffer());

          // Upload to Storage via admin client
          const key = `${session.id}/${target}/${crypto.randomUUID()}.mp3`;
          const { error: upErr } = await supabaseAdmin.storage
            .from("broadcast-audio")
            .upload(key, mp3Bytes, { contentType: "audio/mpeg", upsert: false });
          if (upErr) {
            console.error("upload", upErr);
            return { lang: target, error: "Upload failed" };
          }

          // Signed URL (24h)
          const { data: signed, error: signErr } = await supabaseAdmin.storage
            .from("broadcast-audio")
            .createSignedUrl(key, 60 * 60 * 24);
          if (signErr || !signed) {
            console.error("sign", signErr);
            return { lang: target, error: "Sign failed" };
          }

          // Insert transcript row (use admin to bypass RLS — we've already verified auth)
          await supabaseAdmin.from("transcripts").insert({
            session_id: session.id,
            lang: target,
            text: translation,
            is_source: false,
            audio_url: signed.signedUrl,
          });

          return { lang: target, translation, audioUrl: signed.signedUrl };
        } catch (e) {
          console.error(`pipeline ${target}`, e);
          return { lang: target, error: (e as Error).message };
        }
      })
    );

    return { ok: true as const, sourceText, translations: results };
  });
