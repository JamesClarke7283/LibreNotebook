// Provider-configuration form. One block for the LLM, one for embeddings.
// Each block lets the user pick OpenAI-compatible or Ollama, fill in the
// base URL / API key, click "Test connection" to probe the server and
// populate a searchable model combobox, and the form POSTs to
// /api/settings.

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { AppSettings, ProviderConfig, ProviderKind } from "../lib/types.ts";
import { ModelCombobox } from "./ModelCombobox.tsx";
import { CheckIcon } from "../components/Icons.tsx";

/**
 * Where to return when the user clicks Save (or Cancel). We capture the
 * referrer at mount so we can drop the user back where they came from
 * — typically /notebooks or /notebooks/:id. Falls back to /notebooks for
 * first-run / direct-link visits.
 */
function resolveReturnUrl(): string {
  const ref = (globalThis as unknown as { document?: Document }).document
    ?.referrer ?? "";
  if (!ref) return "/notebooks";
  try {
    const u = new URL(ref);
    if (u.origin !== globalThis.location.origin) return "/notebooks";
    // Don't loop back into the settings page itself.
    if (u.pathname === "/onboarding" || u.pathname === "/settings") {
      return "/notebooks";
    }
    return u.pathname + u.search;
  } catch {
    return "/notebooks";
  }
}

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

interface BlockState {
  provider: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
}

function makeBlockState(
  cfg: ProviderConfig | undefined,
  modelDefault: string,
): BlockState {
  return {
    provider: cfg?.provider ?? "openai",
    baseUrl: cfg?.baseUrl ?? DEFAULTS[cfg?.provider ?? "openai"].baseUrl,
    apiKey: cfg?.apiKey ?? "",
    model: cfg?.model ?? modelDefault,
    models: [],
    testing: false,
    testResult: null,
  };
}

export function OnboardingForm({ initial }: Props) {
  const llm = useSignal<BlockState>(
    makeBlockState(initial?.llm, DEFAULTS.openai.llmModel),
  );
  const emb = useSignal<BlockState>(
    makeBlockState(initial?.embedding, DEFAULTS.openai.embeddingModel),
  );

  const submitting = useSignal(false);
  const submitError = useSignal<string | null>(null);

  // Captured once at mount; stable across re-renders.
  const returnUrlRef = useRef("/notebooks");
  useEffect(() => {
    returnUrlRef.current = resolveReturnUrl();
  }, []);

  const isEditing = initial !== null;

  function applyDefault(
    sig: typeof llm,
    provider: ProviderKind,
    modelKind: "llmModel" | "embeddingModel",
  ) {
    const d = DEFAULTS[provider];
    sig.value = {
      ...sig.value,
      provider,
      baseUrl: d.baseUrl,
      model: d[modelKind],
      models: [],
      testResult: null,
    };
  }

  async function testConnection(sig: typeof llm) {
    const s = sig.value;
    sig.value = { ...s, testing: true, testResult: null };
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: s.provider,
          baseUrl: s.baseUrl.trim(),
          apiKey: s.apiKey.trim() || undefined,
        }),
      });
      const data = await res.json() as
        | { ok: true; models: string[] }
        | { ok: false; error: string };
      if (data.ok) {
        sig.value = {
          ...sig.value,
          testing: false,
          models: data.models,
          testResult: {
            ok: true,
            message:
              `Connected — ${data.models.length} model${data.models.length === 1 ? "" : "s"} available`,
          },
        };
      } else {
        sig.value = {
          ...sig.value,
          testing: false,
          testResult: { ok: false, message: data.error },
        };
      }
    } catch (err) {
      sig.value = {
        ...sig.value,
        testing: false,
        testResult: {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    submitError.value = null;
    submitting.value = true;
    const payload: { llm: ProviderConfig; embedding: ProviderConfig } = {
      llm: {
        provider: llm.value.provider,
        baseUrl: llm.value.baseUrl.trim(),
        apiKey: llm.value.apiKey.trim() || undefined,
        model: llm.value.model.trim(),
      },
      embedding: {
        provider: emb.value.provider,
        baseUrl: emb.value.baseUrl.trim(),
        apiKey: emb.value.apiKey.trim() || undefined,
        model: emb.value.model.trim(),
      },
    };
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(await res.text() || `HTTP ${res.status}`);
      }
      globalThis.location.href = returnUrlRef.current;
    } catch (err) {
      submitError.value = err instanceof Error ? err.message : String(err);
    } finally {
      submitting.value = false;
    }
  }

  function onCancel() {
    globalThis.location.href = returnUrlRef.current;
  }

  return (
    <form onSubmit={onSubmit} class="space-y-6">
      <ProviderBlock
        title="Chat / LLM model"
        description="Used for chat answers and studio generations."
        state={llm.value}
        onProvider={(p) => applyDefault(llm, p, "llmModel")}
        onBaseUrl={(v) => (llm.value = { ...llm.value, baseUrl: v })}
        onApiKey={(v) => (llm.value = { ...llm.value, apiKey: v })}
        onModel={(v) => (llm.value = { ...llm.value, model: v })}
        onTest={() => testConnection(llm)}
      />
      <ProviderBlock
        title="Embedding model"
        description="Used to index your notebook sources for retrieval."
        state={emb.value}
        onProvider={(p) => applyDefault(emb, p, "embeddingModel")}
        onBaseUrl={(v) => (emb.value = { ...emb.value, baseUrl: v })}
        onApiKey={(v) => (emb.value = { ...emb.value, apiKey: v })}
        onModel={(v) => (emb.value = { ...emb.value, model: v })}
        onTest={() => testConnection(emb)}
      />

      {submitError.value && (
        <div class="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">
          {submitError.value}
        </div>
      )}

      <div class="flex items-center gap-3">
        {isEditing && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting.value}
            class="px-5 py-3 rounded-full border border-zinc-700 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting.value}
          class="flex-1 py-3 rounded-full bg-zinc-100 text-zinc-900 font-medium hover:bg-white disabled:opacity-50"
        >
          {submitting.value
            ? "Saving…"
            : isEditing
            ? "Save"
            : "Save and continue"}
        </button>
      </div>
      <p class="text-xs text-zinc-500 text-center">
        Settings are stored locally as JSON. You can change them anytime
        from the Settings page.
      </p>
    </form>
  );
}

interface BlockProps {
  title: string;
  description: string;
  state: BlockState;
  onProvider: (p: ProviderKind) => void;
  onBaseUrl: (v: string) => void;
  onApiKey: (v: string) => void;
  onModel: (v: string) => void;
  onTest: () => void;
}

function ProviderBlock(props: BlockProps) {
  const { state } = props;
  const isOllama = state.provider === "ollama";
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
            active={state.provider === "openai"}
            onClick={() => props.onProvider("openai")}
          />
          <ProviderTab
            label="Ollama"
            active={isOllama}
            onClick={() => props.onProvider("ollama")}
          />
        </div>
      </div>

      <Field
        label="Server URL"
        value={state.baseUrl}
        onInput={props.onBaseUrl}
        placeholder={isOllama
          ? "http://localhost:11434"
          : "https://api.openai.com/v1"}
      />
      <Field
        label={isOllama ? "API key (optional)" : "API key"}
        value={state.apiKey}
        onInput={props.onApiKey}
        type="password"
        placeholder={isOllama ? "(leave blank for local Ollama)" : "sk-…"}
      />

      <div class="flex items-center gap-3">
        <button
          type="button"
          onClick={props.onTest}
          disabled={state.testing}
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-700 text-zinc-100 text-xs hover:bg-zinc-800 disabled:opacity-50"
        >
          {state.testing
            ? "Testing…"
            : (
              <>
                <CheckIcon size={12} />
                <span>Test connection</span>
              </>
            )}
        </button>
        {state.testResult && (
          <span
            class={`text-xs ${
              state.testResult.ok ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {state.testResult.message}
          </span>
        )}
      </div>

      <div>
        <span class="block text-xs uppercase tracking-wide text-zinc-500 mb-1">
          Model
        </span>
        <ModelCombobox
          value={state.model}
          onInput={props.onModel}
          options={state.models}
          placeholder={isOllama
            ? "llama3.1 — test connection to list installed models"
            : "gpt-4o-mini — test connection to list available models"}
        />
        {state.models.length === 0 && (
          <p class="text-[11px] text-zinc-500 mt-1">
            Click <em>Test connection</em>{" "}
            to populate the dropdown, or just type any model name.
          </p>
        )}
      </div>
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
