import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TranslateInput = z.object({
  text: z.string().min(1).max(2000),
  sourceLang: z.string().min(2).max(8),
  targetLang: z.string().min(2).max(8),
  context: z.string().max(2000).optional().default(""),
});

const LANG_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese",
  it: "Italian", nl: "Dutch", pl: "Polish", ru: "Russian", uk: "Ukrainian",
  zh: "Chinese", ja: "Japanese", ko: "Korean", vi: "Vietnamese", hi: "Hindi",
  ar: "Arabic", he: "Hebrew", tr: "Turkish", sw: "Swahili", tl: "Tagalog",
};

function langName(code: string) {
  return LANG_NAMES[code] ?? code;
}

/**
 * Translate a chunk of speech via Lovable AI Gateway (Gemini).
 * Designed for low-latency, parallel calls — one per target language per chunk.
 */
export const translateChunk = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => TranslateInput.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const system = `You are a professional live interpreter for a church service. ` +
      `Context provided by the broadcaster: ${data.context || "(none)"}. ` +
      `Translate the following spoken text from ${langName(data.sourceLang)} to ${langName(data.targetLang)}. ` +
      `Preserve tone, religious terminology, and natural spoken cadence. ` +
      `Output only the translated text — no explanations, no quotation marks, no commentary.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: data.text },
        ],
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) {
        return { translation: "", error: "Rate limit reached — please slow down." };
      }
      if (res.status === 402) {
        return { translation: "", error: "AI credits exhausted. Add credits in Workspace Settings." };
      }
      throw new Error(`Translation failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const translation = json.choices?.[0]?.message?.content?.trim() ?? "";
    return { translation, error: null as string | null };
  });
