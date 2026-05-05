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
  // Stub Node built-ins for the client bundle. Mermaid's transitive
  // `cytoscape-fcose` imports `node:module` for an ESM-detection trick
  // we don't need. Pointing the import at a tiny empty shim lets the
  // bundler succeed without affecting runtime behaviour.
  //
  // The preact/* and @prefresh/* aliases are NOT cosmetic — they
  // route those imports to absolute paths in node_modules/<pkg>/
  // BEFORE the plugin chain sees the bare specifier, so
  // `@deno/loader@0.4.0` (the Vite plugin from @fresh/plugin-vite)
  // never gets to resolve them to its `node_modules/.deno/<pkg>@<ver>/...`
  // hierarchy. That hierarchy's load step appends Vite's `?v=<hash>`
  // cache-bust query directly to the file path passed to `open()`,
  // which the OS rejects with ENOENT (the file exists, the suffix
  // doesn't). optimizeDeps.include alone wasn't enough to win
  // against @deno/loader — these aliases force the issue.
  resolve: {
    alias: {
      "node:module": new URL("./src/shims/node-module.ts", import.meta.url)
        .pathname,
      // Preact: browser-conditional .module.js builds (the same files
      // Vite would resolve via the package's "browser" exports).
      "preact/jsx-runtime": new URL(
        "./node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js",
        import.meta.url,
      ).pathname,
      "preact/hooks": new URL(
        "./node_modules/preact/hooks/dist/hooks.module.js",
        import.meta.url,
      ).pathname,
      "preact/debug": new URL(
        "./node_modules/preact/debug/dist/debug.module.js",
        import.meta.url,
      ).pathname,
      "preact": new URL(
        "./node_modules/preact/dist/preact.module.js",
        import.meta.url,
      ).pathname,
      // Prefresh: source ESM files (no dist build for @prefresh/core).
      "@prefresh/core": new URL(
        "./node_modules/@prefresh/core/src/index.js",
        import.meta.url,
      ).pathname,
      "@prefresh/utils": new URL(
        "./node_modules/@prefresh/utils/src/index.js",
        import.meta.url,
      ).pathname,
    },
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
      "preact/jsx-runtime",
      "@preact/signals",
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
