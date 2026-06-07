import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LANG_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese",
  it: "Italian", nl: "Dutch", pl: "Polish", ru: "Russian", uk: "Ukrainian",
  zh: "Chinese", ja: "Japanese", ko: "Korean", vi: "Vietnamese", hi: "Hindi",
  ar: "Arabic", he: "Hebrew", tr: "Turkish", sw: "Swahili", tl: "Tagalog",
};
const langName = (c: string) => LANG_NAMES[c] ?? c;

const BIBLE_VERSION: Record<string, string> = {
  en: "King James Version (KJV)", fr: "Louis Segond (LSG)",
  es: "Reina-Valera 1960 (RVR1960)", de: "Lutherbibel 2017",
  pt: "Almeida Revista e Atualizada (ARA)", it: "Nuova Riveduta 2006",
  nl: "Statenvertaling", pl: "Biblia Tysiąclecia",
  ru: "Synodal Translation", uk: "Ukrainian Bible — Ivan Ohienko",
  zh: "Chinese Union Version (和合本)", ja: "新共同訳",
  ko: "개역개정", vi: "Kinh Thánh Bản Truyền Thống",
  hi: "Pavitra Bible (IRV)", ar: "Smith & Van Dyke Arabic Bible",
  he: "Modern Hebrew Bible", tr: "Kutsal Kitap (Yeni Çeviri)",
  sw: "Swahili Union Version", tl: "Ang Biblia",
};
const bibleFor = (c: string) => BIBLE_VERSION[c] ?? "the most widely used local Bible translation";

/** Mint a short-lived single-use token for the ElevenLabs realtime Scribe websocket. */
export const getScribeToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return { ok: false as const, error: "ELEVENLABS_API_KEY not configured." };
    const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("scribe token", res.status, t);
      return { ok: false as const, error: `Token failed (${res.status})` };
    }
    const j = (await res.json()) as { token?: string };
    if (!j.token) return { ok: false as const, error: "No token returned" };
    return { ok: true as const, token: j.token };
  });

const TranslateInput = z.object({
  sessionId: z.string().uuid(),
  text: z.string().min(1).max(5000),
});

/**
 * Called every time the realtime Scribe finalizes a transcript segment.
 * Inserts the source transcript, then fan-out translates + queues streaming TTS
 * (audio_url is a route that streams from ElevenLabs on demand).
 */
export const translateCommitted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TranslateInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const lovableKey = process.env.LOVABLE_API_KEY;
    const elevenKey = process.env.ELEVENLABS_API_KEY;
    if (!lovableKey) return { ok: false as const, error: "LOVABLE_API_KEY not configured." };
    if (!elevenKey) return { ok: false as const, error: "ELEVENLABS_API_KEY not configured." };

    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .select("id, broadcaster_id, source_lang, target_langs, context, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sErr || !session) return { ok: false as const, error: "Session not found." };
    if (session.broadcaster_id !== userId) return { ok: false as const, error: "Not authorized." };
    if (session.status !== "live") return { ok: false as const, error: "Session is not live." };

    const sourceText = data.text.trim();
    if (!sourceText) return { ok: true as const, translations: [] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Insert source transcript
    await supabaseAdmin.from("transcripts").insert({
      session_id: session.id,
      lang: session.source_lang,
      text: sourceText,
      is_source: true,
    });

    const targets = session.target_langs as string[];
    const results = await Promise.all(
      targets.map(async (target) => {
        try {
          const sysPrompt =
            `You are a professional live interpreter for a church service. ` +
            `Context: ${session.context || "(none)"}. ` +
            `Translate from ${langName(session.source_lang)} to ${langName(target)}. ` +
            `Preserve tone, energy, and religious terminology. ` +
            `When the speaker quotes scripture, render the verse using the ${bibleFor(target)} verbatim. ` +
            `Output only the translated text — no commentary, no quotation marks.`;

          const tRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: sysPrompt },
                { role: "user", content: sourceText },
              ],
              temperature: 0.3,
            }),
          });
          if (!tRes.ok) {
            console.error(`translate ${target}`, tRes.status);
            return { lang: target, error: `Translate ${tRes.status}` };
          }
          const tJson = (await tRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const translation = (tJson.choices?.[0]?.message?.content ?? "").trim();
          if (!translation) return { lang: target, error: "Empty translation" };

          const transcriptId = crypto.randomUUID();
          const audioUrl = `/api/public/tts/${transcriptId}.mp3`;

          const { error: insErr } = await supabaseAdmin.from("transcripts").insert({
            id: transcriptId,
            session_id: session.id,
            lang: target,
            text: translation,
            is_source: false,
            audio_url: audioUrl,
          });
          if (insErr) return { lang: target, error: "Insert failed" };

          return { lang: target, translation, audioUrl };
        } catch (e) {
          console.error(`pipeline ${target}`, e);
          return { lang: target, error: (e as Error).message };
        }
      })
    );

    return { ok: true as const, sourceText, translations: results };
  });
