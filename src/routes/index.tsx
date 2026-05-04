// First-run gate: bounce to /onboarding until both LLM and embedding
// providers are fully configured, otherwise to /notebooks.

import { define } from "../utils.ts";
import { getSettings } from "../lib/storage.ts";
import { isFullyConfigured } from "../lib/settings-guard.ts";

export const handler = define.handlers({
  async GET() {
    const s = await getSettings();
    const target = isFullyConfigured(s) ? "/notebooks" : "/onboarding";
    return new Response(null, {
      status: 302,
      headers: { Location: target },
    });
  },
});
