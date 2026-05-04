// "My notebooks" dashboard. The user requested the trimmed-down NotebookLM
// layout: only the My notebooks section (no Featured / Shared with me).

import { define } from "../../utils.ts";
import { Header } from "../../components/Header.tsx";
import {
  CheckIcon,
  ChevronDownIcon,
  GridIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
} from "../../components/Icons.tsx";
import { listNotebooks } from "../../lib/storage.ts";
import { getSettings } from "../../lib/storage.ts";
import { NotebookGrid } from "../../islands/NotebookGrid.tsx";

export const handler = define.handlers({
  async GET() {
    const settings = await getSettings();
    if (!settings) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/onboarding" },
      });
    }
    const notebooks = await listNotebooks();
    return { data: { notebooks } };
  },
});

export default define.page<typeof handler>(function Notebooks({ data }) {
  return (
    <div class="min-h-screen flex flex-col">
      <Header variant="dashboard" />

      <div class="flex-1 px-8 py-6 max-w-[1600px] mx-auto w-full">
        {/* Tab + control row */}
        <div class="flex items-center justify-between flex-wrap gap-4 mb-8">
          <nav class="flex items-center gap-1 text-sm">
            <Tab label="All" />
            <Tab label="My notebooks" active />
          </nav>

          <div class="flex items-center gap-3">
            <button
              type="button"
              class="p-2 rounded-full hover:bg-zinc-800 text-zinc-300"
              aria-label="Search notebooks"
            >
              <SearchIcon size={18} />
            </button>
            <div class="inline-flex rounded-full bg-zinc-900 border border-zinc-800 p-1">
              <ViewToggle icon={<CheckIcon size={16} />} active={false} />
              <ViewToggle icon={<GridIcon size={16} />} active={true} />
              <ViewToggle icon={<ListIcon size={16} />} active={false} />
            </div>
            <button
              type="button"
              class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-zinc-800 text-zinc-200 text-sm hover:bg-zinc-800"
            >
              <span>Most recent</span>
              <ChevronDownIcon size={14} />
            </button>
            <a
              href="/notebooks/new"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-zinc-700 text-zinc-100 hover:bg-zinc-800 text-sm"
            >
              <PlusIcon size={16} />
              <span>Create new</span>
            </a>
          </div>
        </div>

        <h2 class="text-2xl font-semibold text-zinc-100 mb-4">My notebooks</h2>
        <NotebookGrid initial={data.notebooks} />
      </div>
    </div>
  );
});

function Tab({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      class={`px-4 py-1.5 rounded-full text-sm transition ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}

function ViewToggle(
  { icon, active }: { icon: preact.ComponentChild; active: boolean },
) {
  return (
    <button
      type="button"
      class={`px-2.5 py-1 rounded-full ${
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400"
      }`}
    >
      {icon}
    </button>
  );
}
