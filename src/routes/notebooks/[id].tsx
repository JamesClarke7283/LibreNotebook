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
    const [sources, messages] = await Promise.all([
      listSources(id),
      listMessages(id),
    ]);
    return { data: { notebook: nb, sources, messages } };
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
  const { notebook, sources, messages } = data;
  const created = new Date(notebook.createdAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div class="min-h-screen flex flex-col">
      <Header variant="notebook" title={notebook.title} />

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
        />

        {/* Studio */}
        <StudioPanel notebookId={notebook.id} />
      </div>

      <footer class="text-center text-xs text-zinc-500 py-2">
        LibreNotebook can be inaccurate; please double-check its responses.
      </footer>
    </div>
  );
});
