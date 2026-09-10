export type AgentStatus = "active" | "processing" | "idle" | "offline";
/** One option on a question the room is putting to Dominic. */
export interface Choice {
  /** What the button says. Short — it is the decision, not the reasoning. */
  label: string;
  /** One line under it: what picking this actually means. */
  detail: string;
}

export type MessageKind = "human" | "agent" | "notice" | "notify" | "handoff" | "event";

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
  mcp: string[];
  allow: string[];
  orchestrator: boolean;
  file: string;
  /** Set when an orchestrator forged this agent from a template. */
  forgedBy?: string | null;
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
  durationMs: number | null;
  delivered: boolean | null;
  /** Options to click, when this message asks Dominic to decide. */
  choices: Choice[] | null;
  /** The label he picked, once he has. Null while the question is open. */
  answeredWith: string | null;
  /** Which CLI produced it: "claude-cli" | "cursor-cli". Null for human and system rows. */
  driver: string | null;
  /** Parsed markers: the speech act and who the author handed to. */
  act?: string | null;
  nextId?: string | null;
}

export interface Room {
  id: string;
  name: string;
  topic: string;
  members: string[];
  orchestratorId: string;
  createdAt: number;
}

/** A room's compacted long-term memory — what survives past the transcript window. */
export interface MindStone {
  roomId: string;
  content: string;
  /** created_at of the newest message folded in. */
  coveredTo: number;
  /** How many messages the stone has absorbed in total. */
  messages: number;
  updatedAt: number;
  revisions: number;
}

/**
 * How much an agent has said in a room, for its whole life — not just the
 * 500-message window the transcript ships. Server-computed on purpose: counting
 * from `messages` would make an agent shrink once the room outgrew the window.
 */
export interface AgentMemory {
  messages: number;
  chars: number;
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
  /** Steps this one waits for; empty = can start at once. */
  dependsOn?: number[];
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

export type RunPhase =
  | "planning"
  | "deciding"
  | "waiting_slot"
  | "generating"
  | "rate_limited"
  /** Folding the room transcript into its mind stone after a run. */
  | "compacting";

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
  phase: RunPhase | null;
  phaseDetail: string | null;
  timeoutMs: number;
  turnStartedAt: number | null;
  lastTurnMs: number | null;
  lastTurnCostUsd: number | null;
  driver: string | null;
}

export type ServerEvent =
  | {
      type: "hello";
      rooms: Room[];
      agents: Agent[];
      notifyLive: boolean;
      driver?: string;
      agentModels?: Array<{ id: string; label: string }>;
      effortEnabled?: boolean;
      defaultModel?: string;
      defaultEffort?: string;
    }
  | { type: "agents"; agents: Agent[] }
  | { type: "rooms"; rooms: Room[] }
  | { type: "message"; message: Message }
  /** An existing message changed in place — a question got answered. */
  | { type: "message_update"; message: Message }
  | { type: "turn_start"; roomId: string; agentId: string; directedBy: string | null; turn: number }
  | { type: "delta"; roomId: string; agentId: string; text: string }
  | { type: "turn_end"; roomId: string; agentId: string }
  | { type: "run"; state: RunState }
  | { type: "runs"; runs: RunState[] }
  | { type: "goal"; goal: Goal }
  | { type: "mind_stone"; roomId: string; stone: MindStone }
  | { type: "status"; statuses: Record<string, AgentStatus> }
  | { type: "rate_limit"; roomId: string; detail: string }
  | { type: "error"; roomId: string | null; detail: string };
