// Provider-configuration form. One block for the LLM, one for embeddings.
//
// LLM blocks pick up two extra controls beyond the embedding block:
//   - Vision: manual checkbox for OpenAI-compatible servers, auto-detected
//     read-only badge for Ollama (queried via /api/probe-model).
//   - Context window: Ollama-only. "Auto" = use the model's full context
//     length (Ollama default 2048 is usually too small for RAG); a custom
//     numeric override is also available.

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type {
  AppSettings,
  LlmProviderConfig,
  ProviderConfig,
  ProviderKind,
} from "../lib/types.ts";
import { ModelCombobox } from "./ModelCombobox.tsx";
import { CheckIcon } from "../components/Icons.tsx";

function resolveReturnUrl(): string {
  const ref = (globalThis as unknown as { document?: Document }).document
    ?.referrer ?? "";
  if (!ref) return "/notebooks";
  try {
    const u = new URL(ref);
    if (u.origin !== globalThis.location.origin) return "/notebooks";
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
  // LLM-only:
  hasVision: boolean;
  visionAuto: boolean;       // true once Ollama auto-detect has run
  visionDetected: boolean | null;  // result of the last auto-detect
  numCtxMode: "auto" | "custom";
  numCtxCustom: string;      // string so the user can type freely
  contextLengthDetected: number | null;
  probing: boolean;
}

function makeBlockState(
  cfg: LlmProviderConfig | ProviderConfig | undefined,
  modelDefault: string,
  isLlm: boolean,
): BlockState {
  const llmCfg = cfg as LlmProviderConfig | undefined;
  return {
    provider: cfg?.provider ?? "openai",
    baseUrl: cfg?.baseUrl ?? DEFAULTS[cfg?.provider ?? "openai"].baseUrl,
    apiKey: cfg?.apiKey ?? "",
    model: cfg?.model ?? modelDefault,
    models: [],
    testing: false,
    testResult: null,
    hasVision: isLlm ? llmCfg?.hasVision ?? false : false,
    visionAuto: false,
    visionDetected: null,
    numCtxMode: isLlm
      ? typeof llmCfg?.numCtx === "number" ? "custom" : "auto"
      : "auto",
    numCtxCustom: isLlm && typeof llmCfg?.numCtx === "number"
      ? String(llmCfg.numCtx)
      : "",
    contextLengthDetected: null,
    probing: false,
  };
}

export function OnboardingForm({ initial }: Props) {
  const llm = useSignal<BlockState>(
    makeBlockState(initial?.llm, DEFAULTS.openai.llmModel, true),
  );
  const emb = useSignal<BlockState>(
    makeBlockState(initial?.embedding, DEFAULTS.openai.embeddingModel, false),
  );

  const submitting = useSignal(false);
  const submitError = useSignal<string | null>(null);

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
      visionDetected: null,
      contextLengthDetected: null,
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
            message: `Connected — ${data.models.length} model${
              data.models.length === 1 ? "" : "s"
            } available`,
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

  /** Probe the chosen model for vision capability + context length. LLM only. */
  async function probeModel(sig: typeof llm) {
    const s = sig.value;
    if (!s.model.trim()) return;
    sig.value = { ...s, probing: true };
    try {
      const res = await fetch("/api/probe-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: s.provider,
          baseUrl: s.baseUrl.trim(),
          apiKey: s.apiKey.trim() || undefined,
          model: s.model.trim(),
        }),
      });
      const data = await res.json() as
        | {
          ok: true;
          visionAuto: boolean;
          hasVision: boolean | null;
          contextLength: number | null;
        }
        | { ok: false; error: string };
      if (!data.ok) {
        sig.value = { ...sig.value, probing: false };
        return;
      }
      sig.value = {
        ...sig.value,
        probing: false,
        visionAuto: data.visionAuto,
        visionDetected: data.hasVision,
        // Auto-apply detected vision flag for Ollama only.
        hasVision: data.visionAuto && data.hasVision !== null
          ? data.hasVision
          : sig.value.hasVision,
        contextLengthDetected: data.contextLength,
      };
    } catch {
      sig.value = { ...sig.value, probing: false };
    }
  }

  // Re-probe whenever the LLM model changes (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      void probeModel(llm);
    }, 400);
    return () => clearTimeout(t);
  }, [llm.value.model, llm.value.provider, llm.value.baseUrl]);

  async function onSubmit(e: Event) {
    e.preventDefault();
    submitError.value = null;
    submitting.value = true;
    let numCtx: "auto" | number | undefined = undefined;
    if (llm.value.provider === "ollama") {
      if (llm.value.numCtxMode === "auto") numCtx = "auto";
      else {
        const n = parseInt(llm.value.numCtxCustom, 10);
        if (Number.isFinite(n) && n > 0) numCtx = n;
        else numCtx = "auto";
      }
    }
    const payload = {
      llm: {
        provider: llm.value.provider,
        baseUrl: llm.value.baseUrl.trim(),
        apiKey: llm.value.apiKey.trim() || undefined,
        model: llm.value.model.trim(),
        hasVision: llm.value.hasVision,
        numCtx,
      } as LlmProviderConfig,
      embedding: {
        provider: emb.value.provider,
        baseUrl: emb.value.baseUrl.trim(),
        apiKey: emb.value.apiKey.trim() || undefined,
        model: emb.value.model.trim(),
      } as ProviderConfig,
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
        isLlm={true}
        state={llm.value}
        onProvider={(p) => applyDefault(llm, p, "llmModel")}
        onBaseUrl={(v) => (llm.value = { ...llm.value, baseUrl: v })}
        onApiKey={(v) => (llm.value = { ...llm.value, apiKey: v })}
        onModel={(v) => (llm.value = { ...llm.value, model: v })}
        onHasVision={(v) => (llm.value = { ...llm.value, hasVision: v })}
        onNumCtxMode={(m) => (llm.value = { ...llm.value, numCtxMode: m })}
        onNumCtxCustom={(v) =>
          (llm.value = { ...llm.value, numCtxCustom: v })}
        onTest={() => testConnection(llm)}
      />
      <ProviderBlock
        title="Embedding model"
        description="Used to index your notebook sources for retrieval."
        isLlm={false}
        state={emb.value}
        onProvider={(p) => applyDefault(emb, p, "embeddingModel")}
        onBaseUrl={(v) => (emb.value = { ...emb.value, baseUrl: v })}
        onApiKey={(v) => (emb.value = { ...emb.value, apiKey: v })}
        onModel={(v) => (emb.value = { ...emb.value, model: v })}
        onHasVision={() => {}}
        onNumCtxMode={() => {}}
        onNumCtxCustom={() => {}}
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
  isLlm: boolean;
  state: BlockState;
  onProvider: (p: ProviderKind) => void;
  onBaseUrl: (v: string) => void;
  onApiKey: (v: string) => void;
  onModel: (v: string) => void;
  onHasVision: (v: boolean) => void;
  onNumCtxMode: (m: "auto" | "custom") => void;
  onNumCtxCustom: (v: string) => void;
  onTest: () => void;
}

function ProviderBlock(props: BlockProps) {
  const { state, isLlm } = props;
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

      {isLlm && (
        <>
          {/* Vision capability */}
          <div class="rounded-lg bg-zinc-950/60 border border-zinc-800 px-4 py-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm text-zinc-100 font-medium">
                  Vision capability
                </p>
                <p class="text-xs text-zinc-400 mt-0.5">
                  {isOllama
                    ? "Auto-detected from the Ollama API."
                    : "Tell us if this model can read images (PDF pages, screenshots)."}
                </p>
              </div>
              {isOllama
                ? (
                  <span
                    class={`text-xs px-2 py-1 rounded-full border ${
                      state.probing
                        ? "border-zinc-700 text-zinc-400"
                        : state.visionDetected === true
                        ? "border-emerald-700 text-emerald-300 bg-emerald-950/50"
                        : state.visionDetected === false
                        ? "border-zinc-700 text-zinc-400"
                        : "border-zinc-800 text-zinc-500"
                    }`}
                  >
                    {state.probing
                      ? "Probing…"
                      : state.visionDetected === true
                      ? "Vision: ✓ supported"
                      : state.visionDetected === false
                      ? "Vision: not supported"
                      : "Vision: unknown"}
                  </span>
                )
                : (
                  <label class="inline-flex items-center gap-2 text-sm text-zinc-200">
                    <input
                      type="checkbox"
                      checked={state.hasVision}
                      onChange={(e) =>
                        props.onHasVision(
                          (e.currentTarget as HTMLInputElement).checked,
                        )}
                      class="w-4 h-4 accent-zinc-100"
                    />
                    Has vision
                  </label>
                )}
            </div>
          </div>

          {/* Context window — Ollama only */}
          {isOllama && (
            <div class="rounded-lg bg-zinc-950/60 border border-zinc-800 px-4 py-3">
              <div class="flex items-center justify-between gap-3 mb-2">
                <div>
                  <p class="text-sm text-zinc-100 font-medium">
                    Context window
                  </p>
                  <p class="text-xs text-zinc-400 mt-0.5">
                    Auto uses the model's maximum context.
                    {state.contextLengthDetected
                      ? ` Detected: ${state.contextLengthDetected.toLocaleString()} tokens.`
                      : ""}
                  </p>
                </div>
                <div class="inline-flex rounded-full bg-zinc-800 p-1 text-xs">
                  <ContextModeTab
                    label="Auto"
                    active={state.numCtxMode === "auto"}
                    onClick={() => props.onNumCtxMode("auto")}
                  />
                  <ContextModeTab
                    label="Custom"
                    active={state.numCtxMode === "custom"}
                    onClick={() => props.onNumCtxMode("custom")}
                  />
                </div>
              </div>
              {state.numCtxMode === "custom" && (
                <input
                  type="number"
                  min="512"
                  step="512"
                  value={state.numCtxCustom}
                  placeholder={state.contextLengthDetected
                    ? String(state.contextLengthDetected)
                    : "8192"}
                  onInput={(e) =>
                    props.onNumCtxCustom(
                      (e.currentTarget as HTMLInputElement).value,
                    )}
                  class="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                />
              )}
            </div>
          )}
        </>
      )}
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

function ContextModeTab(
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
      class={`px-2.5 py-0.5 rounded-full transition ${
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
