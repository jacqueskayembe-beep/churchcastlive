import { useState, useCallback, useEffect } from "react";
import { LANGUAGES } from "@/lib/languages";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Mic, Radio, Loader2 } from "lucide-react";

interface ActiveSession {
  id: string;
  church_name: string | null;
  source_lang: string;
  target_langs: string[];
  context: string | null;
}

interface Props {
  onStart: (session: ActiveSession) => void;
}

export function SessionSetup({ onStart }: Props) {
  const [churchName, setChurchName] = useState("");
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLangs, setTargetLangs] = useState<string[]>(["es", "fr"]);
  const [context, setContext] = useState("");
  const [audioSource, setAudioSource] = useState<"mic" | "device">("mic");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    // Request mic permission so device labels populate
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then((all) => setDevices(all.filter((d) => d.kind === "audioinput")))
      .catch(() => { /* mic denied — that's fine for type-mode demo */ });
  }, []);

  function toggleLang(code: string) {
    setTargetLangs((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  const handleStart = useCallback(async () => {
    if (targetLangs.length === 0) {
      toast.error("Pick at least one target language.");
      return;
    }
    setStarting(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { toast.error("Please sign in again."); setStarting(false); return; }

    const { data, error } = await supabase
      .from("sessions")
      .insert({
        broadcaster_id: u.user.id,
        church_name: churchName.trim() || null,
        source_lang: sourceLang,
        target_langs: targetLangs,
        context: context.trim() || null,
        status: "live",
      })
      .select("id, church_name, source_lang, target_langs, context")
      .single();

    if (error || !data) {
      console.error(error);
      toast.error("Could not start broadcast.");
      setStarting(false);
      return;
    }
    toast.success("Broadcast started.");
    onStart(data as ActiveSession);
  }, [churchName, sourceLang, targetLangs, context, onStart]);

  return (
    <div className="surface border border-border rounded-3xl p-8 shadow-card mb-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl">Start a broadcast</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Set the languages and context, then begin streaming.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-5">
          <Field label="Church / session name (optional)">
            <input
              value={churchName}
              onChange={(e) => setChurchName(e.target.value)}
              placeholder="St. Mary's — Sunday Service"
              className="input-base"
            />
          </Field>

          <Field label="From language">
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              className="input-base"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.flag} {l.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Audio source">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                onClick={() => setAudioSource("mic")}
                className={`px-3 py-2 rounded-md border text-sm transition ${audioSource === "mic" ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"}`}
              >
                <Mic className="size-4 inline mr-1" /> Microphone
              </button>
              <button
                type="button"
                onClick={() => setAudioSource("device")}
                className={`px-3 py-2 rounded-md border text-sm transition ${audioSource === "device" ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"}`}
              >
                Audio input
              </button>
            </div>
            {audioSource === "device" && (
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="input-base"
              >
                <option value="">Default input</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Input ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <div className="space-y-5">
          <Field label={`Translate to (${targetLangs.length} selected)`}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-1 -m-1">
              {LANGUAGES.filter((l) => l.code !== sourceLang).map((l) => {
                const on = targetLangs.includes(l.code);
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => toggleLang(l.code)}
                    className={`px-3 py-2 rounded-md border text-sm text-left transition ${on ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"}`}
                  >
                    <span className="mr-1.5">{l.flag}</span>{l.name}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Context for the translator (optional)">
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
              placeholder="E.g. Sunday sermon on forgiveness. The speaker references the parable of the Prodigal Son. Use reverent religious vocabulary."
              className="input-base resize-none"
            />
          </Field>
        </div>
      </div>

      <button
        onClick={handleStart}
        disabled={starting}
        className="mt-7 w-full md:w-auto md:px-10 py-3.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition shadow-glow disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {starting ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}
        Start broadcast
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">{label}</span>
      {children}
    </label>
  );
}
