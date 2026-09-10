/**
 * Model choices for the Create/Edit Agent form.
 *
 * Claude Code and Cursor Agent do not share an id space: Cursor has no haiku,
 * bakes effort into the model id (`claude-sonnet-5-low`), and offers `auto`.
 * The form must follow `AGORA_DRIVER`, otherwise the UI offers models the
 * running CLI cannot take.
 */
export type AgentModelChoice = { id: string; label: string };

export const CLAUDE_AGENT_MODELS: AgentModelChoice[] = [
  { id: "claude-opus-5", label: "claude-opus-5" },
  { id: "claude-sonnet-5", label: "claude-sonnet-5" },
  { id: "claude-haiku-4-5", label: "claude-haiku-4-5" },
];

export const CLAUDE_AGENT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const EFFORTS = new Set<string>(CLAUDE_AGENT_EFFORTS);

/** Bare Claude Code ids — Cursor rejects these without an effort suffix. */
const BARE_CLAUDE = /^claude-(?:opus|sonnet|haiku|fable)-[\d.]+$/;

/**
 * Map an agent frontmatter (model, effort) pair onto a Cursor CLI `--model` id.
 * Claude-style files stay portable; under the Cursor driver they become
 * `claude-sonnet-5-medium` etc. Ids that already carry effort (or are
 * Composer / auto / bracket overrides) pass through.
 */
export function toCursorModelId(
  model: string,
  effort: string,
  fallback = "auto",
): string {
  const m = model.trim();
  if (!m) return fallback.trim() || "auto";
  if (m === "auto" || m.includes("[")) return m;

  const parts = m.split("-");
  const last = parts[parts.length - 1] ?? "";
  const prev = parts[parts.length - 2] ?? "";
  if (EFFORTS.has(last)) return m;
  if (last === "fast" && EFFORTS.has(prev)) return m;

  if (BARE_CLAUDE.test(m)) {
    const e = EFFORTS.has(effort) ? effort : "medium";
    return `${m}-${e}`;
  }
  return m;
}

/**
 * Curated Cursor ids — effort is already in the name where it matters.
 * Full catalog: `cursor-agent models`. Keep this short for the form.
 */
export const CURSOR_AGENT_MODELS: AgentModelChoice[] = [
  { id: "auto", label: "auto (Pro+ seat, no API spend)" },
  { id: "composer-2.5", label: "composer-2.5" },
  { id: "composer-2.5-fast", label: "composer-2.5-fast" },
  { id: "claude-sonnet-5-medium", label: "claude-sonnet-5-medium (API)" },
  { id: "claude-sonnet-5-thinking-high", label: "claude-sonnet-5-thinking-high (API)" },
  { id: "claude-opus-5-high", label: "claude-opus-5-high (API)" },
  { id: "claude-opus-5-thinking-high", label: "claude-opus-5-thinking-high (API)" },
  { id: "gpt-5.3-codex", label: "gpt-5.3-codex (API)" },
  { id: "gpt-5.3-codex-high", label: "gpt-5.3-codex-high (API)" },
  { id: "cursor-grok-4.6-high", label: "cursor-grok-4.6-high (API)" },
  { id: "gemini-3.7-flash-high", label: "gemini-3.7-flash-high (API)" },
];

export function agentModelsForDriver(driver: string): {
  models: AgentModelChoice[];
  /** Cursor bakes effort into the model id; the separate effort field is unused. */
  effortEnabled: boolean;
  defaultModel: string;
  defaultEffort: string;
} {
  if (driver === "cursor" || driver === "hybrid") {
    return {
      models: CURSOR_AGENT_MODELS,
      effortEnabled: false,
      defaultModel: "auto",
      defaultEffort: "n/a",
    };
  }
  return {
    models: CLAUDE_AGENT_MODELS,
    effortEnabled: true,
    defaultModel: "claude-sonnet-5",
    defaultEffort: "low",
  };
}
