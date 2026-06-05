import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Radio, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getLanguage } from "@/lib/languages";

export const Route = createFileRoute("/room/$sessionId/$lang")({
  ssr: false,
  head: ({ params }) => {
    const lang = getLanguage(params.lang);
    const title = `${lang.flag} ${lang.nativeName} — Live translation on ChurchCast`;
    const description = `Listen to the live church service translated into ${lang.name} (${lang.nativeName}) on ChurchCast — audio and scrolling captions, no app required.`;
    const url = `https://dlt-translation-cast.lovable.app/room/${params.sessionId}/${params.lang}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        { property: "og:type", content: "website" },
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: ListenerRoom,
  notFoundComponent: () => (
    <div className="min-h-screen grid place-items-center px-6 text-center">
      <div>
          <h1 className="font-display text-4xl mb-2">Booth not found</h1>
          <p className="text-muted-foreground">This translation booth doesn't exist.</p>
      </div>
    </div>
  ),
  errorComponent: () => (
    <div className="min-h-screen grid place-items-center px-6 text-center">
      <div>
        <h1 className="font-display text-3xl mb-2">Something went wrong</h1>
        <p className="text-muted-foreground">Please refresh the page.</p>
      </div>
    </div>
  ),
});

interface SessionInfo {
  id: string;
  church_name: string | null;
  status: string;
  source_lang: string;
}

interface TranscriptLine {
  id: string;
  text: string;
  created_at: string;
  audio_url: string | null;
}

function ListenerRoom() {
  const { sessionId, lang } = Route.useParams();
  const language = getLanguage(lang);
  const [session, setSession] = useState<SessionInfo | null | "missing">(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const audioQueueRef = useRef<string[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);

  // Fetch session + initial transcripts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: s } = await supabase
        .from("sessions")
        .select("id, church_name, status, source_lang")
        .eq("id", sessionId)
        .maybeSingle();
      if (cancelled) return;
      if (!s) { setSession("missing"); return; }
      setSession(s as SessionInfo);

      const { data: ts } = await supabase
        .from("transcripts")
        .select("id, text, created_at, audio_url")
        .eq("session_id", sessionId)
        .eq("lang", lang)
        .order("created_at", { ascending: true })
        .limit(50);
      if (!cancelled && ts) setLines(ts as TranscriptLine[]);
    })();
    return () => { cancelled = true; };
  }, [sessionId, lang]);

  // Realtime: transcripts + session status
  useEffect(() => {
    const channel = supabase
      .channel(`room-${sessionId}-${lang}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "transcripts",
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        const row = payload.new as TranscriptLine & { lang: string };
        if (row.lang !== lang) return;
        setLines((prev) => [...prev, row].slice(-50));
        if (row.audio_url && listening && !muted) {
          audioQueueRef.current.push(row.audio_url);
          playNext();
        }
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "sessions",
        filter: `id=eq.${sessionId}`,
      }, (payload) => {
        const row = payload.new as SessionInfo;
        setSession((prev) => (prev && prev !== "missing" ? { ...prev, ...row } : prev));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [sessionId, lang, listening, muted]);

  // Presence: join listener count channel when actively listening
  useEffect(() => {
    if (!listening) return;
    const ch = supabase.channel(`listeners-${sessionId}-${lang}`, {
      config: { presence: { key: `l-${Math.random().toString(36).slice(2, 10)}` } },
    });
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ joined_at: new Date().toISOString() });
      }
    });
    return () => { supabase.removeChannel(ch); };
  }, [sessionId, lang, listening]);

  // Auto-scroll feed
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  function playNext() {
    if (playingRef.current) return;
    const next = audioQueueRef.current.shift();
    if (!next) return;
    playingRef.current = true;
    const audio = audioElRef.current ?? new Audio();
    audioElRef.current = audio;
    audio.src = next;
    audio.onended = () => { playingRef.current = false; playNext(); };
    audio.onerror = () => { playingRef.current = false; playNext(); };
    audio.play().catch(() => { playingRef.current = false; });
  }

  function startListening() {
    setListening(true);
    // Unlock audio context on user gesture
    const audio = audioElRef.current ?? new Audio();
    audioElRef.current = audio;
    audio.muted = false;
    audio.play().catch(() => {});
  }

  if (session === null) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  }
  if (session === "missing") {
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <h1 className="font-display text-4xl mb-2">Booth not found</h1>
          <p className="text-muted-foreground">This broadcast may have ended.</p>
        </div>
      </div>
    );
  }

  const isLive = session.status === "live";

  return (
    <div className="min-h-[100dvh] flex flex-col bg-hero">
      <header className="px-5 pt-6 pb-4 text-center">
        <div className="inline-flex items-center gap-2 mb-2">
          <span className={`size-2 rounded-full ${isLive ? "bg-rose-glow animate-pulse-dot" : "bg-muted-foreground"}`} />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            {isLive ? "Live" : "Offline"}
          </span>
        </div>
        <div className="text-5xl mb-1">{language.flag}</div>
        <h1 className="font-display text-3xl">{language.nativeName}</h1>
        {session.church_name && (
          <p className="mt-1 text-sm text-muted-foreground font-display italic">
            {session.church_name}
          </p>
        )}
      </header>

      <div
        ref={feedRef}
        className="flex-1 px-6 py-6 overflow-y-auto space-y-5 max-w-2xl w-full mx-auto"
      >
        {lines.length === 0 ? (
          <p className="text-center text-muted-foreground italic font-display text-lg mt-12">
            {isLive ? "Waiting for the first words…" : "This broadcast hasn't started yet."}
          </p>
        ) : (
          lines.map((line) => (
            <p
              key={line.id}
              className="text-xl md:text-2xl leading-relaxed text-foreground animate-fade-up font-display"
            >
              {line.text}
            </p>
          ))
        )}
      </div>

      <footer className="px-5 pb-8 pt-4 sticky bottom-0 surface/80 backdrop-blur border-t border-border">
        <div className="max-w-md mx-auto">
          {!listening ? (
            <button
              onClick={startListening}
              className="w-full py-5 rounded-2xl bg-amber-gradient text-primary-foreground font-medium text-lg shadow-glow active:scale-[0.98] transition"
            >
              <Radio className="size-5 inline mr-2" />
              Tap to Listen
            </button>
          ) : (
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl surface-elevated border border-border">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-rose-glow animate-pulse-dot" />
                <span className="text-sm font-medium">Listening</span>
              </div>
              <button
                onClick={() => setMuted((m) => !m)}
                className="p-2 rounded-md hover:bg-secondary transition"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </button>
            </div>
          )}
          <p className="text-center text-[11px] text-muted-foreground mt-3">
            ChurchCast · Live translation
          </p>
        </div>
      </footer>
    </div>
  );
}
