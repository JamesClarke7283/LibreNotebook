import { define } from "../utils.ts";
import { Logo } from "../components/Logo.tsx";
import { AuthForm } from "../islands/AuthForm.tsx";
import { multiUserEnabled } from "../lib/env-config.ts";

export const handler = define.handlers({
  GET(ctx) {
    if (!multiUserEnabled()) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/" },
      });
    }
    const next = new URL(ctx.req.url).searchParams.get("next") ?? "/notebooks";
    return { data: { next } };
  },
});

export default define.page<typeof handler>(function SignIn({ data }) {
  return (
    <main class="min-h-screen flex items-center justify-center px-6 py-12">
      <div class="w-full max-w-sm">
        <div class="flex items-center gap-3 mb-6 justify-center text-zinc-100">
          <Logo size={32} />
          <h1 class="text-2xl font-semibold tracking-tight">LibreNotebook</h1>
        </div>
        <h2 class="text-lg text-zinc-200 text-center mb-6">Sign in</h2>
        <AuthForm mode="sign-in" next={data.next} />
      </div>
    </main>
  );
});
