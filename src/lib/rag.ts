// Retrieval-augmented chat chain. Pulls top-k relevant chunks from the
// notebook's vector store, builds a grounded prompt asking the LLM to
// cite chunks inline as `[N]`, and streams an NDJSON response that
// carries both the citation metadata and the answer tokens.
//
// Wire format (one JSON object per line, terminated by '\n'):
//
//   {"type":"citations","citations":[{index,sourceId,sourceName,content}, …]}
//   {"type":"token","text":"…"}            // many of these
//   {"type":"done"}
//   {"type":"error","error":"…"}           // on failure (instead of done)

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { Document } from "@langchain/core/documents";
import { buildChatModel } from "./llm.ts";
import { buildEmbeddings } from "./embeddings.ts";
import { similaritySearch } from "./vectorstore.ts";
import type { AppSettings, ChatMessage, Citation } from "./types.ts";

const SYSTEM_PROMPT = `You are LibreNotebook, an open-source NotebookLM-style assistant.
Answer the user's question using ONLY the context excerpts below. Each
excerpt is prefixed with a numeric tag like [1], [2]. When you use
information from an excerpt you MUST cite it inline using that tag, e.g.
"the sky appears blue [1] because of Rayleigh scattering [2]". Cite the
specific tag(s) for every factual claim.

If the context does not contain the answer, say you don't have enough
information in the saved sources to answer.

Context:
{context}`;

export interface RagStreamHandle {
  stream: ReadableStream<Uint8Array>;
  citations: Citation[];
}

export async function streamRagAnswer(
  settings: AppSettings,
  notebookId: string,
  history: ChatMessage[],
  question: string,
): Promise<RagStreamHandle> {
  const llm = await buildChatModel(settings.llm);
  const embeddings = buildEmbeddings(settings.embedding);

  // Retrieval (skipped gracefully when the notebook has no sources yet
  // OR the embedding server is unreachable).
  let docs: Document[] = [];
  try {
    docs = await similaritySearch(notebookId, embeddings, question, 4);
  } catch {
    docs = [];
  }
  const citations: Citation[] = docs.map((d, i) => ({
    index: i + 1,
    sourceId: (d.metadata as { sourceId?: string }).sourceId ?? "unknown",
    sourceName: (d.metadata as { sourceName?: string }).sourceName ??
      "Untitled source",
    content: d.pageContent,
  }));

  const context = citations.length > 0
    ? citations.map((c) => `[${c.index}] ${c.content}`).join("\n\n")
    : "(no saved sources yet — answer that the notebook has no sources)";

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT],
    ...history.slice(-10).map((m) =>
      [m.role === "user" ? "human" : "ai", m.content] as [string, string]
    ),
    ["human", "{question}"],
  ]);

  const chain = prompt.pipe(llm).pipe(new StringOutputParser());
  const tokenStream = await chain.stream({ context, question });

  const encoder = new TextEncoder();
  const writeLine = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    obj: unknown,
  ) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Emit citations first so the client can render the popover targets
      // before any [N] markers arrive.
      writeLine(controller, { type: "citations", citations });
      try {
        for await (const chunk of tokenStream) {
          if (chunk) writeLine(controller, { type: "token", text: chunk });
        }
        writeLine(controller, { type: "done" });
      } catch (err) {
        writeLine(controller, {
          type: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      controller.close();
    },
  });

  return { stream, citations };
}
