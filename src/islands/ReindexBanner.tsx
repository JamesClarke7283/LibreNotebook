// Global re-embedding banner. Polls /api/embeddings/reindex (GET) every
// couple of seconds and renders an aggregate progress bar while any
// source is in the "pending" state. Disappears when nothing is queued.
//
// Mounted on every page so the user sees re-embedding progress no matter
// where they navigate after kicking it off from settings.
//
// The poll is *defensive*: when a request fails (e.g. the server is
// briefly unavailable, or the WebKit webview hits a transient access
// control message), we back off to 30 s instead of pummelling the API
// every 2 s and spamming the JS console.

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";

interface Status {
  active: boolean;
  current: number;
  total: number;
  pendingCount: number;
}

const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 30_000;

export function ReindexBanner() {
  const status = useSignal<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      let nextDelay = FAST_POLL_MS;
      try {
        const res = await fetch("/api/embeddings/reindex");
        if (cancelled) return;
        if (res.ok) {
          status.value = await res.json();
        } else {
          // Server reached but unhappy — back off so we don't hammer.
          nextDelay = SLOW_POLL_MS;
        }
      } catch {
        // Network / CORS / fetch refused. Slow down silently.
        nextDelay = SLOW_POLL_MS;
      }
      if (cancelled) return;
      // Once the queue is idle, also slow down — no point checking
      // every 2s when nothing's happening.
      if (status.value && !status.value.active) nextDelay = SLOW_POLL_MS;
      timer = setTimeout(tick, nextDelay) as unknown as number;
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
