import { define } from "../utils.ts";
import { ReindexBanner } from "../islands/ReindexBanner.tsx";
import { Footer } from "../components/Footer.tsx";

const VALID_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"] as const;

/** Read the current LOG_LEVEL on the server, sanitised against the
 *  allowlist so the value going into the inline <script> can never be
 *  attacker-controlled. Defaults to INFO. */
function clientLogLevel(): string {
  const raw = (Deno.env.get("LOG_LEVEL") ?? "INFO").toUpperCase();
  return (VALID_LEVELS as readonly string[]).includes(raw) ? raw : "INFO";
}

export default define.page(function App({ Component }) {
  // Inline <script> runs at parse time, BEFORE any island hydrates.
  // That ordering matters: src/lib/client-logger.ts captures the
  // threshold at module-load time, and island modules import it
  // synchronously when they evaluate. JSON.stringify + an allowlist
  // sanitiser above makes the value safe to inline.
  const bootstrap = `window.__LIBRENOTEBOOK_LOG_LEVEL__=${
    JSON.stringify(clientLogLevel())
  };`;
  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png" />
        <title>LibreNotebook</title>
        {
          /*
           * dangerouslySetInnerHTML is required to inject the
           * LOG_LEVEL bootstrap before any island hydrates; the value
           * is sanitised against the allowlist in `clientLogLevel()`
           * above so it cannot be attacker-controlled.
           */
        }
        <script
          // deno-lint-ignore react-no-danger
          dangerouslySetInnerHTML={{ __html: bootstrap }}
        />
      </head>
      <body class="bg-zinc-950 text-zinc-100 min-h-screen antialiased flex flex-col">
        <ReindexBanner />
        <div class="flex-1">
          <Component />
        </div>
        <Footer />
      </body>
    </html>
  );
});
