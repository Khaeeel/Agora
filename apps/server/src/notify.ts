import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.ts";
import { getRoom } from "./db.ts";
import { slugify } from "./agents/registry.ts";

const run = promisify(execFile);

const lastSentAt = new Map<string, number>();

export interface NotifyResult {
  delivered: boolean;
  reason: "sent" | "no_jid" | "dry_run" | "rate_limited" | "failed" | "suppressed";
  command: string;
  detail?: string;
}

/**
 * The WhatsApp target for one room.
 *
 * A single global JID meant every room posted to the same group — correct with
 * one room, wrong the moment there are two, because research from one room
 * would land in the other room's group.
 *
 * Resolved from `AGORA_NOTIFY_JID_<SLUG>`, where SLUG is the slugified room
 * NAME uppercased with dashes as underscores — the same slug that picks the
 * room's rules file, so a room's target and its rules are named alike. Falls
 * back to the global `AGORA_NOTIFY_JID`.
 *
 * Set a room's var to `off` to silence just that room. An EMPTY value cannot
 * mean off: empty is indistinguishable from unset, and would quietly route the
 * room back to the global group — the exact mistake this function exists to
 * prevent.
 *
 * A roomId that is not a real room (the Bland watcher passes "bland-watch")
 * falls back to the global JID, which is what a workspace-level watcher wants.
 */
export function jidForRoom(roomId: string): string {
  const room = getRoom(roomId);
  if (!room) return config.notifyJid;

  const key = `AGORA_NOTIFY_JID_${slugify(room.name).replace(/-/g, "_").toUpperCase()}`;
  const v = process.env[key];
  if (v === undefined || v.trim() === "") return config.notifyJid;
  if (v.trim().toLowerCase() === "off") return "";
  return v.trim();
}

/**
 * What a message is, so a room can decide whether it wants it.
 *
 * - `prompt`     the finished deliverable: the thing Dominic actually has to run.
 * - `escalation` the room has stopped and needs a decision from him.
 * - `chatter`    everything else: progress, answers, discussion digests.
 */
export type NotifyKind = "prompt" | "escalation" | "chatter";

/** `all` sends everything; `prompt` sends only the deliverable and blockers. */
export type NotifyLevel = "all" | "prompt";

/**
 * How much a room is allowed to say on WhatsApp.
 *
 * Resolved from `AGORA_NOTIFY_LEVEL_<SLUG>` using the same room-name slug as
 * the JID and the rules file, falling back to `AGORA_NOTIFY_LEVEL` and then to
 * `all`. A room set to `prompt` goes quiet except for the two message kinds
 * that ask something of him — which is the whole point: a phone that buzzes on
 * every step stops being read at all, and then the one message that mattered
 * is the one that gets missed.
 */
export function levelForRoom(roomId: string): NotifyLevel {
  const room = getRoom(roomId);
  const fallback = (process.env["AGORA_NOTIFY_LEVEL"] ?? "all").trim().toLowerCase();
  if (!room) return fallback === "prompt" ? "prompt" : "all";
  const key = `AGORA_NOTIFY_LEVEL_${slugify(room.name).replace(/-/g, "_").toUpperCase()}`;
  const v = (process.env[key] ?? "").trim().toLowerCase();
  const chosen = v === "" ? fallback : v;
  return chosen === "prompt" ? "prompt" : "all";
}

function compose(text: string, jid: string): { bin: string; args: string[] } {
  return {
    bin: config.openclawBin,
    args: [
      "message",
      "send",
      "--channel",
      "whatsapp",
      "--target",
      jid,
      "--message",
      text,
    ],
  };
}

/**
 * Push one update to the WhatsApp group, behind three guards:
 * no JID configured, dry-run mode, and a per-room minimum interval so a
 * runaway loop cannot spam a group full of people.
 */
/**
 * What the room writes for itself is not what Dominic reads on his phone.
 * The three markers and the `[#1282]` citations are a contract between
 * agents; on WhatsApp they are noise, so they come off here — the one place
 * every outbound message passes through — and nowhere else. The stored text
 * keeps them.
 */
export function forPhone(text: string): string {
  return text
    .replace(/^\s*kind:[^\n]*\n?/im, "")
    .replace(/\n?\s*@next:[^\n]*\s*$/im, "")
    .replace(/\s*\[#\d+\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([,.;:!?])/g, "$1")
    .trim();
}

export async function notify(
  roomId: string,
  rawText: string,
  opts: { force?: boolean; kind?: NotifyKind } = {},
): Promise<NotifyResult> {
  const text = forPhone(rawText);
  const jid = jidForRoom(roomId);
  const kind = opts.kind ?? "chatter";
  const { bin, args } = compose(text, jid);
  const command = `${bin} ${args
    .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
    .join(" ")}`;

  // Silenced by the room's own level, before anything else is considered.
  if (kind === "chatter" && levelForRoom(roomId) === "prompt") {
    console.log(`[notify] room ${roomId} is prompt-only, suppressing chatter`);
    return { delivered: false, reason: "suppressed", command };
  }

  if (jid.trim() === "") {
    console.log(`[notify] no JID configured, not sending. Would run:\n  ${command}`);
    return { delivered: false, reason: "no_jid", command };
  }

  const now = Date.now();
  const last = lastSentAt.get(roomId) ?? 0;
  const waitMs = config.notifyMinIntervalS * 1000 - (now - last);
  // The end-of-run report carries the prompt Dominic has to run. Throttling
  // that away would mean the one message that matters is the one he never gets.
  if (waitMs > 0 && !opts.force) {
    console.log(`[notify] rate limited for room ${roomId}, ${Math.ceil(waitMs / 1000)}s left`);
    return { delivered: false, reason: "rate_limited", command };
  }

  // Record the attempt BEFORE branching, so a dry run suppresses follow-ups
  // exactly as a live run would. A dry run that ignores the interval would
  // under-report how much a chatty room actually gets throttled.
  lastSentAt.set(roomId, now);

  // notifyIsLive() also tests the GLOBAL jid, which would wrongly force a dry
  // run for a room that has its own target while the global one is unset.
  // The per-room jid was already checked above, so only dry-run matters here.
  if (config.notifyDryRun) {
    console.log(`[notify] DRY RUN, not executing:\n  ${command}`);
    return { delivered: false, reason: "dry_run", command };
  }

  try {
    const { stdout, stderr } = await run(bin, args, { timeout: 30_000 });
    // The RESOLVED target, not the global. Logging config.notifyJid here made
    // every per-room send look like it had gone to the default group, which is
    // indistinguishable from the room routing being broken.
    console.log(`[notify] sent to ${jid}`);
    return {
      delivered: true,
      reason: "sent",
      command,
      detail: (stdout || stderr || "").trim().slice(0, 400),
    };
  } catch (err) {
    lastSentAt.delete(roomId); // a failure should not burn the interval
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[notify] FAILED: ${detail}`);
    return { delivered: false, reason: "failed", command, detail };
  }
}
