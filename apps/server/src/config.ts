import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
/** Repo root: apps/server/src -> ../../.. */
export const ROOT = resolve(here, "..", "..", "..");

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export const config = {
  root: ROOT,
  agentsDir: resolve(ROOT, "agents"),
  dbPath: resolve(ROOT, "data", "agora.db"),

  claudeBin: str("CLAUDE_BIN", "/home/dominickooya/.local/bin/claude"),
  model: str("AGORA_MODEL", "claude-sonnet-5"),
  effort: str("AGORA_EFFORT", "low"),

  maxTurns: int("AGORA_MAX_TURNS", 12),
  /**
   * Backstop for the whole run. Deliberately generous: a browser sweep doing
   * real work legitimately takes many minutes, and killing it for that wastes
   * everything it had done. The per-TURN timeout below is what catches a stuck
   * agent — this only catches a stuck run.
   */
  runTimeoutMs: int("AGORA_RUN_TIMEOUT_MS", 2_700_000),
  /** One agent turn. Exceeding it fails that turn, not the run. */
  turnTimeoutMs: int("AGORA_TURN_TIMEOUT_MS", 300_000),
  maxConcurrency: int("AGORA_MAX_CONCURRENCY", 2),
  transcriptWindow: int("AGORA_TRANSCRIPT_WINDOW", 40),

  openclawBin: str("OPENCLAW_BIN", "/home/dominickooya/.npm-global/bin/openclaw"),
  notifyJid: str("AGORA_NOTIFY_JID", ""),
  notifyDryRun: bool("AGORA_NOTIFY_DRY_RUN", true),
  notifyMinIntervalS: int("AGORA_NOTIFY_MIN_INTERVAL_S", 60),

  port: int("AGORA_PORT", 8787),
  /**
   * Binds the WSL VM interface by default. WSL's localhost forwarding does not
   * reliably relay a 127.0.0.1 bind to Windows, and the VM sits on a host-only
   * NAT network, so this is reachable from Windows but not from the LAN.
   */
  host: str("AGORA_HOST", "0.0.0.0"),

  /**
   * Browser QA against the dev environment. Credentials live in .env and are
   * injected into the agent's system prompt at runtime — deliberately NOT
   * written into any agent's .md, so those files stay safe to read and share.
   */
  qaBaseUrl: str("AGORA_QA_BASE_URL", ""),
  qaAdminUrl: str("AGORA_QA_ADMIN_URL", ""),
  qaEmail: str("AGORA_QA_EMAIL", ""),
  qaPassword: str("AGORA_QA_PASSWORD", ""),
  qaAccount: str("AGORA_QA_ACCOUNT", ""),
  cdpPort: int("AGORA_CDP_PORT", 9222),
} as const;

/** True only when a real JID is configured AND dry-run is off. */
export function notifyIsLive(): boolean {
  return config.notifyJid.trim() !== "" && !config.notifyDryRun;
}
