// /settings re-uses the onboarding form to edit existing settings.

import { define } from "../utils.ts";

export const handler = define.handlers({
  GET() {
    return new Response(null, {
      status: 302,
      headers: { Location: "/onboarding" },
    });
  },
});
