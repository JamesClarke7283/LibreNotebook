// Generates a notebook overview + 3 suggested questions from the user's
// sources. Wired by /api/notebooks/:id/summary, called server-side. The
// result is persisted onto the Notebook record itself so it survives
// reload and the UI just reads it.

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { buildChatModel } from "./llm.ts";
import { listSources } from "./storage.ts";
import { getLogger } from "./logger.ts";
import type { AppSettings } from "./types.ts";

const log = getLogger("summary");

const PER_SOURCE_CHARS = 2_000;
const MAX_SOURCES = 10;
const MAX_TOTAL_CHARS = 20_000;

const SYSTEM_PROMPT =
  `You are an expert research assistant. Given excerpts from a user's
saved sources, do two things:

1. Write a concise overview (1–2 short paragraphs, no headings, no
   bullet lists). Wrap key terms or concept names in **bold**. Aim for
   roughly 100–180 words. The tone should be neutral and informative.

2. After the overview, on a new line write \`Suggested questions:\` and
   then exactly three short questions that a user might want to ask
   about these sources. One per line, prefixed with \`Q:\` (no numbering).

Output the overview first, then a blank line, then the
\`Suggested questions:\` block. Do not output anything else.`;

export interface SummaryResult {
  summary: string;
  suggestedQuestions: string[];
}

/**
 * Build the context block from the notebook's sources. Returns null if
 * there are no sources at all (caller should skip generation).
 */
async function buildContext(notebookId: string): Promise<string | null> {
  const sources = await listSources(notebookId);
  if (sources.length === 0) return null;

  const taken = sources.slice(0, MAX_SOURCES);
  let total = 0;
  const parts: string[] = [];
  for (let i = 0; i < taken.length; i++) {
    const s = taken[i];
    const slice = (s.content ?? "").slice(0, PER_SOURCE_CHARS);
    if (total + slice.length > MAX_TOTAL_CHARS) break;
    parts.push(`[Source ${i + 1}: ${s.name}]\n${slice}`);
    total += slice.length;
  }
  return parts.join("\n\n---\n\n");
}

/** Pull `Q: ...` lines out of the model output; fall back to the last 3
 *  non-empty lines if it didn't follow instructions. */
function parseQuestions(text: string): string[] {
  const qs: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:Q:|\d+[.)]|[-*])\s+(.+\?)\s*$/);
    if (m) qs.push(m[1].trim());
  }
  if (qs.length >= 3) return qs.slice(0, 3);
  // Fallback: any line that ends with a question mark.
  const fallback = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.endsWith("?"));
  return [...qs, ...fallback].slice(0, 3);
}

/**
 * Split summary text from the trailing questions block. Heuristic: the
 * first occurrence of "Suggested questions" (case-insensitive).
 */
function splitSummaryAndQuestions(
  raw: string,
): { summary: string; questionsBlock: string } {
  const trimmed = raw.trim();
  const idx = trimmed.search(/(?:^|\n)\s*Suggested questions\s*:?/i);
  if (idx === -1) {
    return { summary: trimmed, questionsBlock: "" };
  }
  return {
    summary: trimmed.slice(0, idx).trim(),
    questionsBlock: trimmed.slice(idx).trim(),
  };
}

export async function generateSummaryAndQuestions(
  settings: AppSettings,
  notebookId: string,
): Promise<SummaryResult | null> {
  log.info("summary buildContext start", { notebookId });
  const ctxStart = Date.now();
  const ctx = await buildContext(notebookId);
  if (!ctx) {
    log.info("summary skipped — no sources", { notebookId });
    return null;
  }
  log.info("summary buildContext done", {
    notebookId,
    promptChars: ctx.length,
    elapsedMs: Date.now() - ctxStart,
  });

  log.info("summary buildChatModel start", {
    notebookId,
    provider: settings.llm.provider,
    model: settings.llm.model,
    numCtx: settings.llm.numCtx,
  });
  const buildStart = Date.now();
  const model = await buildChatModel(settings.llm);
  log.info("summary buildChatModel done", {
    notebookId,
    elapsedMs: Date.now() - buildStart,
  });

  // 3-minute ceiling — generous enough for slow local Ollama models
  // on weak hardware, short enough that an unreachable / hung LLM
  // surfaces as a "failed" status in the UI instead of a perpetual
  // spinner. AbortSignal.timeout makes invoke() reject on expiry.
  // The 30-second heartbeat tick gives users visible proof that the
  // request is alive and waiting on the LLM, not silently idle.
  log.info("summary llm invoke start", {
    notebookId,
    promptChars: ctx.length,
    timeoutMs: 180_000,
  });
  const invokeStart = Date.now();
  const tick = setInterval(() => {
    log.info("summary llm invoke heartbeat", {
      notebookId,
      elapsedSec: Math.floor((Date.now() - invokeStart) / 1000),
    });
  }, 30_000);
  let reply;
  try {
    reply = await model.invoke(
      [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(
          `Sources:\n\n${ctx}\n\nWrite the overview and the 3 questions.`,
        ),
      ],
      { signal: AbortSignal.timeout(180_000) },
    );
  } finally {
    clearInterval(tick);
  }
  log.info("summary llm invoke done", {
    notebookId,
    elapsedMs: Date.now() - invokeStart,
  });

  // LangChain message content can be string or rich array; coerce.
  const text = typeof reply.content === "string"
    ? reply.content
    : (Array.isArray(reply.content)
      ? reply.content.map((c) =>
        typeof c === "string"
          ? c
          : "text" in c
          ? (c as { text: string }).text
          : ""
      ).join("")
      : String(reply.content));

  const { summary, questionsBlock } = splitSummaryAndQuestions(text);
  const suggestedQuestions = parseQuestions(questionsBlock || text);

  log.info("summary generated", {
    notebookId,
    chars: summary.length,
    questions: suggestedQuestions.length,
  });
  return {
    summary: summary || text.trim(),
    suggestedQuestions,
  };
}
