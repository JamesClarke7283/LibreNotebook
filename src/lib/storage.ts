// Filesystem-backed persistence. Originally targeted Deno KV but Fresh's
// Vite SSR runtime exposes a partial Deno polyfill that lacks
// `Deno.openKv`, so we use plain JSON files under `.data/` instead. This
// also has the nice property of working identically under `deno serve`.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AppSettings,
  ChatMessage,
  Notebook,
  NotebookSource,
} from "./types.ts";

const DATA_DIR = join(Deno.cwd(), ".data");
const SETTINGS_PATH = join(DATA_DIR, "settings.json");
const NOTEBOOKS_DIR = join(DATA_DIR, "notebooks");

async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    const txt = await readFile(path, "utf8");
    return JSON.parse(txt) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

// ---------- Settings ----------

export function getSettings(): Promise<AppSettings | null> {
  return readJsonOrNull<AppSettings>(SETTINGS_PATH);
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJson(SETTINGS_PATH, settings);
}

export async function clearSettings(): Promise<void> {
  try {
    await rm(SETTINGS_PATH);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// ---------- Notebooks ----------

function notebookDir(id: string): string {
  return join(NOTEBOOKS_DIR, id);
}
function notebookFile(id: string): string {
  return join(notebookDir(id), "notebook.json");
}

export async function listNotebooks(): Promise<Notebook[]> {
  let ids: string[] = [];
  try {
    ids = await readdir(NOTEBOOKS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Notebook[] = [];
  for (const id of ids) {
    const nb = await readJsonOrNull<Notebook>(notebookFile(id));
    if (nb) out.push(nb);
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export function getNotebook(id: string): Promise<Notebook | null> {
  return readJsonOrNull<Notebook>(notebookFile(id));
}

export async function createNotebook(
  title = "Untitled notebook",
): Promise<Notebook> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const nb: Notebook = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    sourceCount: 0,
  };
  await writeJson(notebookFile(id), nb);
  return nb;
}

export async function updateNotebook(
  id: string,
  patch: Partial<Pick<Notebook, "title" | "sourceCount">>,
): Promise<Notebook | null> {
  const existing = await getNotebook(id);
  if (!existing) return null;
  const updated: Notebook = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(notebookFile(id), updated);
  return updated;
}

export async function deleteNotebook(id: string): Promise<void> {
  try {
    await rm(notebookDir(id), { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// ---------- Sources ----------

function sourcesDir(notebookId: string): string {
  return join(notebookDir(notebookId), "sources");
}

export async function listSources(
  notebookId: string,
): Promise<NotebookSource[]> {
  let files: string[] = [];
  try {
    files = await readdir(sourcesDir(notebookId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: NotebookSource[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const s = await readJsonOrNull<NotebookSource>(
      join(sourcesDir(notebookId), f),
    );
    if (s) out.push(s);
  }
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
}

export function getSource(
  notebookId: string,
  sourceId: string,
): Promise<NotebookSource | null> {
  return readJsonOrNull<NotebookSource>(
    join(sourcesDir(notebookId), `${sourceId}.json`),
  );
}

export async function addSource(
  source: Omit<NotebookSource, "id" | "createdAt">,
): Promise<NotebookSource> {
  const id = crypto.randomUUID();
  const created: NotebookSource = {
    ...source,
    id,
    createdAt: new Date().toISOString(),
  };
  await writeJson(
    join(sourcesDir(source.notebookId), `${id}.json`),
    created,
  );
  const nb = await getNotebook(source.notebookId);
  if (nb) await updateNotebook(nb.id, { sourceCount: nb.sourceCount + 1 });
  return created;
}

/**
 * Patch a source in place (status transitions, error messages, etc).
 * Returns the updated record or null if the source no longer exists.
 */
export async function updateSource(
  notebookId: string,
  sourceId: string,
  patch: Partial<NotebookSource>,
): Promise<NotebookSource | null> {
  const existing = await getSource(notebookId, sourceId);
  if (!existing) return null;
  const merged = { ...existing, ...patch, id: existing.id };
  await writeJson(join(sourcesDir(notebookId), `${sourceId}.json`), merged);
  return merged;
}

export async function deleteSource(
  notebookId: string,
  sourceId: string,
): Promise<void> {
  // Drop the source record.
  try {
    await rm(join(sourcesDir(notebookId), `${sourceId}.json`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // Drop any extracted images for this source.
  try {
    await rm(join(notebookDir(notebookId), "images", sourceId), {
      recursive: true,
      force: true,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // Bump notebook count.
  const nb = await getNotebook(notebookId);
  if (nb) {
    await updateNotebook(nb.id, {
      sourceCount: Math.max(0, nb.sourceCount - 1),
    });
  }
}

export function imagesDir(notebookId: string, sourceId: string): string {
  return join(notebookDir(notebookId), "images", sourceId);
}

// ---------- Messages ----------

function messagesFile(notebookId: string): string {
  return join(notebookDir(notebookId), "messages.json");
}

export async function listMessages(
  notebookId: string,
): Promise<ChatMessage[]> {
  return (await readJsonOrNull<ChatMessage[]>(messagesFile(notebookId))) ?? [];
}

export async function addMessage(
  message: Omit<ChatMessage, "id" | "createdAt">,
): Promise<ChatMessage> {
  const stored: ChatMessage = {
    ...message,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const existing = await listMessages(message.notebookId);
  await writeJson(messagesFile(message.notebookId), [...existing, stored]);
  return stored;
}
