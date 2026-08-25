import { config } from "./config.ts";
import {
  addMessage,
  closeGoal,
  createGoal,
  getGoal,
  getRoom,
  listMessages,
  setGoalHandoff,
  updateStep,
} from "./db.ts";
import { buildSystemPrompt } from "./agents/registry.ts";
import { ClaudeCliDriver } from "./drivers/claude-cli.ts";
import { notify } from "./notify.ts";
import type { Agent, Goal, Message, RunState, ServerEvent, StepStatus } from "./types.ts";

/**
 * The plan the orchestrator commits to before any work starts. Producing it up
 * front is what makes progress monitorable — without it there is nothing to
 * measure a run against except how many turns it has burned.
 */
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    goal: {
      type: "string",
      description: "The goal in one line, as an outcome rather than an activity.",
    },
    steps: {
      type: "array",
      description:
        "Between 2 and 6 steps, in dependency order. Each is checkable — someone can say plainly whether it is done. Do not include 'report back' or 'summarise' as steps.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "One line, starts with a verb." },
          owner: {
            type: ["string", "null"],
            description: "The id of the agent who should do it, or null if unassigned.",
          },
        },
        required: ["title", "owner"],
        additionalProperties: false,
      },
    },
  },
  required: ["goal", "steps"],
  additionalProperties: false,
} as const;

interface Plan {
  goal: string;
  steps: Array<{ title: string; owner: string | null }>;
}

/** The orchestrator's one structured decision per turn. */
const DECISION_SCHEMA = {
  type: "object",
  properties: {
    say: {
      type: "string",
      description: "What you say out loud in the room. One short message.",
    },
    next: {
      type: ["string", "null"],
      description:
        "The id of the agent who should act next, or null if the work is finished.",
    },
    step: {
      type: ["object", "null"],
      description:
        "Report the state of ONE plan step this turn, so progress stays visible. null if no step changed.",
      properties: {
        index: { type: "number", description: "0-based index into the plan." },
        status: {
          type: "string",
          enum: ["active", "done", "blocked"],
          description:
            "active = being worked on now. done = genuinely finished. blocked = cannot proceed, say why in note.",
        },
        note: {
          type: ["string", "null"],
          description: "Short reason, required when blocked.",
        },
      },
      required: ["index", "status", "note"],
      additionalProperties: false,
    },
    verify: {
      type: ["string", "null"],
      description:
        "REQUIRED alongside handoff when a bug is being reported. Numbered steps Dominic can follow in the UI to see the problem with his own eyes — which screen, which control, what to click, what he should see versus what actually appears. Concrete clicks, never 'test the filter'. Null only when there is no observable bug.",
    },
    handoff: {
      type: ["string", "null"],
      description:
        "REQUIRED when you set next to null and the work involves changing code. The exact prompt Dominic pastes into Claude CLI: the task, the files involved, the acceptance criteria, and an instruction to run the relevant tests and typecheck before claiming done. Plain text, no surrounding commentary. Null only when nothing needs changing.",
    },
    notify: {
      type: ["object", "null"],
      description:
        "Set only when a human genuinely needs this on their phone. Otherwise null.",
      properties: {
        headline: { type: "string" },
        detail: { type: "string" },
      },
      required: ["headline", "detail"],
      additionalProperties: false,
    },
  },
  required: ["say", "next", "step", "verify", "handoff", "notify"],
  additionalProperties: false,
} as const;

interface Decision {
  say: string;
  next: string | null;
  step: { index: number; status: StepStatus; note: string | null } | null;
  verify: string | null;
  handoff: string | null;
  notify: { headline: string; detail: string } | null;
}

/** Caps how many `claude` processes exist at once across the whole server. */
class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }
}

function renderTranscript(messages: Message[], agents: Map<string, Agent>): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.kind === "human") lines.push(`[Dominic]: ${m.text}`);
    else if (m.kind === "agent") {
      const a = agents.get(m.authorId);
      lines.push(`[${a?.name ?? m.authorId}]: ${m.text}`);
    } else if (m.kind === "notify") {
      lines.push(`(pushed to WhatsApp: ${m.text})`);
    }
  }
  return lines.join("\n");
}

/**
 * The message that lands on Dominic's phone when a run ends.
 *
 * The handoff prompt is the deliverable — nobody here edits code — so it has to
 * arrive here, not sit in a tab he has to remember to open. WhatsApp renders
 * ``` blocks as monospace, which makes the prompt copyable in one press.
 */
function buildRunReport(goal: Goal, agents: Map<string, Agent>): string {
  const done = goal.steps.filter((s) => s.status === "done").length;
  const blocked = goal.steps.filter((s) => s.status === "blocked");
  const missed = goal.steps.filter((s) => s.status === "skipped");

  const head =
    goal.status === "done"
      ? `✅ Done — ${goal.title}`
      : `⚠️ Ended incomplete — ${goal.title}`;

  const lines = [head, "", `${done} of ${goal.steps.length} steps done.`];

  for (const s of blocked) {
    const owner = s.ownerId ? agents.get(s.ownerId) : undefined;
    lines.push(
      `⛔ Blocked${owner ? ` (${owner.name}, ${owner.role})` : ""}: ${s.title}` +
        (s.note ? `\n   ${s.note}` : ""),
    );
  }
  if (missed.length > 0) {
    lines.push(`↷ Never reached: ${missed.length} step${missed.length === 1 ? "" : "s"}.`);
  }

  // Steps come BEFORE the prompt: see it yourself, then decide to fix it.
  // A prompt with no way to check the claim is asking Dominic to take it on trust.
  if (goal.verify) {
    lines.push("", "👀 *See it yourself first:*", goal.verify.trim());
  }

  if (goal.handoff) {
    lines.push("", "Paste this into Claude CLI:", "```", goal.handoff.trim(), "```");
  } else {
    lines.push("", "No prompt produced — nothing actionable came out of this run.");
  }

  lines.push("", `$${goal.costUsd.toFixed(4)}`);
  return lines.join("\n");
}

/**
 * Expand bare agent names into "Name (Role)" for anything leaving the app.
 * On a phone, "T-Bag says X" is meaningless until you remember who T-Bag is —
 * "T-Bag (QA Analyst) says X" is readable at a glance. Done here rather than by
 * asking the model nicely, so it holds every time.
 */
function withRoles(text: string, roster: Agent[]): string {
  let out = text;
  for (const a of roster) {
    // Skip if already followed by a parenthesis — don't produce "T-Bag (QA) (QA)".
    const pattern = new RegExp(
      `\\b${a.name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\b(?!\\s*\\()`,
      "g",
    );
    out = out.replace(pattern, `${a.name} (${a.role})`);
  }
  return out;
}

/** The live plan, rendered back into the orchestrator's prompt each turn. */
function planText(goalId: string | null): string {
  if (!goalId) return "";
  const goal = getGoal(goalId);
  if (!goal || goal.steps.length === 0) return "";
  const lines = goal.steps.map((s) => {
    const mark =
      s.status === "done"
        ? "[x]"
        : s.status === "active"
          ? "[~]"
          : s.status === "blocked"
            ? "[!]"
            : "[ ]";
    const owner = s.ownerId ? ` (${s.ownerId})` : "";
    const note = s.note ? ` — ${s.note}` : "";
    return `${mark} ${s.idx}. ${s.title}${owner}${note}`;
  });
  return [`Your plan for "${goal.title}":`, ...lines, ""].join("\n");
}

function resolveNext(raw: string | null, members: Agent[]): Agent | null {
  if (raw == null) return null;
  const needle = raw.trim().toLowerCase();
  if (!needle || needle === "null" || needle === "none" || needle === "done") return null;
  return (
    members.find((a) => a.id === needle) ??
    members.find((a) => a.name.toLowerCase() === needle) ??
    null
  );
}

export type Emit = (event: ServerEvent) => void;

export class Orchestrator {
  private readonly driver = new ClaudeCliDriver();
  private readonly gate = new Semaphore(config.maxConcurrency);
  private readonly runs = new Map<string, { abort: AbortController; state: RunState }>();

  private readonly emit: Emit;
  private readonly getAgents: () => Map<string, Agent>;

  constructor(emit: Emit, getAgents: () => Map<string, Agent>) {
    this.emit = emit;
    this.getAgents = getAgents;
  }

  isRunning(roomId: string): boolean {
    return this.runs.has(roomId);
  }

  stop(roomId: string): boolean {
    const run = this.runs.get(roomId);
    if (!run) return false;
    run.state.stopReason = "stopped";
    run.abort.abort();
    return true;
  }

  getState(roomId: string): RunState | null {
    return this.runs.get(roomId)?.state ?? null;
  }

  private post(input: Parameters<typeof addMessage>[0]): Message {
    const message = addMessage(input);
    this.emit({ type: "message", message });
    return message;
  }

  private publishRun(state: RunState): void {
    this.emit({ type: "run", state: { ...state } });
  }

  /** Run one agent turn, streaming deltas out as they arrive. */
  private async runTurn(opts: {
    agent: Agent;
    roomName: string;
    roster: Agent[];
    prompt: string;
    schema?: object;
    signal: AbortSignal;
    roomId: string;
  }): Promise<{
    text: string;
    structured: unknown;
    costUsd: number | null;
    isError: boolean;
    timedOut: boolean;
  }> {
    const release = await this.gate.acquire();

    // Per-turn deadline, nested inside the run's signal. One slow agent should
    // fail its own turn — not take the whole run down with it.
    const turnAbort = new AbortController();
    let timedOut = false;
    const onRunAbort = (): void => turnAbort.abort();
    opts.signal.addEventListener("abort", onRunAbort, { once: true });
    const turnTimer = setTimeout(() => {
      timedOut = true;
      turnAbort.abort();
    }, config.turnTimeoutMs);

    try {
      let text = "";
      let structured: unknown = null;
      let costUsd: number | null = null;
      let isError = false;

      for await (const event of this.driver.run({
        systemPrompt: buildSystemPrompt(opts.agent, opts.roomName, opts.roster),
        prompt: opts.prompt,
        model: opts.agent.model,
        effort: opts.agent.effort,
        tools: opts.agent.tools,
        addDirs: opts.agent.addDirs,
        mcp: opts.agent.mcp,
        ...(opts.schema ? { schema: opts.schema } : {}),
        signal: turnAbort.signal,
      })) {
        if (event.type === "delta") {
          // Structured turns stream tool-call JSON, which is noise on screen.
          if (!opts.schema) {
            this.emit({
              type: "delta",
              roomId: opts.roomId,
              agentId: opts.agent.id,
              text: event.text,
            });
          }
        } else if (event.type === "rate_limit") {
          this.emit({ type: "rate_limit", roomId: opts.roomId, detail: event.detail });
        } else {
          text = event.text;
          structured = event.structured;
          costUsd = event.costUsd;
          isError = event.isError;
        }
      }
      return { text, structured, costUsd, isError, timedOut };
    } finally {
      clearTimeout(turnTimer);
      opts.signal.removeEventListener("abort", onRunAbort);
      release();
    }
  }

  async start(roomId: string, humanText: string): Promise<void> {
    if (this.runs.has(roomId)) {
      this.emit({ type: "error", roomId, detail: "A run is already active in this room." });
      return;
    }

    const room = getRoom(roomId);
    if (!room) {
      this.emit({ type: "error", roomId, detail: "Room not found." });
      return;
    }

    const agents = this.getAgents();
    const roster = room.members
      .map((id) => agents.get(id))
      .filter((a): a is Agent => a !== undefined);

    const orchestrator = agents.get(room.orchestratorId);
    if (!orchestrator) {
      this.emit({
        type: "error",
        roomId,
        detail: `Orchestrator "${room.orchestratorId}" is not a known agent.`,
      });
      return;
    }

    this.post({ roomId, authorId: "human", kind: "human", text: humanText });

    const abort = new AbortController();
    const state: RunState = {
      roomId,
      goalId: null,
      active: true,
      turn: 0,
      maxTurns: config.maxTurns,
      startedAt: Date.now(),
      speaking: null,
      costUsd: 0,
      stopReason: null,
    };
    this.runs.set(roomId, { abort, state });
    this.publishRun(state);

    const deadline = setTimeout(() => {
      state.stopReason = "timeout";
      abort.abort();
    }, config.runTimeoutMs);

    try {
      // --- plan first, so progress is measurable against something ----------
      state.speaking = orchestrator.id;
      this.publishRun(state);
      this.emit({
        type: "turn_start",
        roomId,
        agentId: orchestrator.id,
        directedBy: null,
        turn: 0,
      });

      const planResult = await this.runTurn({
        agent: orchestrator,
        roomName: room.name,
        roster,
        roomId,
        schema: PLAN_SCHEMA,
        signal: abort.signal,
        prompt: [
          `Dominic has asked for this:`,
          "---",
          humanText,
          "---",
          "",
          `Agents you can assign:`,
          roster
            .filter((a) => a.id !== orchestrator.id)
            .map((a) => `- ${a.id}: ${a.name}, ${a.role}`)
            .join("\n") || "(none)",
          "",
          `Break this into the smallest set of checkable steps that would satisfy it.`,
          `If it is a single question rather than a piece of work, one step is correct.`,
        ].join("\n"),
      });
      this.emit({ type: "turn_end", roomId, agentId: orchestrator.id });
      if (planResult.costUsd) state.costUsd += planResult.costUsd;

      if (!abort.signal.aborted && planResult.structured) {
        const plan = planResult.structured as Plan;
        const steps = (plan.steps ?? []).slice(0, 12).map((s) => ({
          title: s.title,
          ownerId: resolveNext(s.owner, roster)?.id ?? null,
        }));
        if (steps.length > 0) {
          const goal = createGoal({ roomId, title: plan.goal, steps });
          state.goalId = goal.id;
          this.emit({ type: "goal", goal });
          this.publishRun(state);
        }
      }

      while (!abort.signal.aborted) {
        if (state.turn >= config.maxTurns) {
          state.stopReason = "turn_cap";
          this.post({
            roomId,
            authorId: "system",
            kind: "notice",
            text: `Turn cap reached (${config.maxTurns}). Run stopped.`,
          });
          break;
        }
        state.turn++;

        // --- orchestrator decides -------------------------------------------
        state.speaking = orchestrator.id;
        this.publishRun(state);
        this.emit({
          type: "turn_start",
          roomId,
          agentId: orchestrator.id,
          directedBy: null,
          turn: state.turn,
        });

        const transcript = renderTranscript(
          listMessages(roomId, config.transcriptWindow),
          agents,
        );
        const rosterText = roster
          .filter((a) => a.id !== orchestrator.id)
          .map((a) => `- ${a.id}: ${a.name}, ${a.role}`)
          .join("\n");

        const decisionResult = await this.runTurn({
          agent: orchestrator,
          roomName: room.name,
          roster,
          roomId,
          schema: DECISION_SCHEMA,
          signal: abort.signal,
          prompt: [
            `Room transcript so far:`,
            "---",
            transcript || "(empty)",
            "---",
            "",
            planText(state.goalId),
            `Agents you can assign:`,
            rosterText || "(none)",
            "",
            `Decide the next step. Turn ${state.turn} of ${config.maxTurns}.`,
            `Report the state of one plan step in "step" so progress stays visible.`,
            `Only mark a step done when it genuinely is. Blocked is an honest answer.`,
            `Set next to null the moment the request is satisfied.`,
          ].join("\n"),
        });

        this.emit({ type: "turn_end", roomId, agentId: orchestrator.id });
        if (decisionResult.costUsd) state.costUsd += decisionResult.costUsd;
        if (abort.signal.aborted) break;

        if (decisionResult.isError || decisionResult.structured == null) {
          state.stopReason = "orchestrator_error";
          this.post({
            roomId,
            authorId: "system",
            kind: "notice",
            text: `Orchestrator failed: ${decisionResult.text.slice(0, 300) || "no decision returned"}`,
          });
          break;
        }

        const decision = decisionResult.structured as Decision;

        if (state.goalId && decision.step) {
          const updated = updateStep(
            state.goalId,
            decision.step.index,
            decision.step.status,
            decision.step.note,
          );
          if (updated) {
            const goal = getGoal(state.goalId);
            if (goal) this.emit({ type: "goal", goal });
          }
        }

        if (decision.say?.trim()) {
          this.post({
            roomId,
            authorId: orchestrator.id,
            kind: "agent",
            text: decision.say.trim(),
            costUsd: decisionResult.costUsd,
          });
        }

        if (decision.notify) {
          const text = withRoles(
            `📢 ${decision.notify.headline}\n${decision.notify.detail}`,
            roster,
          );
          const result = await notify(roomId, text);
          this.post({
            roomId,
            authorId: "system",
            kind: "notify",
            text,
            delivered: result.delivered,
          });
        }

        // The deliverable at the end of a goal is the prompt Dominic runs.
        // Nobody here edits code, so a goal that ends with no handoff has
        // produced nothing actionable — record that plainly rather than
        // letting it read as finished work.
        if (state.goalId && (decision.handoff?.trim() || decision.verify?.trim())) {
          const goal = setGoalHandoff(
            state.goalId,
            decision.handoff?.trim() ?? null,
            decision.verify?.trim() ?? null,
          );
          if (goal) this.emit({ type: "goal", goal });
          if (decision.handoff?.trim()) {
            this.post({
              roomId,
              authorId: orchestrator.id,
              kind: "handoff",
              text: decision.handoff.trim(),
            });
          }
        }

        const next = resolveNext(decision.next, roster);
        if (!next) {
          state.stopReason = "done";
          break;
        }

        // --- the assigned agent speaks ---------------------------------------
        state.speaking = next.id;
        this.publishRun(state);
        this.emit({
          type: "turn_start",
          roomId,
          agentId: next.id,
          directedBy: orchestrator.id,
          turn: state.turn,
        });

        const agentTranscript = renderTranscript(
          listMessages(roomId, config.transcriptWindow),
          agents,
        );
        const turnResult = await this.runTurn({
          agent: next,
          roomName: room.name,
          roster,
          roomId,
          signal: abort.signal,
          prompt: [
            `Room transcript so far:`,
            "---",
            agentTranscript || "(empty)",
            "---",
            "",
            `${orchestrator.name} has asked you to act. Reply once, in your own voice.`,
          ].join("\n"),
        });

        this.emit({ type: "turn_end", roomId, agentId: next.id });
        if (turnResult.costUsd) state.costUsd += turnResult.costUsd;

        // A turn that hit its own deadline fails alone. The orchestrator sees
        // it in the transcript next turn and can reassign, narrow the ask, or
        // stop — which is a better outcome than losing the whole run.
        if (turnResult.timedOut) {
          this.post({
            roomId,
            authorId: "system",
            kind: "notice",
            text: `${next.name} ran past ${Math.round(config.turnTimeoutMs / 1000)}s and was cut off. Nothing from that turn was kept.`,
          });
          continue;
        }

        if (abort.signal.aborted) break;

        this.post({
          roomId,
          authorId: next.id,
          kind: "agent",
          text: turnResult.text.trim() || "(no reply)",
          directedBy: orchestrator.id,
          costUsd: turnResult.costUsd,
        });
      }
    } catch (err) {
      state.stopReason = state.stopReason ?? "error";
      const detail = err instanceof Error ? err.message : String(err);
      // An aborted child process throws; that is a Stop, not a crash.
      if (!abort.signal.aborted) {
        this.emit({ type: "error", roomId, detail });
        this.post({ roomId, authorId: "system", kind: "notice", text: `Run failed: ${detail}` });
      }
    } finally {
      clearTimeout(deadline);
      state.active = false;
      state.speaking = null;
      state.stopReason = state.stopReason ?? "done";

      if (state.goalId) {
        // Only "done" closes the goal as achieved — a turn cap or a stop means
        // the remaining steps were never reached, not that they succeeded.
        const goal = closeGoal(
          state.goalId,
          state.stopReason === "done" ? "done" : "stopped",
          state.costUsd,
        );
        if (goal) {
          this.emit({ type: "goal", goal });
          // Every finished run reports to WhatsApp, prompt included — forced
          // past the rate limiter, because this is the message that matters.
          const report = withRoles(buildRunReport(goal, agents), roster);
          void notify(roomId, report, { force: true }).then((result) => {
            this.post({
              roomId,
              authorId: "system",
              kind: "notify",
              text: report,
              delivered: result.delivered,
            });
          });
        }
      }

      this.runs.delete(roomId);
      this.publishRun(state);
      if (state.stopReason === "stopped" || state.stopReason === "timeout") {
        this.post({
          roomId,
          authorId: "system",
          kind: "notice",
          text: state.stopReason === "stopped" ? "Run stopped." : "Run timed out.",
        });
      }
    }
  }
}
