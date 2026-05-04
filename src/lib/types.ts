// Shared types for LibreNotebook.

export type ProviderKind = "openai" | "ollama";

export interface ProviderConfig {
  /** "openai" covers any OpenAI-compatible API (OpenAI, Together, Groq, vLLM, etc.). */
  provider: ProviderKind;
  /** Base URL of the server (e.g. https://api.openai.com/v1, http://localhost:11434). */
  baseUrl: string;
  /** Required for OpenAI-compatible servers. Optional for Ollama. */
  apiKey?: string;
  /** Model identifier (e.g. gpt-4o-mini, llama3.1, nomic-embed-text). */
  model: string;
}

/** LLM provider config — adds vision flag and Ollama context-window control. */
export interface LlmProviderConfig extends ProviderConfig {
  /**
   * Whether this model can read images. For OpenAI this is a manual user
   * toggle; for Ollama this is auto-detected from `/api/show`'s
   * `capabilities` array.
   */
  hasVision: boolean;
  /**
   * Ollama-only. "auto" = ask Ollama for the model's max context length and
   * use it. A number = use that many tokens. `undefined` for OpenAI.
   */
  numCtx?: "auto" | number;
}

export interface AppSettings {
  llm: LlmProviderConfig;
  embedding: ProviderConfig;
  /** ISO timestamp when the user completed onboarding. */
  configuredAt: string;
}

/** Auto-generated notebook overview shown at the top of the chat. */
export type SummaryStatus = "idle" | "generating" | "failed";

export interface Notebook {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceCount: number;
  /** 1–2 paragraph summary, with **bold** key terms (rendered client-side). */
  summary?: string;
  /** Up to 3 short questions a user might ask. */
  suggestedQuestions?: string[];
  summaryGeneratedAt?: string;
  summaryStatus?: SummaryStatus;
  summaryError?: string;
}

// ---------- Studio items ---------------------------------------------------

export type StudioItemKind = "infographic" | "audio" | "report";
export type StudioItemStatus = "generating" | "ready" | "failed";

/**
 * One generation produced by the Studio palette (right pane). Currently
 * only the Infographic tile creates these. The card in StudioPanel reads
 * these directly; ChatPanel correlates by `messageId` when the user
 * clicks a card.
 */
export interface StudioItem {
  id: string;
  notebookId: string;
  kind: StudioItemKind;
  /** "Generating infographic…" while in flight, then a derived title. */
  title: string;
  status: StudioItemStatus;
  /** Snapshot of `notebook.sourceCount` at start time. */
  basedOnSources: number;
  /** Last refinement iteration (1..N). */
  iteration?: number;
  /** Final Mermaid code (for "infographic" kind, status === "ready"). */
  mermaid?: string;
  /** Chat message id where the rendered diagram lives. */
  messageId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type SourceKind = "text" | "url" | "pdf" | "youtube";

export interface SourceImage {
  /** Filename within the source's images folder, e.g. "page-3-img-1.png"
   *  for PDFs or "img-1.png" for webpages. */
  filename: string;
  /** 1-based page number for PDFs, 1 for single-page sources (webpages). */
  page: number;
  width: number;
  height: number;
  /** Original web URL for webpage-extracted images (handy for citation). */
  src?: string;
  /** Alt text or caption when known. */
  alt?: string;
}

/**
 * Lifecycle of a source as it moves through ingestion:
 *   pending  → just created, not yet embedded into the vector store
 *   ready    → embedded, available for retrieval
 *   failed   → embedding failed (e.g. embedding server unreachable);
 *              `error` holds the message, the source is still browsable
 */
export type SourceStatus = "pending" | "ready" | "failed";

export interface NotebookSource {
  id: string;
  notebookId: string;
  name: string;
  kind: SourceKind;
  /** Plain-text content extracted from the source (already chunkable). */
  content: string;
  /** Extracted images (PDFs only, currently). */
  images?: SourceImage[];
  /** Number of pages (PDFs only). */
  pageCount?: number;
  status: SourceStatus;
  /** Populated when `status === "failed"`. */
  error?: string;
  /** Live ingestion progress; only meaningful while status === "pending". */
  progress?: { current: number; total: number };
  createdAt: string;
}

/**
 * One retrieved chunk surfaced as a citation. The LLM is prompted to refer
 * to chunks by their `index` (e.g. `[2]`), and the UI rewrites those
 * markers into hoverable popovers that show `content` and link back to
 * the originating source via `sourceId` / `sourceName`.
 */
export interface Citation {
  index: number;
  sourceId: string;
  sourceName: string;
  content: string;
}

export interface ChatMessage {
  id: string;
  notebookId: string;
  role: "user" | "assistant";
  content: string;
  /** Only populated for assistant messages that grounded their reply. */
  citations?: Citation[];
  createdAt: string;
}
