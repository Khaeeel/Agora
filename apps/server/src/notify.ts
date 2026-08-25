import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config, notifyIsLive } from "./config.ts";

const run = promisify(execFile);

const lastSentAt = new Map<string, number>();

export interface NotifyResult {
  delivered: boolean;
  reason: "sent" | "no_jid" | "dry_run" | "rate_limited" | "failed";
  command: string;
  detail?: string;
}

function compose(text: string): { bin: string; args: string[] } {
  return {
    bin: config.openclawBin,
    args: [
      "message",
      "send",
      "--channel",
      "whatsapp",
      "--target",
      config.notifyJid,
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
export async function notify(
  roomId: string,
  text: string,
  opts: { force?: boolean } = {},
): Promise<NotifyResult> {
  const { bin, args } = compose(text);
  const command = `${bin} ${args
    .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
    .join(" ")}`;

  if (config.notifyJid.trim() === "") {
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

  if (!notifyIsLive()) {
    console.log(`[notify] DRY RUN, not executing:\n  ${command}`);
    return { delivered: false, reason: "dry_run", command };
  }

  try {
    const { stdout, stderr } = await run(bin, args, { timeout: 30_000 });
    console.log(`[notify] sent to ${config.notifyJid}`);
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
