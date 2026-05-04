// Tiny per-notebook job store on disk. Used by the infographic
// generation flow to persist {start → refine* → finalise} state across
// HTTP round-trips without keeping anything in memory.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./paths.ts";
import type { InfographicParams } from "./infographic.ts";

function jobsDir(notebookId: string): string {
  return join(dataDir(), "notebooks", notebookId, "jobs");
}

function jobPath(notebookId: string, jobId: string): string {
  return join(jobsDir(notebookId), `${jobId}.json`);
}

export interface InfographicJob {
  id: string;
  notebookId: string;
  studioItemId: string;
  params: InfographicParams;
  history: Array<{ iter: number; mermaid: string }>;
  createdAt: string;
  updatedAt: string;
}

export async function createJob(
  init: Omit<InfographicJob, "id" | "createdAt" | "updatedAt">,
): Promise<InfographicJob> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const job: InfographicJob = { ...init, id, createdAt: now, updatedAt: now };
  await mkdir(jobsDir(job.notebookId), { recursive: true });
  await writeFile(jobPath(job.notebookId, id), JSON.stringify(job, null, 2));
  return job;
}

export async function readJob(
  notebookId: string,
  jobId: string,
): Promise<InfographicJob | null> {
  try {
    const txt = await readFile(jobPath(notebookId, jobId), "utf8");
    return JSON.parse(txt) as InfographicJob;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeJob(job: InfographicJob): Promise<void> {
  job.updatedAt = new Date().toISOString();
  await mkdir(jobsDir(job.notebookId), { recursive: true });
  await writeFile(
    jobPath(job.notebookId, job.id),
    JSON.stringify(job, null, 2),
  );
}

export async function deleteJob(
  notebookId: string,
  jobId: string,
): Promise<void> {
  try {
    await rm(jobPath(notebookId, jobId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
