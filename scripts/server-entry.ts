// Compile entry for deno-compile. Imports the Vite-built Fresh fetch
// handler from _fresh/server.js and calls Deno.serve with it. We need
// this wrapper because `deno compile` of a `export default { fetch }`
// module just prints "did you mean deno serve?" and exits — it doesn't
// implicitly serve.

// deno-lint-ignore no-explicit-any
const mod: any = await import("../_fresh/server.js");
const handler = mod.default ?? mod;

const port = parseInt(Deno.env.get("PORT") ?? "5173", 10);
const hostname = Deno.env.get("HOST") ?? "127.0.0.1";

Deno.serve({ port, hostname }, handler.fetch ?? handler);
