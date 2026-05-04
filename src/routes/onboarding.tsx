// Greeting / first-run setup screen. Captures the user's LLM and embedding
// provider details (OpenAI-compatible URL+key, or Ollama URL).

import { define } from "../utils.ts";
import { Logo } from "../components/Logo.tsx";
import { OnboardingForm } from "../islands/OnboardingForm.tsx";
import { getSettings } from "../lib/storage.ts";

export const handler = define.handlers({
  async GET(_ctx) {
    const existing = await getSettings();
    return { data: { existing } };
  },
});

export default define.page<typeof handler>(function Onboarding({ data }) {
  return (
    <main class="min-h-screen flex items-center justify-center px-6 py-12">
      <div class="w-full max-w-2xl">
        <div class="flex items-center gap-3 mb-8 justify-center text-zinc-100">
          <Logo size={36} />
          <h1 class="text-3xl font-semibold tracking-tight">LibreNotebook</h1>
        </div>
        <h2 class="text-xl text-zinc-200 text-center mb-2">
          Welcome — let's connect your models
        </h2>
        <p class="text-sm text-zinc-400 text-center mb-10">
          LibreNotebook is an open-source NotebookLM. It runs entirely against
          AI servers you choose: an OpenAI-compatible endpoint, or your local
          Ollama. Pick one for chat and one for embeddings.
        </p>

        <OnboardingForm initial={data.existing} />
      </div>
    </main>
  );
});
