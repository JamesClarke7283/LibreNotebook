// Right pane: Studio. Renders the same tile grid as NotebookLM. The tiles
// are visual placeholders for now (the user's primary ask was the chat
// flow); each one will eventually trigger its corresponding generation.

import { useSignal } from "@preact/signals";
import {
  AudioIcon,
  FlashcardsIcon,
  InfographicIcon,
  MindMapIcon,
  NoteIcon,
  QuizIcon,
  ReportIcon,
  SidebarIcon,
  SlideIcon,
  SparklesIcon,
  TableIcon,
  VideoIcon,
} from "../components/Icons.tsx";

type IconCmp = (p: { size?: number; class?: string }) => preact.JSX.Element;

interface Props {
  notebookId: string;
}

const TILES: { label: string; Icon: IconCmp; key: string }[] = [
  { label: "Audio…", Icon: AudioIcon, key: "audio" },
  { label: "Slide deck", Icon: SlideIcon, key: "slides" },
  { label: "Video Overview", Icon: VideoIcon, key: "video" },
  { label: "Mind Map", Icon: MindMapIcon, key: "mindmap" },
  { label: "Reports", Icon: ReportIcon, key: "reports" },
  { label: "Flashcards", Icon: FlashcardsIcon, key: "flashcards" },
  { label: "Quiz", Icon: QuizIcon, key: "quiz" },
  { label: "Infographic", Icon: InfographicIcon, key: "infographic" },
  { label: "Data table", Icon: TableIcon, key: "datatable" },
];

export function StudioPanel({ notebookId: _notebookId }: Props) {
  const note = useSignal("");
  const editing = useSignal(false);

  return (
    <section class="rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col min-h-[70vh]">
      <header class="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <h2 class="text-zinc-100 font-medium">Studio</h2>
        <button class="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" aria-label="Toggle sidebar">
          <SidebarIcon size={16} />
        </button>
      </header>

      <div class="p-4 grid grid-cols-3 gap-2">
        {TILES.map(({ label, Icon, key }) => (
          <button
            key={key}
            type="button"
            class="flex flex-col items-start gap-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800 p-3 text-left text-zinc-200"
          >
            <Icon size={16} class="text-zinc-300" />
            <span class="text-[11px] leading-tight">{label}</span>
          </button>
        ))}
      </div>

      <div class="flex-1 px-4 pb-4 flex flex-col items-center justify-center text-center text-zinc-400">
        {editing.value
          ? (
            <>
              <textarea
                value={note.value}
                onInput={(e) =>
                  (note.value = (e.currentTarget as HTMLTextAreaElement).value)}
                rows={6}
                placeholder="Note…"
                class="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
              />
              <button
                type="button"
                onClick={() => (editing.value = false)}
                class="mt-3 text-xs text-zinc-300 hover:text-white"
              >
                Save note
              </button>
            </>
          )
          : (
            <>
              <SparklesIcon size={22} class="text-zinc-500 mb-2" />
              <p class="text-sm font-medium text-zinc-300">
                Studio output will be saved here.
              </p>
              <p class="text-xs mt-2 max-w-xs">
                After adding sources, click to add Audio Overview, study guide,
                mind map and more!
              </p>
            </>
          )}
      </div>

      <div class="p-3 border-t border-zinc-800/60">
        <button
          type="button"
          onClick={() => (editing.value = !editing.value)}
          class="w-full inline-flex items-center justify-center gap-2 rounded-full bg-zinc-100 text-zinc-900 hover:bg-white py-1.5 text-sm"
        >
          <NoteIcon size={14} />
          <span>{editing.value ? "Cancel" : "Add note"}</span>
        </button>
      </div>
    </section>
  );
}
