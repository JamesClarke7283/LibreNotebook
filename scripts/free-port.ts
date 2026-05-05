// Pre-flight helper for `deno task dev` (and `deno task neu`):
// kills any process holding the requested TCP port so vite can bind
// to it. Without this, a stale vite from a crashed prior session
// blocks the next start with:
//
//   error when starting dev server:
//   Error: Port 5173 is already in use
//
// vite.config.ts sets `strictPort: true` because Neutralino's
// devUrl is hardcoded to 5173, so vite refuses to fall back to a
// different port.
//
// NOTE: do NOT clean node_modules/.deno here — that directory is
// the actual source-of-truth tree that `node_modules/<pkg>` and
// `node_modules/.bin/<bin>` symlink INTO. Removing it orphans
// every package symlink (including vite itself) and breaks the
// dev server. The @deno/loader ENOENT problem is solved instead
// by resolve.alias entries in vite.config.ts that route the
// problematic imports to the symlinked node_modules/<pkg>/ paths
// so the loader never sees them.
//
// Usage:
//   deno run -A scripts/free-port.ts [port]
// Default port is 5173.

const port = Number(Deno.args[0] ?? "5173");
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`free-port.ts: invalid port "${Deno.args[0]}"`);
  Deno.exit(64);
}

async function probe(): Promise<boolean> {
  // Try to listen on the port; if we can, nothing's holding it.
  // Brief listen-then-close — no race because we close before vite
  // tries to bind.
  try {
    const l = Deno.listen({ port, hostname: "127.0.0.1" });
    l.close();
    return false;
  } catch (err) {
    if (err instanceof Deno.errors.AddrInUse) return true;
    // Permission denied / unsupported — pretend it's free; let vite
    // surface the real error if there is one.
    return false;
  }
}

async function killOwners(): Promise<number> {
  if (Deno.build.os === "windows") {
    // PowerShell handles both pid lookup and termination in one
    // pass. `Get-NetTCPConnection` works on Windows 8+ / Server 2012+.
    const cmd = new Deno.Command("powershell", {
      args: [
        "-NoProfile",
        "-Command",
        `$pids = Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ` +
        `Select-Object -ExpandProperty OwningProcess -Unique; ` +
        `foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }; ` +
        `if ($pids) { $pids.Count } else { 0 }`,
      ],
      stdout: "piped",
      stderr: "null",
    });
    const { stdout } = await cmd.output();
    const text = new TextDecoder().decode(stdout).trim();
    return Number(text) || 0;
  }

  // Linux / macOS: lsof gives us PIDs; kill -9 finishes the job.
  let pids: string[] = [];
  try {
    const lsof = new Deno.Command("lsof", {
      args: ["-ti", `:${port}`],
      stdout: "piped",
      stderr: "null",
    });
    const out = await lsof.output();
    pids = new TextDecoder().decode(out.stdout)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    // lsof not installed; try fuser as fallback.
    try {
      const fuser = new Deno.Command("fuser", {
        args: [`${port}/tcp`],
        stdout: "piped",
        stderr: "null",
      });
      const out = await fuser.output();
      pids = new TextDecoder().decode(out.stdout)
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      // Neither tool available — give up; vite will surface the
      // port-in-use error and the user can free it manually.
      return 0;
    }
  }
  let killed = 0;
  for (const pid of pids) {
    try {
      const kill = new Deno.Command("kill", {
        args: ["-9", pid],
        stdout: "null",
        stderr: "null",
      });
      const r = await kill.output();
      if (r.success) killed++;
    } catch {
      // best-effort
    }
  }
  return killed;
}

if (!(await probe())) {
  // Port is free — nothing to do.
  Deno.exit(0);
}

console.error(`free-port: port ${port} is in use; killing owner(s)…`);
const killed = await killOwners();
console.error(`free-port: killed ${killed} process(es).`);

// Brief settle so the kernel releases the socket before vite binds.
await new Promise((r) => setTimeout(r, 250));

// Re-probe; if still in use, surface the failure clearly.
if (await probe()) {
  console.error(
    `free-port: port ${port} still in use after kill — bailing.`,
  );
  Deno.exit(1);
}
Deno.exit(0);
