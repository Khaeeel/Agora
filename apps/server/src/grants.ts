/**
 * Grant checks that do not depend on the filesystem. The orchestrator still
 * resolves real paths; these functions are the rules it is not allowed to skip.
 */

/** Prompt text never becomes a tool grant. The return is always empty. */
export function toolsClaimedByPrompt(_text: string): readonly string[] {
  return [];
}

export function directoryAllowed(target: string, allowDirs: readonly string[]): boolean {
  const real = target.replace(/\\/g, "/").replace(/\/$/, "");
  return allowDirs.some((dir) => {
    const root = dir.replace(/\\/g, "/").replace(/\/$/, "");
    return real === root || real.startsWith(root + "/");
  });
}

/**
 * Agent files sit at `agents/<id>.md` or `agents/<room>/<id>.md`.
 * Anything deeper, or a path that climbs, is refused.
 */
export function agentEditAllowed(relativePath: string): { ok: true } | { ok: false; reason: string } {
  if (relativePath.includes("\0")) return { ok: false, reason: "path contains a null" };
  const parts = relativePath.split(/[\\/]/).filter((part) => part.length > 0);
  if (parts.some((part) => part === "." || part === "..")) {
    return { ok: false, reason: "path climbs out of agents/" };
  }
  if (parts.length < 1 || parts.length > 2) {
    return { ok: false, reason: "agent files are at most one folder deep" };
  }
  const file = parts[parts.length - 1] ?? "";
  if (!file.endsWith(".md")) return { ok: false, reason: "agent files are markdown" };
  return { ok: true };
}

export interface GrantChange {
  agentId: string;
  field: "tools" | "addDirs" | "allow";
  before: readonly string[];
  after: readonly string[];
}

export function grantAudit(change: GrantChange): {
  event: "grant_change";
  agentId: string;
  field: GrantChange["field"];
  added: string[];
  removed: string[];
} {
  const before = new Set(change.before);
  const after = new Set(change.after);
  return {
    event: "grant_change",
    agentId: change.agentId,
    field: change.field,
    added: change.after.filter((item) => !before.has(item)),
    removed: change.before.filter((item) => !after.has(item)),
  };
}
