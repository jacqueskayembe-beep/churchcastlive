import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — ChurchCast" },
      { name: "description", content: "Sign in to ChurchCast to broadcast translated services." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function signInGoogle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/dashboard",
      });
      if (result.error) {
        toast.error("Sign in failed. Please try again.");
        setLoading(false);
        return;
      }
      if (result.redirected) return;
      navigate({ to: "/dashboard", replace: true });
    } catch (e) {
      console.error(e);
      toast.error("Sign in failed.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-hero grid place-items-center px-4">
      <div className="w-full max-w-md surface-elevated border border-border rounded-3xl p-10 shadow-soft text-center">
        <Link to="/" className="inline-flex items-center gap-2 mb-8">
          <div className="size-9 rounded-md bg-amber-gradient grid place-items-center shadow-glow">
            <Radio className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display text-2xl">ChurchCast</span>
        </Link>
        <h1 className="font-display text-3xl mb-2">Welcome</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Sign in to broadcast your service in any language.
        </p>
        <button
          onClick={signInGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-5 py-3 rounded-lg bg-white text-gray-900 font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          <svg className="size-5" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/><path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.6 5A20 20 0 0 0 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 36.8 44 31 44 24c0-1.2-.1-2.4-.4-3.5z"/></svg>
          {loading ? "Signing in..." : "Continue with Google"}
        </button>
        <p className="mt-6 text-xs text-muted-foreground">
          Listeners don't need an account — just share a room link.
        </p>
      </div>
    </div>
  );
}
