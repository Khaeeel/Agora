export type AgentStatus = "active" | "processing" | "idle" | "offline";

export interface Agent {
  /** Slug derived from the filename, e.g. "atlas". */
  id: string;
  name: string;
  role: string;
  description: string;
  instructions: string;
  personality: string;
  color: string;
  model: string;
  effort: string;
  /** Empty array = chat-only: no file access, no permission prompts. */
  tools: string[];
  addDirs: string[];
  /** MCP servers this agent may use, e.g. ["chrome-devtools"]. */
  mcp: string[];
  /** Exactly one agent per room drives turn order. */
  orchestrator: boolean;
  /** Absolute path of the .md this was parsed from. */
  file: string;
}

export type MessageKind = "human" | "agent" | "notice" | "notify" | "handoff";

export interface Message {
  id: string;
  roomId: string;
  /** Agent id, or "human", or "system" for notices. */
  authorId: string;
  kind: MessageKind;
  text: string;
  /** Which agent directed this turn — the provenance the mock was missing. */
  directedBy: string | null;
  createdAt: number;
  costUsd: number | null;
  /** Set on notify rows: whether it actually left the machine. */
  delivered: boolean | null;
}

export interface Room {
  id: string;
  name: string;
  topic: string;
  /** Agent ids participating, in display order. */
  members: string[];
  orchestratorId: string;
  createdAt: number;
}

export type GoalStatus = "active" | "done" | "stopped";
export type StepStatus = "pending" | "active" | "done" | "blocked" | "skipped";

export interface Step {
  id: string;
  goalId: string;
  idx: number;
  title: string;
  /** The agent expected to carry it out. */
  ownerId: string | null;
  status: StepStatus;
  note: string | null;
  updatedAt: number;
}

export interface Goal {
  id: string;
  roomId: string;
  title: string;
  status: GoalStatus;
  createdAt: number;
  endedAt: number | null;
  costUsd: number;
  /** The paste-ready prompt for Dominic. Null until the goal produces one. */
  handoff: string | null;
  /** Manual steps to see the problem first-hand, before trusting the diagnosis. */
  verify: string | null;
  steps: Step[];
}

export interface RunState {
  roomId: string;
  active: boolean;
  turn: number;
  maxTurns: number;
  startedAt: number;
  /** Agent currently generating, if any. */
  speaking: string | null;
  costUsd: number;
  stopReason: string | null;
  /** The goal this run is working toward, if a plan was produced. */
  goalId: string | null;
}

/** Everything the server pushes down the WebSocket. */
export type ServerEvent =
  | { type: "hello"; rooms: Room[]; agents: Agent[]; notifyLive: boolean }
  | { type: "agents"; agents: Agent[] }
  | { type: "rooms"; rooms: Room[] }
  | { type: "message"; message: Message }
  | { type: "turn_start"; roomId: string; agentId: string; directedBy: string | null; turn: number }
  | { type: "delta"; roomId: string; agentId: string; text: string }
  | { type: "turn_end"; roomId: string; agentId: string }
  | { type: "run"; state: RunState }
  | { type: "goal"; goal: Goal }
  | { type: "status"; statuses: Record<string, AgentStatus> }
  | { type: "rate_limit"; roomId: string; detail: string }
  | { type: "error"; roomId: string | null; detail: string };

export type ClientCommand =
  | { type: "broadcast"; roomId: string; text: string }
  | { type: "stop"; roomId: string }
  | { type: "subscribe"; roomId: string };
