export type AgentStatus = "active" | "processing" | "idle" | "offline";

/**
 * What kind of turn a message was, declared by its `kind:` first line.
 *
 * Lives here rather than beside the protocol text because it is persisted — it
 * is a column on `messages`, and this file is where the shapes that reach the
 * database and the UI are defined. `protocol.ts` imports it.
 */
export type SpeechAct = "claim" | "question" | "result" | "pass";

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
  /** Permission grants, e.g. ["WebFetch(domain:docs.bland.ai)"]. */
  allow: string[];
  /** MCP config files to load, relative to the project root. */
  mcpConfigs: string[];
  /** Exactly one agent per room drives turn order. */
  orchestrator: boolean;
  /** Absolute path of the .md this was parsed from. */
  file: string;
}

/** One option on a question the room is putting to Dominic. */
export interface Choice {
  /** What the button says. Short — it is the decision, not the reasoning. */
  label: string;
  /** One line under it: what picking this actually means. */
  detail: string;
}

export type MessageKind = "human" | "agent" | "notice" | "notify" | "handoff" | "event";

export interface Message {
  id: string;
  roomId: string;
  /**
   * Monotonic position within its room, starting at 1.
   *
   * `created_at` cannot do this job: it is a wall-clock millisecond, two
   * messages can share one, and it is not a stable name a model can cite.
   * Agents refer to messages as `[#1281]`, and an agent's own last turn is
   * remembered as a seq, so the split between what it has already read and what
   * is new is an integer comparison rather than a timestamp guess.
   */
  seq: number;
  /** Agent id, or "human", or "system" for notices. */
  authorId: string;
  kind: MessageKind;
  text: string;
  /** Which agent directed this turn — the provenance the mock was missing. */
  directedBy: string | null;
  createdAt: number;
  costUsd: number | null;
  /** Wall time for this turn, when known. */
  durationMs: number | null;
  /** Set on notify rows: whether it actually left the machine. */
  delivered: boolean | null;
  /** Options to click, when this message asks Dominic to decide. */
  choices: Choice[] | null;
  /** The label he picked, once he has. Null while the question is open. */
  answeredWith: string | null;
  /**
   * Which version of the L0 protocol produced this turn. Null on rows written
   * before the protocol was emitted from code — those ran under the old prose
   * and should not be read as conforming to any version.
   */
  protocolVersion: number | null;
  /**
   * The speech act this turn declared: claim, question, result or pass.
   *
   * Named `act` rather than `kind` because `kind` above is already the row's
   * type — human, agent, notice and so on. Two different axes, two columns.
   * Null when the message carried no `kind:` line, which is how the miss rate
   * stays measurable.
   */
  act: SpeechAct | null;
  /** Seqs this message cited with `[#nnn]`. Empty array opens a new thread. */
  refs: number[];
  /** Who the author says should go next, or "none". Null when unstated. */
  nextId: string | null;
  /**
   * Short sha1 of the exact system prompt (L0 + room rules + agent file) this
   * turn ran under. "Before and after this prompt edit" is a GROUP BY on it.
   * Null on rows the system wrote on an agent's behalf.
   */
  promptSha: string | null;
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

/** A room's compacted long-term memory. */
export interface MindStone {
  roomId: string;
  content: string;
  coveredTo: number;
  messages: number;
  updatedAt: number;
  revisions: number;
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

/** What a live run is doing right now — drives the monitoring strip. */
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
  /** Agent currently generating, if any. */
  speaking: string | null;
  costUsd: number;
  stopReason: string | null;
  /** The goal this run is working toward, if a plan was produced. */
  goalId: string | null;
  /** Current phase of the run loop. null when inactive. */
  phase: RunPhase | null;
  /** Extra context: rate-limit detail, tool name, slot wait, etc. */
  phaseDetail: string | null;
  /** Wall-clock budget for the whole run (ms). */
  timeoutMs: number;
  /** When the current turn began. */
  turnStartedAt: number | null;
  /** Duration of the last finished turn (ms). */
  lastTurnMs: number | null;
  /** Cost of the last finished turn. */
  lastTurnCostUsd: number | null;
}

/** Everything the server pushes down the WebSocket. */
export type ServerEvent =
  | { type: "hello"; rooms: Room[]; agents: Agent[]; notifyLive: boolean }
  | { type: "agents"; agents: Agent[] }
  | { type: "rooms"; rooms: Room[] }
  | { type: "message"; message: Message }
  /** An existing message changed in place — a question got answered. */
  | { type: "message_update"; message: Message }
  | { type: "turn_start"; roomId: string; agentId: string; directedBy: string | null; turn: number }
  | { type: "delta"; roomId: string; agentId: string; text: string }
  | { type: "turn_end"; roomId: string; agentId: string }
  | { type: "run"; state: RunState }
  /** Snapshot of every live (and just-ended) run — for the cross-room board. */
  | { type: "runs"; runs: RunState[] }
  | { type: "goal"; goal: Goal }
  | { type: "mind_stone"; roomId: string; stone: MindStone }
  | { type: "status"; statuses: Record<string, AgentStatus> }
  | { type: "rate_limit"; roomId: string; detail: string }
  | { type: "error"; roomId: string | null; detail: string };

export type ClientCommand =
  | { type: "broadcast"; roomId: string; text: string }
  | { type: "stop"; roomId: string }
  /** Carry on with an existing goal instead of planning a new one. */
  | { type: "resume"; roomId: string; goalId: string }
  /** Dominic tapped one of the options on a question the room asked. */
  | { type: "answer"; roomId: string; messageId: string; label: string }
  | { type: "subscribe"; roomId: string };
