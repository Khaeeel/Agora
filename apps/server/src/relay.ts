export type RelayIntent = "new_run" | "status" | "cancel" | "context";

const MARKER = /^\[relayed via[^\]]*\]\s*/i;

export function classifyRelayText(text: string): RelayIntent {
  const body = text.replace(MARKER, "").trim();
  if (/^(status|any update\??)$/i.test(body)) return "status";
  if (/^(stop|cancel|\/stop|\/cancel)$/i.test(body)) return "cancel";
  if (/^(fyi|context)\s*:/i.test(body)) return "context";
  return "new_run";
}

/** Empty allowlist keeps today's behavior: the local socket is trusted. */
export function senderAllowed(sender: string | undefined, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  return sender !== undefined && allowlist.includes(sender);
}

export class InboundDedup {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  /** True the first time this key is seen inside the window. */
  accept(key: string, now: number): boolean {
    const prev = this.seen.get(key);
    if (prev !== undefined && now - prev < this.ttlMs) return false;
    this.seen.set(key, now);
    return true;
  }
}
