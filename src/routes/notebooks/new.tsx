// Convenience route: POST a new notebook server-side and redirect into it.
// Used by the "Create new" / "Create notebook" header buttons that don't
// have JavaScript handy.

import { define } from "../../utils.ts";
import { createNotebook, getSettings } from "../../lib/storage.ts";
import { isFullyConfigured } from "../../lib/settings-guard.ts";

export const handler = define.handlers({
  async GET() {
    const settings = await getSettings();
    if (!isFullyConfigured(settings)) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/onboarding" },
      });
    }
    const nb = await createNotebook();
    return new Response(null, {
      status: 302,
      headers: { Location: `/notebooks/${nb.id}` },
    });
  },
});
