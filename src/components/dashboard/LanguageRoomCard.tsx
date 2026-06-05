import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Users, ExternalLink, Check } from "lucide-react";
import { getLanguage } from "@/lib/languages";
import { toast } from "sonner";

interface Props {
  sessionId: string;
  lang: string;
  listenerCount: number;
  recentLines: { id: string; text: string }[];
}

export function LanguageRoomCard({ sessionId, lang, listenerCount, recentLines }: Props) {
  const language = getLanguage(lang);
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined"
    ? `${window.location.origin}/room/${sessionId}/${lang}`
    : "";

  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, {
      margin: 1,
      width: 240,
      color: { dark: "#0f1428", light: "#f5e8c7" },
    }).then(setQr).catch(() => {});
  }, [url]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="surface border border-border rounded-2xl p-5 shadow-card flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-2xl">{language.flag}</div>
          <h3 className="font-display text-2xl mt-1">{language.nativeName}</h3>
          <p className="text-xs text-muted-foreground">{language.name} booth</p>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md surface-elevated border border-border text-xs">
          <Users className="size-3" />
          <span>{listenerCount}</span>
        </div>
      </div>

      <div className="flex gap-4 mb-4">
        {qr && (
          <div className="size-24 shrink-0 rounded-lg overflow-hidden bg-[#f5e8c7] p-1">
            <img src={qr} alt="QR code" className="w-full h-full" />
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Share link</div>
          <div className="text-xs font-mono text-foreground/80 truncate">{url.replace(/^https?:\/\//, "")}</div>
          <div className="flex gap-1.5">
            <button
              onClick={copyUrl}
              className="flex-1 px-2 py-1.5 text-xs rounded-md border border-border hover:bg-secondary transition flex items-center justify-center gap-1.5"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1.5 text-xs rounded-md border border-border hover:bg-secondary transition flex items-center gap-1"
            >
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-3 mt-auto">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Recent translation</div>
        <div className="space-y-1.5 min-h-[3rem]">
          {recentLines.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Awaiting translation…</p>
          ) : (
            recentLines.map((l) => (
              <p key={l.id} className="text-sm leading-snug animate-fade-up font-display">{l.text}</p>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
