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
  /** When set, the driver returns validated structured output instead of prose. */
  schema?: object;
  signal: AbortSignal;
}

export type DriverEvent =
  | { type: "delta"; text: string }
  | { type: "rate_limit"; detail: string }
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
