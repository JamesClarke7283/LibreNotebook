// YouTube transcript ingest. We shell out to yt-dlp (the user's
// preferred path per the spec) and parse the resulting WebVTT into
// plain text. yt-dlp is preferred over a pure-JS approach because
// YouTube routinely changes their watch-page internals; yt-dlp tracks
// the upstream changes for us.
//
// Requires `yt-dlp` on PATH. Install with `pip install yt-dlp`,
// `brew install yt-dlp`, `apt install yt-dlp`, or similar. The error
// thrown when the binary is missing tells the user exactly that.

import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { getLogger } from "./logger.ts";

const log = getLogger("youtube");

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "music.youtube.com",
]);

/**
 * Resolve the yt-dlp binary. We try (in order):
 *   1. $YT_DLP_PATH (explicit override)
 *   2. plain "yt-dlp" (whatever's on PATH at server-start time)
 *   3. ~/.local/bin/yt-dlp     (pip install --user)
 *   4. ~/bin/yt-dlp            (manual install)
 *   5. /usr/local/bin/yt-dlp   (homebrew, manual)
 * The first hit wins. Cached after first resolution.
 */
let cachedYtDlpPath: string | null | undefined;
async function resolveYtDlp(): Promise<string | null> {
  if (cachedYtDlpPath !== undefined) return cachedYtDlpPath;
  const candidates = [
    Deno.env.get("YT_DLP_PATH") || "",
    "yt-dlp",
    join(homedir(), ".local/bin/yt-dlp"),
    join(homedir(), "bin/yt-dlp"),
    "/usr/local/bin/yt-dlp",
  ].filter((p) => p.length > 0);
  for (const p of candidates) {
    if (p === "yt-dlp") {
      // PATH lookup — try a probe with --version.
      try {
        const probe = new Deno.Command("yt-dlp", {
          args: ["--version"],
          stdout: "null",
          stderr: "null",
        });
        const res = await probe.output();
        if (res.success) {
          cachedYtDlpPath = "yt-dlp";
          return cachedYtDlpPath;
        }
      } catch {
        // fall through to absolute-path candidates
      }
      continue;
    }
    try {
      const s = await stat(p);
      if (s.isFile()) {
        cachedYtDlpPath = p;
        return cachedYtDlpPath;
      }
    } catch {
      // not present, try next
    }
  }
  cachedYtDlpPath = null;
  return null;
}

export function isYouTubeUrl(url: string): boolean {
  try {
    return YT_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export interface YouTubeTranscript {
  /** Cleaned title for the source name. */
  title: string;
  /** Full plain-text transcript. */
  content: string;
  /** Resolved YouTube video id. */
  videoId: string;
  /** ISO duration string from yt-dlp metadata, e.g. "12:34". */
  duration?: string;
  /** Channel name. */
  channel?: string;
}

/**
 * Run yt-dlp and return its stdout as a string. Throws a friendly
 * NotInstalled error when no binary can be located.
 */
async function ytDlp(args: string[]): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
}> {
  const bin = await resolveYtDlp();
  if (!bin) {
    throw new Error(
      "yt-dlp is not installed or not on PATH. " +
        "Install with `pip install yt-dlp`, `apt install yt-dlp`, or " +
        "`brew install yt-dlp`. Alternatively, set $YT_DLP_PATH to the " +
        "absolute path of an installed binary.",
    );
  }
  log.debug("yt-dlp", { bin, args });
  try {
    const res = await new Deno.Command(bin, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const out = {
      ok: res.success,
      stdout: new TextDecoder().decode(res.stdout),
      stderr: new TextDecoder().decode(res.stderr),
    };
    if (!out.ok) {
      log.warn("yt-dlp non-zero exit", { args, stderr: out.stderr.slice(0, 200) });
    }
    return out;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      // The cached path raced (e.g. the user uninstalled). Bust cache
      // for the next call.
      cachedYtDlpPath = undefined;
      throw new Error(`yt-dlp binary at ${bin} disappeared mid-run.`);
    }
    throw err;
  }
}

/** Convert a WebVTT subtitle file into a single block of plain text. */
function parseVtt(vtt: string): string {
  const out: string[] = [];
  let lastLine = "";
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("WEBVTT")) continue;
    if (line.startsWith("NOTE")) continue;
    if (line.startsWith("Kind:") || line.startsWith("Language:")) continue;
    if (line.includes("-->")) continue;
    if (/^\d+$/.test(line)) continue;
    // Strip HTML-ish tags WebVTT adds for word-level timing
    // (`<00:00:01.234><c>foo</c>`) and decode common entities.
    const clean = line
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
    // Auto-generated VTTs duplicate every line as the "next" cue. Skip
    // back-to-back identical cues.
    if (!clean || clean === lastLine) continue;
    out.push(clean);
    lastLine = clean;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export async function extractYouTubeTranscript(
  url: string,
): Promise<YouTubeTranscript> {
  // 1. Pull metadata as JSON.
  const meta = await ytDlp([
    "-j",
    "--skip-download",
    "--no-warnings",
    "--no-playlist",
    url,
  ]);
  if (!meta.ok) {
    throw new Error(`yt-dlp metadata failed: ${meta.stderr.trim()}`);
  }
  let info: {
    id?: string;
    title?: string;
    duration_string?: string;
    channel?: string;
    description?: string;
  };
  try {
    info = JSON.parse(meta.stdout);
  } catch (err) {
    throw new Error(
      `yt-dlp returned non-JSON metadata: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const videoId = info.id ?? "";
  const title = info.title ?? `YouTube video (${videoId})`;

  // 2. Pull subtitles into a temp dir. Prefer authored, fall back to
  //    auto-generated.
  const tmp = await mkdtemp(join(tmpdir(), "ln-yt-"));
  try {
    const sub = await ytDlp([
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "en.*,en,en-US,en-GB",
      "--sub-format",
      "vtt",
      "--no-playlist",
      "--no-warnings",
      "-o",
      `${tmp}/%(id)s.%(ext)s`,
      url,
    ]);
    if (!sub.ok) {
      throw new Error(`yt-dlp subtitles failed: ${sub.stderr.trim()}`);
    }
    const files = (await readdir(tmp)).filter((f) => f.endsWith(".vtt"));
    if (files.length === 0) {
      throw new Error(
        "This video has no subtitles or auto-captions in English.",
      );
    }
    // Prefer manual subtitles if both exist (yt-dlp marks autogen with
    // ".en-orig.vtt" or ".en.vtt" depending on version; sort puts the
    // shorter / "manual" name first by default).
    files.sort((a, b) => a.length - b.length);
    const vtt = await readFile(join(tmp, files[0]), "utf8");
    const transcript = parseVtt(vtt);
    if (!transcript) {
      throw new Error("Subtitle file was empty after parsing.");
    }
    return {
      title,
      content: transcript,
      videoId,
      duration: info.duration_string,
      channel: info.channel,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
