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

export interface AppSettings {
  llm: ProviderConfig;
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

export type SourceKind = "text" | "url" | "file";

export interface NotebookSource {
  id: string;
  notebookId: string;
  name: string;
  kind: SourceKind;
  /** Plain-text content extracted from the source (already chunkable). */
  content: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  notebookId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
