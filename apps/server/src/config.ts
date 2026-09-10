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

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseFloat(v);
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
  /**
   * Capability bundles an orchestrator may forge a new agent from. Only Dominic
   * edits these; the orchestrator picks a template, a name and a brief, never a
   * tool. Kept outside agentsDir so the loader never mistakes one for a member.
   */
  templatesDir: resolve(ROOT, "templates", "agents"),
  dbPath: resolve(ROOT, "data", "agora.db"),

  claudeBin: str("CLAUDE_BIN", "/home/dominickooya/.local/bin/claude"),
  cursorBin: str("CURSOR_BIN", "/home/dominickooya/.local/bin/cursor-agent"),

  /**
   * Which CLI runs agent turns: "cursor" (default), "claude", or "hybrid".
   *
   * Cursor is the primary seat — it spends the Cursor subscription instead of
   * the Claude Max pool that rule 11 accounts for. Claude remains available
   * via AGORA_DRIVER=claude, or hybrid (Cursor prose + Claude for structured
   * orchestrator turns). Cursor is weaker on system-prompt privilege and
   * JSON-schema validation; see drivers/cursor-cli.ts.
   */
  driver: str("AGORA_DRIVER", "cursor"),

  /**
   * Default / forced Cursor model. `auto` (default) routes on the Cursor
   * subscription seat and is applied to EVERY turn when set — agent
   * frontmatter Claude ids are ignored so they cannot burn Pro+ API limits.
   * Set to a specific id (e.g. composer-2.5) only if you intend API spend.
   */
  cursorModel: str("AGORA_CURSOR_MODEL", "auto"),

  /**
   * Planning model when AGORA_CURSOR_MODEL is NOT `auto`.
   * Ignored while CURSOR_MODEL=auto (planning stays on auto too).
   * Set to "" to use the ordinary cursor model for planning as well.
   */
  cursorPlanModel: str("AGORA_CURSOR_PLAN_MODEL", "auto"),

  model: str("AGORA_MODEL", "claude-sonnet-5"),
  effort: str("AGORA_EFFORT", "low"),

  /**
   * Turns between progress reviews — NOT a hard stop.
   *
   * This used to end the run outright, which is how a goal reached "ended
   * incomplete, 1 of 3 done" while the room was still perfectly capable of
   * finishing. The room now works until the goal is met or it is genuinely
   * stuck; this is only how often the orchestrator is made to stop and say
   * which of those is true.
   */
  maxTurns: int("AGORA_MAX_TURNS", 12),
  /**
   * How many review rounds a run may pass before it is stopped regardless of
   * verdict. The wall-clock cap is the real backstop; this catches a room that
   * is confidently reporting progress while going nowhere.
   */
  maxRounds: int("AGORA_MAX_ROUNDS", 6),
  /**
   * How many times a goal restarts itself after running out of budget before it
   * gives up and asks for a human. Each attempt is a full run, so this multiplies
   * the round ceiling rather than replacing it.
   */
  maxAutoResumes: int("AGORA_MAX_AUTO_RESUMES", 3),
  /**
   * A review also fires on the clock, not only on the turn count. Turns vary
   * from seconds to minutes depending on what an agent is doing, so a purely
   * turn-based pulse drifts: a browser sweep can spend half an hour inside its
   * turn budget without Dominic hearing anything.
   */
  reviewEveryMs: int("AGORA_REVIEW_EVERY_MS", 600_000),
  /**
   * Backstop for the whole run. Deliberately generous: a browser sweep doing
   * real work legitimately takes many minutes, and killing it for that wastes
   * everything it had done. The per-TURN timeout below is what catches a stuck
   * agent — this only catches a stuck run.
   */
  runTimeoutMs: int("AGORA_RUN_TIMEOUT_MS", 5_400_000),
  /** One agent turn. Exceeding it fails that turn, not the run. */
  turnTimeoutMs: int("AGORA_TURN_TIMEOUT_MS", 300_000),
  maxConcurrency: int("AGORA_MAX_CONCURRENCY", 2),
  transcriptWindow: int("AGORA_TRANSCRIPT_WINDOW", 40),
  /**
   * Compact the room's mind stone once this many messages have accumulated
   * since the last one. Compaction costs a model turn, so doing it after every
   * run would tax short exchanges for no benefit; waiting far longer risks
   * losing detail off the back of the transcript window.
   */
  mindStoneEvery: int("AGORA_MIND_STONE_EVERY", 25),

  openclawBin: str("OPENCLAW_BIN", "/home/dominickooya/.npm-global/bin/openclaw"),
  notifyJid: str("AGORA_NOTIFY_JID", ""),
  notifyDryRun: bool("AGORA_NOTIFY_DRY_RUN", true),

  /**
   * Honour an agent's `@next:` marker directly, skipping the orchestrator's
   * decision turn — one fewer model round trip per visible message.
   *
   * DEFAULTS OFF ON PURPOSE. The marker is new: measured over 934 historical
   * agent messages, 0% carried one. Routing on a marker whose real hit rate is
   * unknown produces a router that silently stops routing. Watch the
   * `event: "markers"` lines until the miss rate is low, then turn this on.
   */
  fastDispatch: bool("AGORA_FAST_DISPATCH", false),
  /**
   * Rewrite a reply once, on the cheap model with tools off, when it runs past
   * the budget in protocol.ts REPLY_LIMITS. Off means long replies post as they
   * are. Never truncates — see Orchestrator.enforceLength.
   */
  lengthGuard: bool("AGORA_LENGTH_GUARD", true),
  /**
   * Dollars one run may spend before it stops and asks. The first real budget
   * ceiling: a subscription has no $ cap and research turns are the expensive
   * kind. 0 disables. Resume grants a fresh allowance.
   */
  goalCostCapUsd: num("AGORA_GOAL_COST_CAP_USD", 5),
  /**
   * Start every ready step at once, each with its own owner, instead of one
   * agent per orchestrator turn. Bounded by maxConcurrency below: a wave of
   * four with two slots runs two at a time.
   */
  parallelSteps: bool("AGORA_PARALLEL_STEPS", true),
  /** Forged agents per goal and per room, so a room cannot fill itself with helpers. */
  maxSpawnsPerGoal: int("AGORA_MAX_SPAWNS_PER_GOAL", 3),
  maxForgedPerRoom: int("AGORA_MAX_FORGED_PER_ROOM", 12),
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
