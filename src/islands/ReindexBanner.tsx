// Global re-embedding banner. Polls /api/embeddings/reindex (GET) every
// couple of seconds and renders an aggregate progress bar while any
// source is in the "pending" state. Disappears when nothing is queued.
//
// Mounted on every page so the user sees re-embedding progress no matter
// where they navigate after kicking it off from settings.

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";

interface Status {
  active: boolean;
  current: number;
  total: number;
  pendingCount: number;
}

export function ReindexBanner() {
  const status = useSignal<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function tick() {
      try {
        const res = await fetch("/api/embeddings/reindex");
        if (res.ok && !cancelled) {
          status.value = await res.json();
        }
      } catch {
        // ignore
      }
      if (!cancelled) {
        timer = setTimeout(tick, 2_000) as unknown as number;
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  const s = status.value;
  if (!s || !s.active) return null;
  const pct = s.total > 0
    ? Math.min(100, Math.round((s.current / s.total) * 100))
    : 0;
  return (
    <div class="px-4 py-2 bg-emerald-950/40 border-b border-emerald-900/60 text-emerald-200 text-xs flex items-center gap-3">
      <span>
        Re-embedding sources… {s.pendingCount}{" "}
        pending ({pct}%)
      </span>
      <div class="flex-1 h-1 rounded-full bg-emerald-950 overflow-hidden">
        <div
          class="h-1 bg-emerald-400 transition-all"
          style={`width: ${pct}%`}
        />
      </div>
    </div>
  );
}
