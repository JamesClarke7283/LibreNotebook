// Global footer. Mounted in `_app.tsx` so every page picks it up.
// Shows the running app version and links to the licence file on
// GitHub (the user maintains LICENSE.md upstream).

import { getVersion } from "../lib/version.ts";

const LICENSE_URL =
  "https://github.com/impulse/LibreNotebook/blob/main/LICENSE.md";

export function Footer() {
  const version = getVersion();
  return (
    <footer class="text-center text-[11px] text-zinc-500 py-3">
      LibreNotebook v{version} ·{" "}
      <a
        href={LICENSE_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="hover:text-zinc-300 underline-offset-2 hover:underline"
      >
        AGPL-v3-or-later
      </a>
    </footer>
  );
}
