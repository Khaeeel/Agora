export interface DriverRequest {
  systemPrompt: string;
  /** The full prompt for this turn: room transcript + the instruction. */
  prompt: string;
  model: string;
  effort: string;
  /** Empty = chat-only (`--tools ""`), which needs no permissions. */
  tools: string[];
  addDirs: string[];
  /** MCP server ids, e.g. ["chrome-devtools"], granted via --allowedTools. */
  mcp: string[];
  /**
   * Paths to MCP server config files, passed as --mcp-config.
   * Needed for stdio servers the CLI does not already know about. Scoped per
   * agent rather than registered globally, so a server is only spawned for the
   * agents that actually use it.
   */
  mcpConfigs: string[];
  /**
   * Explicit permission patterns, e.g. WebFetch(domain:docs.bland.ai).
   * `--tools` says a tool EXISTS; this says it may be used without a prompt —
   * and in print mode an unanswered prompt is a silent denial.
   */
  allow: string[];
  /** When set, the driver returns validated structured output instead of prose. */
  schema?: object;
  /**
   * What kind of turn this is: planning | deciding | generating | compacting.
   * The Claude driver ignores it — one model serves every phase there. The
   * Cursor driver routes on it: its cheap default is worth taking for ordinary
   * turns but not for the plan the whole run is then measured against.
   */
  phase?: string;
  /**
   * Working directory of the spawned CLI. The repo root by default; an agent
   * holding Write or Edit runs inside its first add_dir instead, so the one
   * folder it can change is the one Dominic opened — never the agora repo.
   */
  cwd?: string;
  signal: AbortSignal;
}

export type DriverEvent =
  | { type: "delta"; text: string }
  | { type: "rate_limit"; detail: string }
  /** An agent invoked a tool — surfaced so the UI can show what it's doing. */
  | { type: "tool_use"; name: string }
  | {
      type: "final";
      text: string;
      structured: unknown | null;
      costUsd: number | null;
      isError: boolean;
    };

export interface AgentDriver {
  readonly id: string;
  run(req: DriverRequest): AsyncIterable<DriverEvent>;
}
