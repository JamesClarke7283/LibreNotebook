// Single source of truth for the app's version string. Read at server
// start from `neutralino.config.json` so we don't have to keep two
// fields in sync.

let cached: string | null = null;

export function getVersion(): string {
  if (cached) return cached;
  try {
    const txt = Deno.readTextFileSync("./neutralino.config.json");
    const m = txt.match(/"version"\s*:\s*"([^"]+)"/);
    cached = m?.[1] ?? "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}
