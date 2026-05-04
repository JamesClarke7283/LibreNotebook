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

export interface Notebook {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceCount: number;
}

export type SourceKind = "text" | "url" | "pdf";

export interface SourceImage {
  /** Filename within the source's images folder, e.g. "page-3-img-1.png". */
  filename: string;
  /** 1-based page number. */
  page: number;
  width: number;
  height: number;
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

export interface ChatMessage {
  id: string;
  notebookId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
