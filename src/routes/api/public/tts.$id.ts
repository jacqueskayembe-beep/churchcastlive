import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Pastor cloned voice (ElevenLabs) — used for every target language.
const VOICE_ID = "IxJypvU0tw5K9RWyTN8y";

export const Route = createFileRoute("/api/public/tts/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const elevenKey = process.env.ELEVENLABS_API_KEY;
        if (!elevenKey) {
          return new Response("ELEVENLABS_API_KEY not configured", { status: 500 });
        }

        // params.id is "<uuid>.mp3" — strip the extension.
        const rawId = params.id ?? "";
        const id = rawId.replace(/\.mp3$/i, "");
        if (!/^[0-9a-f-]{36}$/i.test(id)) {
          return new Response("Invalid id", { status: 400 });
        }

        const { data: row, error } = await supabaseAdmin
          .from("transcripts")
          .select("text, lang")
          .eq("id", id)
          .maybeSingle();
        if (error || !row) {
          return new Response("Not found", { status: 404 });
        }

        const ttsRes = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3`,
          {
            method: "POST",
            headers: {
              "xi-api-key": elevenKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: row.text,
              model_id: "eleven_flash_v2_5",
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.3,
                use_speaker_boost: true,
              },
            }),
          },
        );

        if (!ttsRes.ok || !ttsRes.body) {
          const txt = await ttsRes.text().catch(() => "");
          console.error("11labs stream", ttsRes.status, txt.slice(0, 200));
          return new Response("TTS failed", { status: 502 });
        }

        return new Response(ttsRes.body, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
    },
  },
});
