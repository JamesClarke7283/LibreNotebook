import { define } from "../utils.ts";
import { ReindexBanner } from "../islands/ReindexBanner.tsx";

export default define.page(function App({ Component }) {
  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>LibreNotebook</title>
      </head>
      <body class="bg-zinc-950 text-zinc-100 min-h-screen antialiased">
        <ReindexBanner />
        <Component />
      </body>
    </html>
  );
});
