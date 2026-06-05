import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getLanguage } from "@/lib/languages";
import { Clock, Globe2 } from "lucide-react";

interface PastSession {
  id: string;
  church_name: string | null;
  source_lang: string;
  target_langs: string[];
  started_at: string;
  ended_at: string | null;
  status: string;
}

function formatDuration(start: string, end: string | null) {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const mins = Math.max(0, Math.round((endMs - startMs) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function PastSessions() {
  const { data, isLoading } = useQuery({
    queryKey: ["past-sessions"],
    queryFn: async (): Promise<PastSession[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("sessions")
        .select("id, church_name, source_lang, target_langs, started_at, ended_at, status")
        .eq("broadcaster_id", u.user.id)
        .order("started_at", { ascending: false })
        .limit(20);
      return (data ?? []) as PastSession[];
    },
  });

  return (
    <div className="surface border border-border rounded-3xl p-6 shadow-card">
      <h2 className="font-display text-2xl mb-4">Past broadcasts</h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No broadcasts yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {data.map((s) => {
            const src = getLanguage(s.source_lang);
            return (
              <div key={s.id} className="py-3 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {s.church_name ?? "Untitled session"}
                    {s.status === "live" && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-rose-glow/20 text-rose-glow">LIVE</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="flex items-center gap-1"><Clock className="size-3" /> {formatDate(s.started_at)}</span>
                    <span>· {formatDuration(s.started_at, s.ended_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Globe2 className="size-3.5 mr-1" />
                  <span>{src.flag}</span>
                  <span>→</span>
                  {s.target_langs.slice(0, 5).map((l) => (
                    <span key={l}>{getLanguage(l).flag}</span>
                  ))}
                  {s.target_langs.length > 5 && (
                    <span className="text-xs">+{s.target_langs.length - 5}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
