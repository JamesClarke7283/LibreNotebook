// Retrieval-augmented chat chain. Pulls top-k relevant chunks from the
// notebook's vector store, builds a grounded prompt, and streams an answer
// from the configured chat model.

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { Document } from "@langchain/core/documents";
import { buildChatModel } from "./llm.ts";
import { buildEmbeddings } from "./embeddings.ts";
import { similaritySearch } from "./vectorstore.ts";
import type { AppSettings, ChatMessage } from "./types.ts";

const SYSTEM_PROMPT = `You are LibreNotebook, an open-source NotebookLM-style assistant.
Answer the user's question using ONLY the context excerpts below. If the
context does not contain the answer, say you don't have enough information
in the saved sources to answer. Cite excerpts inline like [1], [2] when
helpful.

Context:
{context}`;

export async function streamRagAnswer(
  settings: AppSettings,
  notebookId: string,
  history: ChatMessage[],
  question: string,
): Promise<ReadableStream<Uint8Array>> {
  const llm = buildChatModel(settings.llm);
  const embeddings = buildEmbeddings(settings.embedding);

  // Retrieval (skipped gracefully when the notebook has no sources yet).
  let docs: Document[] = [];
  try {
    docs = await similaritySearch(notebookId, embeddings, question, 4);
  } catch {
    // Embedding provider unavailable — fall through to a context-less reply.
    docs = [];
  }
  const context = docs.length > 0
    ? docs.map((d, i) => `[${i + 1}] ${d.pageContent}`).join("\n\n")
    : "(no saved sources yet — answer that the notebook has no sources)";

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT],
    ...history.slice(-10).map((m) =>
      [m.role === "user" ? "human" : "ai", m.content] as [string, string]
    ),
    ["human", "{question}"],
  ]);

  const chain = prompt.pipe(llm).pipe(new StringOutputParser());
  const stream = await chain.stream({ context, question });

  // Adapt LangChain's AsyncIterable<string> into a Web ReadableStream<Uint8Array>.
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk) controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`\n\n[error: ${msg}]`));
        controller.close();
      }
    },
  });
}
