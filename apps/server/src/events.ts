import type { ClientCommand } from "./types.ts";

const COMMANDS = new Set(["broadcast", "stop", "resume", "answer", "subscribe"]);

/** Drop malformed socket payloads. A bad frame never becomes a run. */
export function parseClientCommand(raw: string): ClientCommand | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec["type"] !== "string" || !COMMANDS.has(rec["type"])) return null;
  if (typeof rec["roomId"] !== "string" || rec["roomId"].trim() === "") return null;
  if (rec["type"] === "broadcast" && typeof rec["text"] !== "string") return null;
  if (rec["type"] === "resume" && typeof rec["goalId"] !== "string") return null;
  if (rec["type"] === "answer") {
    if (typeof rec["messageId"] !== "string" || typeof rec["label"] !== "string") return null;
  }
  return rec as unknown as ClientCommand;
}

/** Per-room message order. Duplicates and rewinds are rejected. Gaps are named, not applied. */
export function checkSequence(previous: number | null, seq: number): "ok" | "duplicate" | "rewind" | "gap" {
  if (!Number.isInteger(seq) || seq < 1) return "rewind";
  if (previous === null) return seq === 1 ? "ok" : "gap";
  if (seq === previous) return "duplicate";
  if (seq < previous) return "rewind";
  if (seq > previous + 1) return "gap";
  return "ok";
}
