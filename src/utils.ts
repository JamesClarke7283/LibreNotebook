import { createDefine } from "fresh";

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
  /** Reserved for future per-request state (e.g. user info, request id). */
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export const define = createDefine<State>();
