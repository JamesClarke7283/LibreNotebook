// LLM-driven infographic generation. The Mermaid diagram is produced
// once with `generateInitialMermaid` and then refined N times via
// `refineMermaid`, which optionally feeds the rendered PNG back to a
// vision-capable model so the LLM can see (and improve) what it
// produced. Both routines are pure helpers; the route handlers wire
// them into a job whose state lives in
// `.data/notebooks/<id>/jobs/<jobId>.json`.

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { buildChatModel } from "./llm.ts";
import { listSources } from "./storage.ts";
import { getLogger } from "./logger.ts";
import type { AppSettings } from "./types.ts";

const log = getLogger("infographic");

export interface InfographicParams {
  language: string;
  orientation: "Landscape" | "Portrait" | "Square";
  style: string; // "Auto-select", "Sketch note", "Kawaii", …
  detail: "Concise" | "Standard" | "Detailed";
  description: string; // user's free-form prompt
}

const SOURCE_CONTEXT_BUDGET = 6_000; // chars

async function buildSourceContext(notebookId: string): Promise<string> {
  const sources = await listSources(notebookId);
  if (sources.length === 0) return "(no saved sources)";
  let total = 0;
  const parts: string[] = [];
  for (let i = 0; i < sources.length && i < 8; i++) {
    const s = sources[i];
    const slice = (s.content ?? "").slice(0, 1_500);
    if (total + slice.length > SOURCE_CONTEXT_BUDGET) break;
    parts.push(`[Source ${i + 1}: ${s.name}]\n${slice}`);
    total += slice.length;
  }
  return parts.join("\n\n---\n\n");
}

const INITIAL_SYSTEM = (p: InfographicParams) =>
  `You are an infographic designer. Produce a single Mermaid diagram
that visualises the user's request. You may use any of these diagram
types: \`flowchart\`, \`mindmap\`, \`graph\`, \`sequenceDiagram\`,
\`timeline\`, \`quadrantChart\`. Pick whichever best fits the
content.

Constraints:
- Output ONLY a fenced code block:    \`\`\`mermaid ... \`\`\`
- No prose, no explanation, no titles outside the diagram.
- Respect these design choices the user picked:
    language    = ${p.language}
    orientation = ${p.orientation}   (landscape ⇒ "flowchart LR" / "graph LR";
                                       portrait or square ⇒ "flowchart TD" / "graph TD")
    visual style = ${p.style}        (you don't need real images — just
                                       reflect the style in node shapes,
                                       labels and colour classes if any)
    level of detail = ${p.detail}     (concise ⇒ ~5 nodes; standard ⇒ ~10;
                                       detailed ⇒ up to ~20 nodes)
- The user's free-form intent: "${p.description || "(none)"}"`;

const REFINE_SYSTEM_TEXT =
  `You are reviewing your own infographic. Critique it briefly against
the user's description, then output an IMPROVED Mermaid diagram.
Respond ONLY with a fenced \`\`\`mermaid block — no prose, no critique
text outside the block. Keep the same diagram orientation unless it's
obviously wrong.`;

const REFINE_SYSTEM_VISION =
  `You are reviewing your own infographic. The image attached is the
current rendering. Critique it briefly against the user's description,
then output an IMPROVED Mermaid diagram. Respond ONLY with a fenced
\`\`\`mermaid block — no prose, no critique text outside the block.
Keep the same diagram orientation unless it's obviously wrong.`;

/** Pull the first ```mermaid block out of an LLM reply. Falls back to
 *  the whole reply with the fences stripped if the model forgot to
 *  fence its output. */
export function extractMermaid(raw: string): string {
  const m = raw.match(/```mermaid\s*\n([\s\S]*?)```/);
  if (m) return m[1].trim();
  // Fallback: any fenced block.
  const generic = raw.match(/```\s*\n([\s\S]*?)```/);
  if (generic) return generic[1].trim();
  return raw.replace(/```/g, "").trim();
}

function asString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === "string"
          ? c
          : (c && typeof c === "object" && "text" in c
            ? (c as { text: string }).text
            : "")
      )
      .join("");
  }
  return String(content ?? "");
}

/** 3-minute ceiling per LLM call (initial + each refinement). Long
 *  enough for slow local Ollama models on weak hardware, short enough
 *  that an unreachable / hung LLM surfaces as a "failed" studio item
 *  in the UI instead of a perpetual spinner. */
const INVOKE_TIMEOUT_MS = 180_000;

export async function generateInitialMermaid(
  settings: AppSettings,
  notebookId: string,
  params: InfographicParams,
): Promise<string> {
  log.info("infographic iter 1 start", { notebookId, style: params.style });
  const ctx = await buildSourceContext(notebookId);
  const model = await buildChatModel(settings.llm);
  const reply = await model.invoke(
    [
      new SystemMessage(INITIAL_SYSTEM(params)),
      new HumanMessage(
        `Notebook context:\n\n${ctx}\n\nProduce the diagram.`,
      ),
    ],
    { signal: AbortSignal.timeout(INVOKE_TIMEOUT_MS) },
  );
  const mermaid = extractMermaid(asString(reply.content));
  log.info("infographic iter 1 done", {
    notebookId,
    chars: mermaid.length,
  });
  return mermaid;
}

/**
 * Run one refinement pass. If `imageDataUrl` is provided AND the LLM
 * has vision capability, the image is sent alongside the text prompt.
 * Otherwise we fall back to a text-only critique of the current Mermaid.
 */
export async function refineMermaid(
  settings: AppSettings,
  params: InfographicParams,
  currentMermaid: string,
  imageDataUrl: string | null,
): Promise<string> {
  const model = await buildChatModel(settings.llm);

  log.info("infographic refine", {
    hasVision: settings.llm.hasVision,
    hasImage: imageDataUrl !== null,
  });
  if (imageDataUrl && settings.llm.hasVision) {
    // Multimodal message: text + image. LangChain's HumanMessage accepts
    // a content array of typed parts; both ChatOpenAI (image_url) and
    // ChatOllama (images on the message) understand this shape.
    const reply = await model.invoke(
      [
        new SystemMessage(REFINE_SYSTEM_VISION),
        new HumanMessage({
          content: [
            {
              type: "text",
              text:
                `User's description: "${params.description || "(none)"}"\n` +
                `Current Mermaid:\n\`\`\`mermaid\n${currentMermaid}\n\`\`\`\n\n` +
                `Critique against the description, then emit the improved diagram.`,
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        }),
      ],
      { signal: AbortSignal.timeout(INVOKE_TIMEOUT_MS) },
    );
    return extractMermaid(asString(reply.content));
  }

  // Text-only fallback.
  const reply = await model.invoke(
    [
      new SystemMessage(REFINE_SYSTEM_TEXT),
      new HumanMessage(
        `User's description: "${params.description || "(none)"}"\n` +
          `Design intent: ${params.style}, ${params.detail}, ${params.orientation}.\n\n` +
          `Current Mermaid:\n\`\`\`mermaid\n${currentMermaid}\n\`\`\`\n\n` +
          `Critique briefly, then emit the improved diagram in a fenced ` +
          `\`\`\`mermaid block.`,
      ),
    ],
    { signal: AbortSignal.timeout(INVOKE_TIMEOUT_MS) },
  );
  return extractMermaid(asString(reply.content));
}

/**
 * Best-effort title for the finished studio item. Look for a Mermaid
 * graph title (`flowchart TD`, `mindmap` root etc.) — fall back to the
 * user's description.
 */
export function deriveTitle(
  mermaid: string,
  params: InfographicParams,
): string {
  // mindmap root id is the first non-blank line after `mindmap`
  const mm = mermaid.match(/mindmap\s*\n\s*\(?(\w[\w\s]+?)\)?\s*\n/);
  if (mm) return mm[1].trim();
  // First node's label, e.g. `A[Some text]` or `A(("Some text"))`.
  const node = mermaid.match(
    /[A-Za-z0-9_]+[\[\(\{]+\s*"?([^"\]\)\}]+?)"?\s*[\]\)\}]+/,
  );
  if (node) return node[1].trim();
  if (params.description.trim()) {
    const d = params.description.trim();
    return d.length > 60 ? d.slice(0, 60).trimEnd() + "…" : d;
  }
  return "Infographic";
}
