import { createFileRoute } from "@tanstack/react-router";

// Map our language codes → OpenAI TTS voices (mirror of pipeline.functions.ts).
function voiceFor(lang: string): string {
  const map: Record<string, string> = {
    en: "onyx", es: "onyx", fr: "echo", de: "onyx", pt: "echo",
    it: "echo", nl: "onyx", pl: "onyx", ru: "onyx", uk: "onyx",
    zh: "echo", ja: "echo", ko: "echo", vi: "echo", hi: "onyx",
    ar: "onyx", he: "onyx", tr: "echo", sw: "onyx", tl: "echo",
  };
  return map[lang] ?? "onyx";
}

const TTS_INSTRUCTIONS =
  `You are a male interpreter voicing a live church sermon. ` +
  `Match the preacher's energy: if the text is exclamatory, emphatic, ` +
  `or full of praise (exclamation marks, ALL CAPS, "Hallelujah", "Amen", repeated words), ` +
  `speak with passion, excitement, and lifted volume. ` +
  `If the text is reflective, prayerful, or scriptural, speak warmly, ` +
  `slowly, and reverently. Always sound like a confident male preacher — ` +
  `never flat, never robotic. Preserve natural pauses at punctuation.`;

// Public streaming TTS endpoint.
// Looks up a transcript row by id, then streams MP3 bytes from OpenAI
// directly to the listener so playback can start before synthesis finishes.
export const Route = createFileRoute("/api/public/tts/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = params.id;
        if (!/^[0-9a-f-]{36}$/i.test(id)) {
          return new Response("Bad id", { status: 400 });
        }

        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) return new Response("TTS not configured", { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("transcripts")
          .select("id, lang, text, is_source")
          .eq("id", id)
          .maybeSingle();

        if (error || !row) return new Response("Not found", { status: 404 });
        if (row.is_source) return new Response("No audio for source", { status: 404 });
        if (!row.text?.trim()) return new Response("Empty text", { status: 404 });

        const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini-tts",
            input: row.text,
            voice: voiceFor(row.lang),
            instructions: TTS_INSTRUCTIONS,
            response_format: "mp3",
          }),
        });

        if (!ttsRes.ok || !ttsRes.body) {
          const txt = await ttsRes.text().catch(() => "");
          console.error("tts stream", ttsRes.status, txt.slice(0, 200));
          return new Response("TTS failed", { status: 502 });
        }

        // Stream the MP3 straight to the client. HTMLAudioElement will
        // progressively download and start playing as bytes arrive.
        return new Response(ttsRes.body, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=86400, immutable",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
    },
  },
});
