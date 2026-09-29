/**
 * Run lifecycle. One place decides whether a run may change state.
 *
 * Live phases stay the strings the run bar already shows, plus `reviewing`
 * and `queued`. Terminal statuses are a second axis: `stopReason` on the
 * wire is unchanged, because the loop and the UI still branch on those
 * strings. `status` and `terminal` say what that string means.
 *
 * `queued` is the inbox while a room is busy. The live RunState does not
 * sit in `queued`; the next start() begins at `planning` or `generating`.
 */

export const LIVE_STATUSES = [
  "queued",
  "planning",
  "deciding",
  "waiting_slot",
  "generating",
  "rate_limited",
  "reviewing",
  "compacting",
] as const;

export type LiveStatus = (typeof LIVE_STATUSES)[number];

/** Closed. A run object is not reused after one of these. */
export const TERMINAL_STATUSES = [
  "completed",
  "cancelled",
  "timed_out",
  "failed",
  "blocked",
  "paused",
  "awaiting_access",
  "capped",
] as const;

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export type RunStatus = LiveStatus | TerminalStatus;

/**
 * Why a run ended. Distinct from the status so a cost pause and a review
 * ceiling are both caps, and a driver failure is not the same as a model
 * saying it is blocked.
 */
export type TerminalKind =
  | "completed"
  | "user_cancelled"
  | "timeout"
  | "cap"
  | "driver_failure"
  | "model_blocked"
  | "awaiting_access"
  | "unhandled";

export const LEGACY_STOP_REASONS = [
  "done",
  "stopped",
  "timeout",
  "paused",
  "awaiting_access",
  "blocked",
  "turn_cap",
  "orchestrator_error",
  "error",
] as const;

export type LegacyStopReason = (typeof LEGACY_STOP_REASONS)[number];

export interface TerminalReason {
  status: TerminalStatus;
  kind: TerminalKind;
  /** The string `RunState.stopReason` keeps. Do not invent a new one here. */
  stopReason: LegacyStopReason;
  cap?: "cost" | "rounds";
  detail?: string;
}

export type TransitionResult =
  | { ok: true; duplicate: boolean; from: RunStatus; to: RunStatus; terminal?: TerminalReason }
  | { ok: false; duplicate: false; from: RunStatus; to: RunStatus; reason: string };

const LIVE = new Set<string>(LIVE_STATUSES);

const TERMINAL_OF: Record<LegacyStopReason, TerminalReason> = {
  done: { status: "completed", kind: "completed", stopReason: "done" },
  stopped: { status: "cancelled", kind: "user_cancelled", stopReason: "stopped" },
  timeout: { status: "timed_out", kind: "timeout", stopReason: "timeout" },
  paused: { status: "paused", kind: "cap", stopReason: "paused", cap: "cost" },
  awaiting_access: {
    status: "awaiting_access",
    kind: "awaiting_access",
    stopReason: "awaiting_access",
  },
  blocked: { status: "blocked", kind: "model_blocked", stopReason: "blocked" },
  turn_cap: { status: "capped", kind: "cap", stopReason: "turn_cap", cap: "rounds" },
  orchestrator_error: {
    status: "failed",
    kind: "driver_failure",
    stopReason: "orchestrator_error",
  },
  error: { status: "failed", kind: "unhandled", stopReason: "error" },
};

export function isLiveStatus(status: RunStatus): status is LiveStatus {
  return LIVE.has(status);
}

export function isTerminalStatus(status: RunStatus): status is TerminalStatus {
  return !LIVE.has(status);
}

export function terminalFor(legacy: LegacyStopReason, detail?: string): TerminalReason {
  const base = TERMINAL_OF[legacy];
  return detail ? { ...base, detail } : { ...base };
}

/**
 * Live → live. Any live phase may move to any other live phase: the loop
 * already jumps (planning to deciding, generating to rate_limited, and so on).
 * A terminal run cannot move.
 */
export function transitionPhase(from: RunStatus, to: LiveStatus): TransitionResult {
  if (isTerminalStatus(from)) {
    return {
      ok: false,
      duplicate: false,
      from,
      to,
      reason: "a finished run cannot change phase",
    };
  }
  return { ok: true, duplicate: from === to, from, to };
}

/**
 * Live → terminal. The first terminal reason wins. A second call is a
 * duplicate and must not overwrite it. The one hard refusal on top of that:
 * a failed run cannot be marked completed.
 */
export function transitionTerminal(
  from: RunStatus,
  legacy: LegacyStopReason,
  detail?: string,
): TransitionResult {
  const terminal = terminalFor(legacy, detail);
  if (isTerminalStatus(from)) {
    if (from === "failed" && terminal.status === "completed") {
      return {
        ok: false,
        duplicate: false,
        from,
        to: "completed",
        reason: "a failed run cannot be marked completed",
      };
    }
    return { ok: true, duplicate: true, from, to: from };
  }
  return { ok: true, duplicate: false, from, to: terminal.status, terminal };
}
