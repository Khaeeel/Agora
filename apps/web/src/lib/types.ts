export type AgentStatus = "active" | "processing" | "idle" | "offline";
export type MessageKind = "human" | "agent" | "notice" | "notify" | "handoff";

export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  instructions: string;
  personality: string;
  color: string;
  model: string;
  effort: string;
  tools: string[];
  addDirs: string[];
  orchestrator: boolean;
  file: string;
}

export interface Message {
  id: string;
  roomId: string;
  authorId: string;
  kind: MessageKind;
  text: string;
  directedBy: string | null;
  createdAt: number;
  costUsd: number | null;
  delivered: boolean | null;
}

export interface Room {
  id: string;
  name: string;
  topic: string;
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
  /** Manual steps to see the problem first-hand. */
  verify: string | null;
  steps: Step[];
}

export interface RunState {
  roomId: string;
  active: boolean;
  turn: number;
  maxTurns: number;
  startedAt: number;
  speaking: string | null;
  costUsd: number;
  stopReason: string | null;
  goalId: string | null;
}

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
