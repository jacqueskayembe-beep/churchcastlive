import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { Radio, LogOut, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SessionSetup } from "@/components/dashboard/SessionSetup";
import { LiveBroadcast } from "@/components/dashboard/LiveBroadcast";
import { PastSessions } from "@/components/dashboard/PastSessions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — ChurchCast" },
      { name: "description", content: "Manage your ChurchCast live broadcasts, monitor active translation rooms, and review past session transcripts." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

interface ActiveSession {
  id: string;
  church_name: string | null;
  source_lang: string;
  target_langs: string[];
  context: string | null;
}

function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [profile, setProfile] = useState<{ email: string | null; display_name: string | null; avatar_url: string | null } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("email, display_name, avatar_url")
        .eq("id", data.user.id)
        .maybeSingle();
      setProfile(p ?? { email: data.user.email ?? null, display_name: null, avatar_url: null });
    });
  }, []);

  // Look for an existing live session for this broadcaster on mount
  useQuery({
    queryKey: ["active-session"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("sessions")
        .select("id, church_name, source_lang, target_langs, context")
        .eq("broadcaster_id", u.user.id)
        .eq("status", "live")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setActive(data as ActiveSession);
      return data;
    },
  });

  const handleSignOut = useCallback(async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }, [navigate, queryClient]);

  const handleStart = useCallback((session: ActiveSession) => {
    setActive(session);
    queryClient.invalidateQueries({ queryKey: ["past-sessions"] });
  }, [queryClient]);

  const handleStop = useCallback(async () => {
    if (!active) return;
    const { error } = await supabase
      .from("sessions")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", active.id);
    if (error) {
      toast.error("Failed to end broadcast.");
      return;
    }
    toast.success("Broadcast ended.");
    setActive(null);
    queryClient.invalidateQueries({ queryKey: ["past-sessions"] });
  }, [active, queryClient]);

  if (!profile) {
    return (
      <div className="min-h-screen grid place-items-center bg-hero">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-hero">
      <header className="px-6 lg:px-10 py-5 flex items-center justify-between border-b border-border surface/50 backdrop-blur sticky top-0 z-30">
        <Link to="/" className="flex items-center gap-2">
          <div className="size-8 rounded-md bg-amber-gradient grid place-items-center shadow-glow">
            <Radio className="size-4 text-primary-foreground" />
          </div>
          <span className="font-display text-xl">ChurchCast</span>
        </Link>
        <div className="flex items-center gap-3">
          {profile.avatar_url && (
            <img src={profile.avatar_url} alt="" className="size-8 rounded-full border border-border" />
          )}
          <div className="hidden sm:block text-right">
            <div className="text-sm font-medium leading-tight">{profile.display_name ?? "Broadcaster"}</div>
            <div className="text-xs text-muted-foreground leading-tight">{profile.email}</div>
          </div>
          <button
            onClick={handleSignOut}
            className="p-2 rounded-md hover:bg-secondary transition"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <main className="px-4 lg:px-10 py-8 max-w-7xl mx-auto">
        {!active ? (
          <SessionSetup onStart={handleStart} />
        ) : (
          <LiveBroadcast session={active} onStop={handleStop} />
        )}
        <PastSessions />
      </main>
    </div>
  );
}
