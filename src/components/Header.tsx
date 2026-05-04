// Top app bar. Variants:
//   - "dashboard" — used on /notebooks (logo + Settings).
//   - "notebook"  — used on /notebooks/:id (title + Create + Share + Settings).

import { Logo } from "./Logo.tsx";
import { PlusIcon, SettingsIcon, ShareIcon } from "./Icons.tsx";
import { NotebookTitleEdit } from "../islands/NotebookTitleEdit.tsx";

interface DashboardHeaderProps {
  variant?: "dashboard";
}
interface NotebookHeaderProps {
  variant: "notebook";
  title: string;
  /** When provided, the title becomes inline-editable. */
  notebookId?: string;
}

type Props = DashboardHeaderProps | NotebookHeaderProps;

export function Header(props: Props) {
  return (
    <header class="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
      <div class="flex items-center gap-3 text-zinc-100">
        {props.variant === "notebook"
          ? (
            <>
              <a href="/notebooks" class="text-zinc-300 hover:text-white">
                <Logo size={26} />
              </a>
              {props.notebookId
                ? (
                  <NotebookTitleEdit
                    notebookId={props.notebookId}
                    initial={props.title}
                  />
                )
                : (
                  <h1 class="text-lg font-medium truncate max-w-[40ch]">
                    {props.title}
                  </h1>
                )}
            </>
          )
          : (
            <>
              <Logo size={26} />
              <span class="text-lg font-medium tracking-tight">
                LibreNotebook
              </span>
            </>
          )}
      </div>
      <div class="flex items-center gap-3 text-zinc-300">
        {props.variant === "notebook" && (
          <>
            <a
              href="/notebooks"
              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-700 hover:bg-zinc-800 text-sm"
            >
              <PlusIcon size={16} />
              <span>Create notebook</span>
            </a>
            <button
              type="button"
              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-700 hover:bg-zinc-800 text-sm"
            >
              <ShareIcon size={16} />
              <span>Share</span>
            </button>
          </>
        )}
        <a
          href="/settings"
          class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-700 hover:bg-zinc-800 text-sm"
        >
          <SettingsIcon size={16} />
          <span>Settings</span>
        </a>
      </div>
    </header>
  );
}
