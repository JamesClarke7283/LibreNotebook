import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Pin the dev port so Neutralino's hardcoded devUrl can rely on it.
  // CORS is permissive in dev so Neutralino's WebKit2GTK webview origin
  // doesn't get blocked when fetching same-origin /api/* routes (some
  // webkit builds compute Vite's @id/* virtual URLs as a different
  // origin and refuse the fetch with "access control checks"). The
  // `headers` block belt-and-braces the `cors: true` shorthand so even
  // non-API routes (like the /@id/fresh-island::* virtual modules
  // themselves) ship the permissive CORS headers.
  server: {
    port: 5173,
    strictPort: true,
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    },
  },
  // Two-layer defence against @deno/loader@0.4.0's broken load() hook
  // (which appends Vite's `?v=<hash>` cache-bust query straight to the
  // file path passed to OS `open()` → ENOENT, even when the path is
  // resolved correctly to node_modules/<pkg>/...). v0.2.8's
  // dedupe-only revert was wrong: dedupe runs AFTER load, so it can't
  // help when load itself is throwing ENOENT.
  //
  //   1. resolve.alias (regex exact-match, array form): rewrites the
  //      bare specifier to an absolute file path before the plugin
  //      chain sees it. @deno/loader never gets a chance to mint a
  //      .deno/...?v= path. Array form + /^...$/ regex is required —
  //      object-form does PARTIAL matching, so a "preact" key would
  //      catch "preact/devtools" and produce <preact>.module.js/devtools.
  //
  //   2. resolve.dedupe: belt-and-suspenders. Even when a transitive
  //      import path the alias regex doesn't catch slips through and
  //      gets a second module instance via Vite's optimizer or
  //      another plugin, dedupe collapses them to one instance so
  //      signals/hooks/state share one store. Without this, two
  //      preacts on the page produce ghost-signal reads where
  //      `useSignal().value` writes in one component don't show up
  //      in another → "dead" UI (notebook tile clicks, 3-dot menus).
  //
  // The node:module shim is a separate concern (Node built-in stub
  // for cytoscape-fcose's ESM-detection trick).
  resolve: {
    alias: [
      {
        find: "node:module",
        replacement: new URL("./src/shims/node-module.ts", import.meta.url)
          .pathname,
      },
      // Preact: browser-conditional .module.js builds.
      {
        find: /^preact$/,
        replacement: new URL(
          "./node_modules/preact/dist/preact.module.js",
          import.meta.url,
        ).pathname,
      },
      {
        find: /^preact\/jsx-runtime$/,
        replacement: new URL(
          "./node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js",
          import.meta.url,
        ).pathname,
      },
      {
        find: /^preact\/hooks$/,
        replacement: new URL(
          "./node_modules/preact/hooks/dist/hooks.module.js",
          import.meta.url,
        ).pathname,
      },
      {
        find: /^preact\/debug$/,
        replacement: new URL(
          "./node_modules/preact/debug/dist/debug.module.js",
          import.meta.url,
        ).pathname,
      },
      {
        find: /^preact\/devtools$/,
        replacement: new URL(
          "./node_modules/preact/devtools/dist/devtools.module.js",
          import.meta.url,
        ).pathname,
      },
      // @preact/signals + signals-core: islands' useSignal() store.
      {
        find: /^@preact\/signals$/,
        replacement: new URL(
          "./node_modules/@preact/signals/dist/signals.module.js",
          import.meta.url,
        ).pathname,
      },
      {
        find: /^@preact\/signals-core$/,
        replacement: new URL(
          "./node_modules/@preact/signals-core/dist/signals-core.module.js",
          import.meta.url,
        ).pathname,
      },
      // Prefresh: HMR runtime; src/index.js (no dist build).
      {
        find: /^@prefresh\/core$/,
        replacement: new URL(
          "./node_modules/@prefresh/core/src/index.js",
          import.meta.url,
        ).pathname,
      },
      {
        find: /^@prefresh\/utils$/,
        replacement: new URL(
          "./node_modules/@prefresh/utils/src/index.js",
          import.meta.url,
        ).pathname,
      },
    ],
    // Single-instance enforcement for everything we aliased above.
    // Catches transitive paths the alias regex doesn't see.
    dedupe: [
      "preact",
      "preact/hooks",
      "preact/jsx-runtime",
      "preact/debug",
      "preact/devtools",
      "@preact/signals",
      "@preact/signals-core",
      "@prefresh/core",
      "@prefresh/utils",
    ],
  },
  optimizeDeps: {
    // Force Vite's dev-mode pre-bundler (esbuild) to handle these
    // packages directly so requests for them never fall through to
    // @deno/loader. The loader has two pathological behaviours we
    // route around here:
    //
    //   1. mermaid v11's main entry (dist/mermaid.core.mjs) fans out
    //      into ./chunks/* re-exports that the browser-side ESM
    //      linker chokes on with:
    //        "Importing binding name 'default' cannot be resolved by
    //         star export entries"
    //      Pre-bundling collapses those chunks into a single ESM
    //      with a proper default export.
    //
    //   2. For preact-family packages, @deno/loader resolves them to
    //      node_modules/.deno/<pkg>@<ver>/... but then hands the
    //      whole URL — including Vite's `?v=<hash>` cache-bust query
    //      — straight to the OS `open()` syscall, which returns
    //      ENOENT (the file exists but the query suffix doesn't).
    //      Pre-bundling means the request is served from
    //      node_modules/.vite/deps/ with Vite's own cache layer
    //      where ?v= queries are understood.
    //
    // After bumping this list, run `rm -rf node_modules/.vite` once
    // so the next dev start picks up the new pre-bundle entry.
    include: [
      "mermaid",
      "mermaid/dist/mermaid.esm.min.mjs",
      "preact",
      "preact/hooks",
      "preact/debug",
      "preact/devtools",
      "preact/jsx-runtime",
      "@preact/signals",
      "@preact/signals-core",
      "@prefresh/core",
      "@prefresh/utils",
    ],
  },
  ssr: {
    // langchain ships dual ESM/CJS builds. Vite's SSR module-runner picks
    // the CJS twin and trips over `module is not defined`. Force the SSR
    // pipeline to leave these packages alone so Node's standard
    // exports.import resolution applies.
    external: [
      "langchain",
      "@langchain/core",
      "@langchain/openai",
      "@langchain/ollama",
      "@langchain/classic",
      "@langchain/textsplitters",
      "pdfjs-dist",
      "pngjs",
      // Mermaid is browser-only; keep Vite's SSR pipeline from trying to
      // bundle d3/dagre transitively.
      "mermaid",
      // Readability + DOM parser used server-side for webpage ingest.
      "@mozilla/readability",
      "linkedom",
      // Auth machinery — dynamic imports through Vite's SSR module
      // runner race with HMR teardown. Externalising lets Node's
      // resolver handle them.
      "better-auth",
      "better-sqlite3",
      "nodemailer",
    ],
  },
  plugins: [
    fresh({
      serverEntry: "./src/main.ts",
      clientEntry: "./src/client.ts",
      islandsDir: "./src/islands",
      routeDir: "./src/routes",
      // staticDir defaults to ["static"] — root-level, leave as-is.
    }),
    tailwindcss(),
  ],
});
