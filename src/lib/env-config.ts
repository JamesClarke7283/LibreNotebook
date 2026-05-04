// Centralised environment-config loader.
//
// On boot we read `.env` (via @std/dotenv) into Deno.env so every
// downstream consumer (logger, paths, storage, auth) just calls
// Deno.env.get() as before.
//
// We also surface "preset" provider configs — when LLM_BASE_URL +
// LLM_MODEL (and the embedding equivalents) are present, /api/settings
// returns those values + a `locked: true` flag, and the onboarding form
// renders read-only. This is how Docker / corporate operators ship a
// preconfigured deployment without exposing API keys to end users.

import { load as loadDotEnv } from "@std/dotenv";
import { getLogger } from "./logger.ts";
import type { LlmProviderConfig, ProviderConfig, ProviderKind } from "./types.ts";

const log = getLogger("env-config");

let loaded = false;

/** Read .env from the project root once, populating Deno.env in place. */
export async function loadEnv(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    // export: true puts values into Deno.env (only when not already set,
    // so real env vars win — matches twelve-factor convention).
    await loadDotEnv({ export: true });
    log.debug(".env loaded");
  } catch (err) {
    // Missing .env is fine — production deployments often set vars
    // directly. Anything else we surface as a warning.
    log.warn(".env load failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function asProvider(s: string | undefined): ProviderKind | null {
  if (s === "openai" || s === "ollama") return s;
  return null;
}

/**
 * The LLM provider preset, or null when the env doesn't fully specify
 * one. Required vars: LLM_BASE_URL + LLM_MODEL. Optional vars:
 * LLM_PROVIDER (defaults to openai), LLM_API_KEY, LLM_HAS_VISION
 * (truthy → true), LLM_NUM_CTX (number or "auto").
 */
export function envLlmConfig(): LlmProviderConfig | null {
  const base = Deno.env.get("LLM_BASE_URL")?.trim();
  const model = Deno.env.get("LLM_MODEL")?.trim();
  if (!base || !model) return null;
  const provider =
    asProvider(Deno.env.get("LLM_PROVIDER")?.trim().toLowerCase()) ??
      "openai";
  const apiKey = Deno.env.get("LLM_API_KEY")?.trim() || undefined;
  const hasVisionRaw = Deno.env.get("LLM_HAS_VISION")?.trim().toLowerCase();
  const hasVision = hasVisionRaw === "1" || hasVisionRaw === "true" ||
    hasVisionRaw === "yes";
  const numCtxRaw = Deno.env.get("LLM_NUM_CTX")?.trim();
  let numCtx: "auto" | number | undefined;
  if (numCtxRaw) {
    if (numCtxRaw.toLowerCase() === "auto") numCtx = "auto";
    else if (Number.isFinite(parseInt(numCtxRaw, 10))) {
      numCtx = parseInt(numCtxRaw, 10);
    }
  }
  return { provider, baseUrl: base, model, apiKey, hasVision, numCtx };
}

/** The embedding provider preset, or null when underspecified. */
export function envEmbeddingConfig(): ProviderConfig | null {
  const base = Deno.env.get("EMBEDDING_BASE_URL")?.trim();
  const model = Deno.env.get("EMBEDDING_MODEL")?.trim();
  if (!base || !model) return null;
  const provider =
    asProvider(Deno.env.get("EMBEDDING_PROVIDER")?.trim().toLowerCase()) ??
      "openai";
  const apiKey = Deno.env.get("EMBEDDING_API_KEY")?.trim() || undefined;
  return { provider, baseUrl: base, model, apiKey };
}

export interface EnvLockState {
  llm: boolean;
  embedding: boolean;
}

/** Whether each provider is locked by the environment. */
export function envLockState(): EnvLockState {
  return {
    llm: envLlmConfig() !== null,
    embedding: envEmbeddingConfig() !== null,
  };
}

/** True when the operator has enabled multi-user / auth mode. */
export function multiUserEnabled(): boolean {
  const v = Deno.env.get("MULTI_USER")?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  secure: boolean;
}

/** SMTP for password reset / verification emails. */
export function envSmtpConfig(): SmtpConfig | null {
  const host = Deno.env.get("SMTP_HOST")?.trim();
  const portStr = Deno.env.get("SMTP_PORT")?.trim();
  const from = Deno.env.get("SMTP_FROM")?.trim() ||
    Deno.env.get("SMTP_USER")?.trim() || "";
  if (!host) return null;
  const port = portStr ? parseInt(portStr, 10) : 587;
  if (!Number.isFinite(port)) return null;
  return {
    host,
    port,
    user: Deno.env.get("SMTP_USER")?.trim() || undefined,
    pass: Deno.env.get("SMTP_PASS")?.trim() || undefined,
    from: from || `LibreNotebook <no-reply@${host}>`,
    secure: port === 465,
  };
}
