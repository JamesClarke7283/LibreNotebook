import { define } from "../utils.ts";
import { ReindexBanner } from "../islands/ReindexBanner.tsx";
import { Footer } from "../components/Footer.tsx";

export default define.page(function App({ Component }) {
  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png" />
        <title>LibreNotebook</title>
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
