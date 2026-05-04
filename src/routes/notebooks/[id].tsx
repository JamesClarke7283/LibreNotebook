// Notebook detail page. Three-pane layout: Sources | Chat | Studio.
// Per the user's request, the "Search the web for new sources" feature is
// omitted from the Sources panel.

import { define } from "../../utils.ts";
import { Header } from "../../components/Header.tsx";
import {
  getNotebook,
  getSettings,
  listMessages,
  listSources,
  listStudioItems,
  updateNotebook,
} from "../../lib/storage.ts";
import { isFullyConfigured } from "../../lib/settings-guard.ts";
import { SourcesPanel } from "../../islands/SourcesPanel.tsx";
import { ChatPanel } from "../../islands/ChatPanel.tsx";
import { StudioPanel } from "../../islands/StudioPanel.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const settings = await getSettings();
    if (!isFullyConfigured(settings)) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/onboarding" },
      });
    }
    const id = ctx.params.id;
    const nb = await getNotebook(id);
    if (!nb) return ctx.render(null, { status: 404 });
    const [sources, messages, studioItems] = await Promise.all([
      listSources(id),
      listMessages(id),
      listStudioItems(id),
    ]);

    // Auto-trigger summary generation the first time the user opens a
    // notebook that has at least one source ingested but no summary yet.
    const hasReadySource = sources.some((s) => s.status === "ready");
    const noSummary = !nb.summary && nb.summaryStatus !== "generating" &&
      nb.summaryStatus !== "failed";
    if (hasReadySource && noSummary) {
      // Mark as generating now (so the page render below shows the
      // skeleton immediately) and fire-and-forget the actual call.
      await updateNotebook(id, { summaryStatus: "generating" });
      queueMicrotask(() => {
        // Hit our own endpoint — it owns the generate-and-persist logic.
        fetch(
          `http://localhost:${Deno.env.get("PORT") ?? "5173"}/api/notebooks/${id}/summary`,
          { method: "POST" },
        ).catch(() => {});
      });
    }

    // Re-read so the rendered notebook reflects the just-updated status.
    const finalNb = await getNotebook(id) ?? nb;
    return { data: { notebook: finalNb, sources, messages, studioItems } };
  },
});

export default define.page<typeof handler>(function NotebookDetail({ data }) {
  if (!data) {
    return (
      <div class="min-h-screen flex items-center justify-center text-zinc-400">
        Notebook not found.
      </div>
    );
  }
  const { notebook, sources, messages, studioItems } = data;
  const created = new Date(notebook.createdAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div class="min-h-screen flex flex-col">
      <Header
        variant="notebook"
        title={notebook.title}
        notebookId={notebook.id}
      />

      <div class="flex-1 grid grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)_360px] gap-3 p-3">
        {/* Sources */}
        <SourcesPanel notebookId={notebook.id} initial={sources} />

        {/* Chat */}
        <ChatPanel
          notebookId={notebook.id}
          notebookTitle={notebook.title}
          notebookCreated={created}
          sourceCount={notebook.sourceCount}
          initialMessages={messages}
          initialSummary={notebook.summary ?? null}
          initialSuggestedQuestions={notebook.suggestedQuestions ?? []}
          initialSummaryStatus={notebook.summaryStatus ?? "idle"}
          initialSummaryError={notebook.summaryError ?? null}
        />

        {/* Studio */}
        <StudioPanel notebookId={notebook.id} initialItems={studioItems} />
      </div>

      <footer class="text-center text-xs text-zinc-500 py-2">
        LibreNotebook can be inaccurate; please double-check its responses.
      </footer>
    </div>
  );
});
