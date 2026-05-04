// YouTube transcript ingest. We shell out to yt-dlp (the user's
// preferred path per the spec) and parse the resulting WebVTT into
// plain text. yt-dlp is preferred over a pure-JS approach because
// YouTube routinely changes their watch-page internals; yt-dlp tracks
// the upstream changes for us.
//
// Requires `yt-dlp` on PATH. Install with `pip install yt-dlp`,
// `brew install yt-dlp`, `apt install yt-dlp`, or similar. The error
// thrown when the binary is missing tells the user exactly that.

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "music.youtube.com",
]);

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
 * NotInstalled error if the binary isn't on PATH.
 */
async function ytDlp(args: string[]): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
}> {
  let cmd: Deno.Command;
  try {
    cmd = new Deno.Command("yt-dlp", {
      args,
      stdout: "piped",
      stderr: "piped",
    });
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(
        "yt-dlp is not installed. Install it with `pip install yt-dlp` or your package manager.",
      );
    }
    throw err;
  }
  let res: Deno.CommandOutput;
  try {
    res = await cmd.output();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(
        "yt-dlp is not installed. Install it with `pip install yt-dlp` or your package manager.",
      );
    }
    throw err;
  }
  return {
    ok: res.success,
    stdout: new TextDecoder().decode(res.stdout),
    stderr: new TextDecoder().decode(res.stderr),
  };
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
