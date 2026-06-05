import { createFileRoute, Link } from "@tanstack/react-router";
import { Radio, Globe2, Smartphone, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ChurchCast — Live Sermon Translation in 20+ Languages" },
      { name: "description", content: "ChurchCast streams your sermon in real time to every listener's phone — translated into their language, with no app and no login required." },
      { property: "og:title", content: "ChurchCast — Live Sermon Translation in 20+ Languages" },
      { property: "og:description", content: "Real-time AI translation for church services. Share a QR code; every listener hears the sermon in their language." },
      { property: "og:url", content: "https://dlt-translation-cast.lovable.app/" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "canonical", href: "https://dlt-translation-cast.lovable.app/" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "ChurchCast",
          url: "https://dlt-translation-cast.lovable.app/",
          description: "Real-time, AI-powered multilingual translation for church services.",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "ChurchCast",
          url: "https://dlt-translation-cast.lovable.app/",
          description: "AI-powered live interpretation service that streams translated sermons to every listener's phone.",
        }),
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-hero">
      <header className="px-6 lg:px-12 py-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="size-9 rounded-md bg-amber-gradient grid place-items-center shadow-glow">
            <Radio className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display text-2xl">ChurchCast</span>
        </Link>
        <Link
          to="/auth"
          className="text-sm font-medium hover:text-primary transition"
        >
          Sign in
        </Link>
      </header>

      <main>
        {/* Hero */}
        <section className="px-6 lg:px-12 pt-16 pb-24 max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full surface-elevated border border-border text-xs text-muted-foreground mb-8">
            <Sparkles className="size-3.5 text-primary" />
            AI-powered live interpretation
          </div>
          <h1 className="font-display text-5xl md:text-7xl leading-[1.05] tracking-tight">
            Every word of your service,<br/>
            <span className="text-primary">in every language.</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            ChurchCast translates your sermon in real time and streams it to every listener's phone.
            No apps to install. No logins for your congregation. Just a QR code on the screen.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition shadow-glow"
            >
              <Radio className="size-4" />
              Start broadcasting
            </Link>
            <a
              href="#how-it-works"
              className="px-6 py-3 rounded-lg border border-border hover:bg-secondary transition font-medium"
            >
              See how it works
            </a>
          </div>
        </section>

        {/* Features */}
        <section id="how-it-works" className="px-6 lg:px-12 py-20 max-w-6xl mx-auto">
          <h2 className="font-display text-4xl text-center mb-16">A reverent technology, simply done</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Radio,
                title: "Speak naturally",
                body: "Use any microphone or audio input. Provide context about your sermon for accuracy — biblical references, names, themes.",
              },
              {
                icon: Globe2,
                title: "Translate everywhere",
                body: "Pick any number of target languages. Each one gets its own booth with a unique link and QR code, ready to share.",
              },
              {
                icon: Smartphone,
                title: "Listeners just tap",
                body: "Congregants scan a QR code, tap to listen, and hear translation streamed live. No accounts, no friction.",
              },
            ].map((f) => (
              <div key={f.title} className="surface rounded-2xl border border-border p-7 shadow-card">
                <div className="size-11 rounded-lg bg-stained grid place-items-center mb-5">
                  <f.icon className="size-5 text-white" />
                </div>
                <h3 className="font-display text-2xl mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="px-6 lg:px-12 py-20 max-w-4xl mx-auto text-center">
          <div className="surface-elevated border border-border rounded-3xl p-12 shadow-soft">
            <h2 className="font-display text-4xl mb-3">Open your doors to the world</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              Sign in with your church's Google account and start your first broadcast in under a minute.
            </p>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition shadow-glow"
            >
              Sign in with Google
            </Link>
          </div>
        </section>
      </main>

      <footer className="px-6 lg:px-12 py-10 border-t border-border text-center text-xs text-muted-foreground">
        ChurchCast · Built with reverence
      </footer>
    </div>
  );
}
