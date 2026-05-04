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
  resolve: {
    alias: {
      "node:module": new URL("./src/shims/node-module.ts", import.meta.url)
        .pathname,
    },
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
