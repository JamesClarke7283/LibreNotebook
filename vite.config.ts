// Canonical Fresh 2.x + Vite + Tailwind v4 setup. Per the Fresh
// docs (https://fresh.deno.dev/docs/advanced/vite), this is all
// you need — the `fresh()` plugin handles JSX, HMR, island
// discovery, client/server code-splitting, and preact aliasing
// itself. No manual `resolve.alias`, `resolve.dedupe`, or
// `optimizeDeps.include` for preact-family packages — those used
// to be needed because of `nodeModulesDir: "manual"` quirks, but
// with `nodeModulesDir: "auto"` Deno provisions a flat node_modules
// for Vite without any of the dual-entry-point pitfalls that broke
// island hydration.

import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Pin the dev port so Neutralino's hardcoded devUrl can rely on
  // it. Permissive CORS keeps Neutralino's WebKit2GTK webview origin
  // from getting blocked when fetching same-origin /api/* routes.
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
  ssr: {
    // These packages ship dual ESM/CJS builds where Vite's SSR
    // module-runner picks the CJS twin and trips over `module is
    // not defined`, OR are browser-only and shouldn't be bundled
    // server-side at all. Externalising lets Node's standard
    // exports.import resolution apply.
    external: [
      "langchain",
      "@langchain/core",
      "@langchain/openai",
      "@langchain/ollama",
      "@langchain/classic",
      "@langchain/textsplitters",
      "pdfjs-dist",
      "pngjs",
      // Mermaid is browser-only.
      "mermaid",
      // Readability + DOM parser used server-side for webpage ingest.
      "@mozilla/readability",
      "linkedom",
      // Auth machinery — dynamic imports race with HMR teardown.
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
    }),
    tailwindcss(),
  ],
});
