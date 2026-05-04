// Sign-in / sign-up form. Calls Better Auth's REST endpoints directly
// (the official client SDK pulls in extra deps we don't need for two
// flows). On success the auth handler sets the session cookie and we
// navigate to ?next= or /notebooks.

import { useSignal } from "@preact/signals";

interface Props {
  mode: "sign-in" | "sign-up";
  next: string;
}

export function AuthForm({ mode, next }: Props) {
  const email = useSignal("");
  const password = useSignal("");
  const name = useSignal("");
  const submitting = useSignal(false);
  const error = useSignal<string | null>(null);
  const info = useSignal<string | null>(null);

  async function onSubmit(e: Event) {
    e.preventDefault();
    error.value = null;
    info.value = null;
    submitting.value = true;
    const endpoint = mode === "sign-in"
      ? "/api/auth/sign-in/email"
      : "/api/auth/sign-up/email";
    const body: Record<string, unknown> = {
      email: email.value.trim(),
      password: password.value,
    };
    if (mode === "sign-up") body.name = name.value.trim() || email.value.trim();
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      // Sign-up sometimes lands a session cookie immediately, sometimes
      // requires verification first. Either way, try to navigate.
      if (mode === "sign-up") {
        info.value =
          "Account created. If you got a verification email, click the link, then sign in.";
      }
      // Bounce to the next URL.
      globalThis.location.href = next || "/notebooks";
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      submitting.value = false;
    }
  }

  return (
    <form onSubmit={onSubmit} class="space-y-4">
      {mode === "sign-up" && (
        <Field
          label="Name"
          value={name.value}
          onInput={(v) => (name.value = v)}
          autocomplete="name"
        />
      )}
      <Field
        label="Email"
        type="email"
        value={email.value}
        onInput={(v) => (email.value = v)}
        autocomplete="email"
      />
      <Field
        label="Password"
        type="password"
        value={password.value}
        onInput={(v) => (password.value = v)}
        autocomplete={mode === "sign-in" ? "current-password" : "new-password"}
      />

      {error.value && (
        <div class="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">
          {error.value}
        </div>
      )}
      {info.value && (
        <div class="text-sm text-emerald-300 bg-emerald-950/30 border border-emerald-900 rounded-md px-3 py-2">
          {info.value}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting.value}
        class="w-full py-3 rounded-full bg-zinc-100 text-zinc-900 font-medium hover:bg-white disabled:opacity-50"
      >
        {submitting.value
          ? "…"
          : mode === "sign-in"
          ? "Sign in"
          : "Create account"}
      </button>

      <p class="text-xs text-zinc-500 text-center">
        {mode === "sign-in"
          ? (
            <>
              No account?{" "}
              <a href="/signup" class="text-zinc-300 hover:text-white underline-offset-2 hover:underline">
                Create one
              </a>
            </>
          )
          : (
            <>
              Already registered?{" "}
              <a href="/signin" class="text-zinc-300 hover:text-white underline-offset-2 hover:underline">
                Sign in
              </a>
            </>
          )}
      </p>
    </form>
  );
}

function Field({
  label,
  value,
  onInput,
  type = "text",
  autocomplete,
}: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  type?: string;
  autocomplete?: string;
}) {
  return (
    <label class="block">
      <span class="block text-xs uppercase tracking-wide text-zinc-500 mb-1">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autocomplete={autocomplete}
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
        class="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
      />
    </label>
  );
}
