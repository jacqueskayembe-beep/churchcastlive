import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const MicCapture = lazy(() =>
  import("./MicCapture").then((m) => ({ default: m.MicCapture })),
);

export function MicCaptureClient({ sessionId }: { sessionId: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return (
      <div className="surface-elevated border border-border rounded-2xl p-6 flex items-center gap-3 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">Loading microphone…</span>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="surface-elevated border border-border rounded-2xl p-6 flex items-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Loading microphone…</span>
        </div>
      }
    >
      <MicCapture sessionId={sessionId} />
    </Suspense>
  );
}
