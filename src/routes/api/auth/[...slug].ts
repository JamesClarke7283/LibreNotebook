// Mount Better Auth's handler on /api/auth/*. The handler answers all
// of /api/auth/sign-in/email, /api/auth/sign-up/email, /api/auth/session,
// /api/auth/forget-password, and the rest. Returns 404 when multi-user
// mode is off.

import { define } from "../../../utils.ts";
import { getAuth } from "../../../lib/auth.ts";

async function dispatch(req: Request): Promise<Response> {
  const auth = await getAuth();
  if (!auth) {
    return new Response("Multi-user mode is disabled.", { status: 404 });
  }
  return auth.handler(req);
}

export const handler = define.handlers({
  GET(ctx) {
    return dispatch(ctx.req);
  },
  POST(ctx) {
    return dispatch(ctx.req);
  },
  PUT(ctx) {
    return dispatch(ctx.req);
  },
  DELETE(ctx) {
    return dispatch(ctx.req);
  },
  PATCH(ctx) {
    return dispatch(ctx.req);
  },
});
