import { useCallback, useEffect, useRef, useState } from "react";
import { Send, StopCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getLanguage } from "@/lib/languages";
import { LanguageRoomCard } from "./LanguageRoomCard";
import { translateChunk } from "@/lib/translation.functions";
import { toast } from "sonner";

interface Props {
  session: {
    id: string;
    church_name: string | null;
    source_lang: string;
    target_langs: string[];
    context: string | null;
  };
  onStop: () => void;
}

interface FeedLine { id: string; text: string; lang: string; created_at: string; }

export function LiveBroadcast({ session, onStop }: Props) {
  const [sourceFeed, setSourceFeed] = useState<FeedLine[]>([]);
  const [langFeeds, setLangFeeds] = useState<Record<string, FeedLine[]>>({});
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sourceLang = session.source_lang;

  // Subscribe to all transcripts for this session
  useEffect(() => {
    // Hydrate existing
    supabase
      .from("transcripts")
      .select("id, text, lang, created_at, is_source")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (!data) return;
        const src: FeedLine[] = [];
        const others: Record<string, FeedLine[]> = {};
        for (const row of data) {
          const line = { id: row.id, text: row.text, lang: row.lang, created_at: row.created_at };
          if (row.is_source) src.push(line);
          else (others[row.lang] ||= []).push(line);
        }
        setSourceFeed(src);
        setLangFeeds(others);
      });

    const channel = supabase
      .channel(`broadcast-${session.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "transcripts",
        filter: `session_id=eq.${session.id}`,
      }, (payload) => {
        const row = payload.new as { id: string; text: string; lang: string; created_at: string; is_source: boolean };
        const line = { id: row.id, text: row.text, lang: row.lang, created_at: row.created_at };
        if (row.is_source) setSourceFeed((p) => [...p, line].slice(-100));
        else setLangFeeds((p) => ({ ...p, [row.lang]: [...(p[row.lang] || []), line].slice(-100) }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session.id]);

  // Presence channels per language for listener counts
  useEffect(() => {
    const channels = session.target_langs.map((lang) => {
      const ch = supabase.channel(`listeners-${session.id}-${lang}`, {
        config: { presence: { key: "listener" } },
      });
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState();
        const count = Object.values(state).reduce((sum, arr) => sum + (arr as unknown[]).length, 0);
        setCounts((c) => ({ ...c, [lang]: count }));
      });
      ch.subscribe();
      return ch;
    });
    return () => { channels.forEach((c) => supabase.removeChannel(c)); };
  }, [session.id, session.target_langs]);

  const sendChunk = useCallback(async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    setInputText("");
    inputRef.current?.focus();

    // 1) insert source transcript immediately
    const srcInsert = await supabase
      .from("transcripts")
      .insert({ session_id: session.id, lang: sourceLang, text, is_source: true });
    if (srcInsert.error) {
      toast.error("Failed to publish transcript.");
      setSending(false);
      return;
    }

    // 2) translate in parallel for all target langs
    try {
      await Promise.all(
        session.target_langs.map(async (target) => {
          const result = await translateChunk({
            data: {
              text,
              sourceLang,
              targetLang: target,
              context: session.context ?? "",
            },
          });
          if (result.error) {
            toast.error(`${getLanguage(target).name}: ${result.error}`);
            return;
          }
          if (result.translation) {
            await supabase
              .from("transcripts")
              .insert({
                session_id: session.id,
                lang: target,
                text: result.translation,
                is_source: false,
              });
          }
        })
      );
    } catch (e) {
      console.error(e);
      toast.error("Translation error. Please try again.");
    } finally {
      setSending(false);
    }
  }, [inputText, sending, session, sourceLang]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendChunk();
    }
  }

  const sourceL = getLanguage(sourceLang);

  return (
    <div className="space-y-6 mb-10">
      <div className="surface border border-border rounded-3xl p-6 shadow-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="size-2 rounded-full bg-rose-glow animate-pulse-dot" />
              <span className="text-xs uppercase tracking-widest text-rose-glow font-medium">Broadcasting</span>
            </div>
            <h1 className="font-display text-3xl">{session.church_name ?? "Live session"}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              From {sourceL.flag} {sourceL.name} · to {session.target_langs.length} {session.target_langs.length === 1 ? "language" : "languages"}
            </p>
          </div>
          <button
            onClick={onStop}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-destructive text-destructive-foreground font-medium hover:opacity-90 transition"
          >
            <StopCircle className="size-4" />
            Stop broadcast
          </button>
        </div>

        <div className="mt-6">
          <label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
            Speak (type to broadcast) — {sourceL.name}
          </label>
          <div className="relative">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              autoFocus
              placeholder={`Type what you're saying in ${sourceL.name}… (⌘/Ctrl+Enter to send)`}
              className="input-base resize-none pr-14"
            />
            <button
              onClick={sendChunk}
              disabled={!inputText.trim() || sending}
              className="absolute right-3 bottom-3 size-10 rounded-lg bg-primary text-primary-foreground grid place-items-center hover:opacity-90 transition disabled:opacity-40"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Live transcript ({sourceL.name})
          </h2>
          <div className="surface-elevated border border-border rounded-lg p-4 max-h-44 overflow-y-auto space-y-1.5 text-sm">
            {sourceFeed.length === 0 ? (
              <p className="text-muted-foreground italic">Nothing yet — type something above.</p>
            ) : (
              sourceFeed.slice(-20).map((l) => (
                <p key={l.id} className="leading-relaxed animate-fade-up">{l.text}</p>
              ))
            )}
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-display text-2xl mb-4">Translation rooms</h2>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {session.target_langs.map((lang) => (
            <LanguageRoomCard
              key={lang}
              sessionId={session.id}
              lang={lang}
              listenerCount={counts[lang] ?? 0}
              recentLines={(langFeeds[lang] ?? []).slice(-4)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
