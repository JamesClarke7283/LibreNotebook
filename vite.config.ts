import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Pin the dev port so Neutralino's hardcoded devUrl can rely on it.
  server: { port: 5173, strictPort: true },
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
