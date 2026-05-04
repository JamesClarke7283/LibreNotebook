// Provider-configuration form. One block for the LLM, one for embeddings.
// Each block lets the user pick OpenAI-compatible or Ollama, fill in the
// base URL / API key / model, and the form POSTs to /api/settings.

import { useSignal } from "@preact/signals";
import type { AppSettings, ProviderConfig, ProviderKind } from "../lib/types.ts";

interface Props {
  initial: AppSettings | null;
}

const DEFAULTS: Record<ProviderKind, { baseUrl: string; llmModel: string; embeddingModel: string }> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    llmModel: "gpt-4o-mini",
    embeddingModel: "text-embedding-3-small",
  },
  ollama: {
    baseUrl: "http://localhost:11434",
    llmModel: "llama3.1",
    embeddingModel: "nomic-embed-text",
  },
};

export function OnboardingForm({ initial }: Props) {
  const llmProvider = useSignal<ProviderKind>(initial?.llm.provider ?? "openai");
  const llmBaseUrl = useSignal(initial?.llm.baseUrl ?? DEFAULTS.openai.baseUrl);
  const llmApiKey = useSignal(initial?.llm.apiKey ?? "");
  const llmModel = useSignal(initial?.llm.model ?? DEFAULTS.openai.llmModel);

  const embProvider = useSignal<ProviderKind>(
    initial?.embedding.provider ?? "openai",
  );
  const embBaseUrl = useSignal(
    initial?.embedding.baseUrl ?? DEFAULTS.openai.baseUrl,
  );
  const embApiKey = useSignal(initial?.embedding.apiKey ?? "");
  const embModel = useSignal(
    initial?.embedding.model ?? DEFAULTS.openai.embeddingModel,
  );

  const submitting = useSignal(false);
  const error = useSignal<string | null>(null);

  function applyDefault(
    kind: "llm" | "emb",
    provider: ProviderKind,
  ) {
    const d = DEFAULTS[provider];
    if (kind === "llm") {
      llmProvider.value = provider;
      llmBaseUrl.value = d.baseUrl;
      llmModel.value = d.llmModel;
    } else {
      embProvider.value = provider;
      embBaseUrl.value = d.baseUrl;
      embModel.value = d.embeddingModel;
    }
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    error.value = null;
    submitting.value = true;
    const payload: { llm: ProviderConfig; embedding: ProviderConfig } = {
      llm: {
        provider: llmProvider.value,
        baseUrl: llmBaseUrl.value.trim(),
        apiKey: llmApiKey.value.trim() || undefined,
        model: llmModel.value.trim(),
      },
      embedding: {
        provider: embProvider.value,
        baseUrl: embBaseUrl.value.trim(),
        apiKey: embApiKey.value.trim() || undefined,
        model: embModel.value.trim(),
      },
    };
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      globalThis.location.href = "/notebooks";
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      submitting.value = false;
    }
  }

  return (
    <form onSubmit={onSubmit} class="space-y-6">
      <ProviderBlock
        title="Chat / LLM model"
        description="Used for chat answers and studio generations."
        provider={llmProvider.value}
        baseUrl={llmBaseUrl.value}
        apiKey={llmApiKey.value}
        model={llmModel.value}
        onProvider={(p) => applyDefault("llm", p)}
        onBaseUrl={(v) => (llmBaseUrl.value = v)}
        onApiKey={(v) => (llmApiKey.value = v)}
        onModel={(v) => (llmModel.value = v)}
      />
      <ProviderBlock
        title="Embedding model"
        description="Used to index your notebook sources for retrieval."
        provider={embProvider.value}
        baseUrl={embBaseUrl.value}
        apiKey={embApiKey.value}
        model={embModel.value}
        onProvider={(p) => applyDefault("emb", p)}
        onBaseUrl={(v) => (embBaseUrl.value = v)}
        onApiKey={(v) => (embApiKey.value = v)}
        onModel={(v) => (embModel.value = v)}
      />

      {error.value && (
        <div class="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">
          {error.value}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting.value}
        class="w-full py-3 rounded-full bg-zinc-100 text-zinc-900 font-medium hover:bg-white disabled:opacity-50"
      >
        {submitting.value ? "Saving…" : "Save and continue"}
      </button>
      <p class="text-xs text-zinc-500 text-center">
        Settings are stored locally via Deno KV. You can change them anytime
        from the Settings page.
      </p>
    </form>
  );
}

interface BlockProps {
  title: string;
  description: string;
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  onProvider: (p: ProviderKind) => void;
  onBaseUrl: (v: string) => void;
  onApiKey: (v: string) => void;
  onModel: (v: string) => void;
}

function ProviderBlock(props: BlockProps) {
  const isOllama = props.provider === "ollama";
  return (
    <fieldset class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <legend class="text-base text-zinc-100 font-medium">
            {props.title}
          </legend>
          <p class="text-xs text-zinc-400 mt-1">{props.description}</p>
        </div>
        <div class="inline-flex rounded-full bg-zinc-800 p-1 text-xs">
          <ProviderTab
            label="OpenAI-compatible"
            active={props.provider === "openai"}
            onClick={() => props.onProvider("openai")}
          />
          <ProviderTab
            label="Ollama"
            active={isOllama}
            onClick={() => props.onProvider("ollama")}
          />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Server URL"
          value={props.baseUrl}
          onInput={props.onBaseUrl}
          placeholder={isOllama
            ? "http://localhost:11434"
            : "https://api.openai.com/v1"}
        />
        <Field
          label="Model"
          value={props.model}
          onInput={props.onModel}
          placeholder={isOllama ? "llama3.1" : "gpt-4o-mini"}
        />
      </div>
      <Field
        label={isOllama ? "API key (optional)" : "API key"}
        value={props.apiKey}
        onInput={props.onApiKey}
        type="password"
        placeholder={isOllama ? "(leave blank for local Ollama)" : "sk-…"}
      />
    </fieldset>
  );
}

function ProviderTab(
  { label, active, onClick }: {
    label: string;
    active: boolean;
    onClick: () => void;
  },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={`px-3 py-1 rounded-full transition ${
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  value,
  onInput,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label class="block">
      <span class="block text-xs uppercase tracking-wide text-zinc-500 mb-1">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
        class="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
      />
    </label>
  );
}
