import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { relative } from "node:path";
import { config } from "./config.ts";
import {
  addMessage,
  closeGoal,
  createGoal,
  getGoal,
  createRoom,
  getMindStone,
  getLastSpokenSeq,
  getRoom,
  listGoals,
  listMessages,
  listRooms,
  reopenGoal,
  saveMindStone,
  setLastSpokenSeq,
  unfoldedMessages,
  setGoalHandoff,
  setRoomMembers,
  updateStep,
} from "./db.ts";
import { existsSync, realpathSync, statSync } from "node:fs";
import {
  SLUG,
  buildSystemPrompt,
  forgeAgent,
  grantAccess,
  listTemplates,
  slugify,
  writeRoomRules,
} from "./agents/registry.ts";

/**
 * Words that mean "go and look". A backstop for the planner's needsLookup and
 * the gate for access grants: "pwede mo ba tignan" answered with tools off is
 * how Fury told Dominic it had not seen KooyaPedia.
 */
const LOOK_WORDS =
  /\b(tingnan|tignan|tingin|silipin|check|scan|i-?scan|look|basahin|read|buksan|open|hanapin|search|verify|i-?access|access)\b/i;

/** Folders Dominic may open to a room by saying so. Never the agora repo itself (it holds .env). */
const ACCESS_ROOTS = ["/mnt/c/Projects", "/mnt/c/Users/domin", "/home/dominickooya"];

const KOOYAPEDIA_GRANT = {
  tools: ["Bash"],
  allow: ["Bash(bash /home/dominickooya/.openclaw/agora/scripts/kooyapedia-lookup.sh:*)"],
};

/** `C:\\Projects\\X` or `C:/Projects/X` as WSL sees it. */
function toWslPath(p: string): string {
  const m = p.trim().replace(/^["'`]|["'`]$/g, "").match(/^([A-Za-z]):[\\/](.*)$/);
  if (m) return `/mnt/${m[1]!.toLowerCase()}/${m[2]!.replace(/\\/g, "/")}`;
  return p.trim();
}
import {
  PROTOCOL_VERSION,
  REPLY_LIMITS,
  bodyWords,
  parseMarkers,
  wordLimitFor,
} from "./protocol.ts";
import { ClaudeCliDriver } from "./drivers/claude-cli.ts";
import { CursorCliDriver } from "./drivers/cursor-cli.ts";
import { levelForRoom, notify, type NotifyKind } from "./notify.ts";
import type {
  Agent,
  Choice,
  Goal,
  Message,
  Room,
  RunPhase,
  RunState,
  ServerEvent,
  StepStatus,
} from "./types.ts";

/**
 * The plan the orchestrator commits to before any work starts. Producing it up
 * front is what makes progress monitorable — without it there is nothing to
 * measure a run against except how many turns it has burned.
 */
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["answer", "work"],
      description:
        "answer = he asked a question or wants something explained; one agent replies and the room stops. work = he assigned something; plan it and run the room.",
    },
    responder: {
      type: ["string", "null"],
      description:
        "In answer mode, the id of the ONE agent best placed to reply. null in work mode.",
    },
    needsLookup: {
      type: "boolean",
      description:
        "In answer mode: true when the question cannot be answered honestly without opening something. That means a file, the git tree, a workflow — AND it means the browser: anything asking someone to look at a screen, click through a flow, check whether a page saves, or read the console is a lookup, because the dev console is not something anyone can answer from memory. Say true whenever Dominic says go, do it, check it, or have a look, and whenever the answer would otherwise be \"I would need to open it\". False only for a question the responder can genuinely answer from what they already know, which is most of them and much cheaper. Telling someone to go and click something while giving them no browser produces a refusal, not an answer.",
    },
    discuss: {
      type: ["array", "null"],
      items: { type: "string" },
      description:
        "In answer mode only: ids of two to four agents who should talk this through together, in speaking order, instead of one person replying. Use it whenever the question has more than one defensible answer, touches more than one specialty, or is asking the room to weigh something up — those are the questions Dominic wants to watch us argue. Null when one person plainly owns the answer and the rest would just be agreeing.",
    },
    goal: {
      type: "string",
      description: "The goal in one line, as an outcome rather than an activity.",
    },
    spawn: {
      type: ["object", "null"],
      description:
        "Forge a new member for this room, ONLY when no current member can do a step. Null almost always. The template fixes what the new agent may do — you choose who it is and what it works on, never what it may touch.",
      properties: {
        template: {
          type: "string",
          description:
            "helper = chat-only specialist who reasons from the transcript. researcher = web search, page reading and the ECC skills library, for finding things out. mechanic = improves agents' Instructions/Personality through a guarded wrapper and measures the result.",
        },
        id: {
          type: "string",
          description: "Slug: lowercase letters, digits and dashes, e.g. bland-docs. Becomes the agent id.",
        },
        name: { type: "string", description: "Display name, e.g. Bland Docs." },
        role: { type: "string", description: "Two or three words, e.g. Docs Researcher." },
        brief: {
          type: "string",
          description: "What this agent is for, in two or three sentences. Appended to its instructions.",
        },
      },
      required: ["template", "id", "name", "role", "brief"],
      additionalProperties: false,
    },
    access: {
      type: ["object", "null"],
      description:
        "ONLY when Dominic's own message tells the room to access, open, look at or read a specific project folder or KooyaPedia (the internal wiki). Null otherwise. He grants read access by saying so; you only name what and to whom.",
      properties: {
        kind: {
          type: "string",
          enum: ["dir", "kooyapedia"],
          description: "dir = a folder he named, Windows or WSL form. kooyapedia = the internal wiki.",
        },
        path: {
          type: ["string", "null"],
          description: "For dir: the folder exactly as he wrote it. Null for kooyapedia.",
        },
        agents: {
          type: "array",
          items: { type: "string" },
          description:
            "Agent ids that get it. The one who will answer, or everyone on the roster if he said 'kayong lahat' or named nobody.",
        },
      },
      required: ["kind", "path", "agents"],
      additionalProperties: false,
    },
    createRoom: {
      type: ["object", "null"],
      description:
        "ONLY when Dominic's message explicitly asks for a new room or channel. Null otherwise — a task that merely feels like it deserves its own room does not qualify.",
      properties: {
        name: { type: "string", description: "Short room name, e.g. Billing Audit." },
        topic: { type: "string", description: "One line on what the room is for." },
        members: {
          type: "array",
          items: { type: "string" },
          description: "Agent ids from the roster to seed it with. You may include yourself.",
        },
      },
      required: ["name", "topic", "members"],
      additionalProperties: false,
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
  required: ["mode", "responder", "discuss", "needsLookup", "spawn", "access", "createRoom", "goal", "steps"],
  additionalProperties: false,
} as const;

interface SpawnRequest {
  template: string;
  id: string;
  name: string;
  role: string;
  brief: string;
}

interface Plan {
  mode: "answer" | "work";
  responder: string | null;
  discuss: string[] | null;
  needsLookup: boolean | null;
  spawn: SpawnRequest | null;
  access: { kind: "dir" | "kooyapedia"; path: string | null; agents: string[] } | null;
  createRoom: { name: string; topic: string; members: string[] } | null;
  goal: string;
  steps: Array<{ title: string; owner: string | null }>;
}

/** The orchestrator's one structured decision per turn. */
const DECISION_SCHEMA = {
  type: "object",
  properties: {
    say: {
      type: "string",
      description: `What you say out loud in the room, Taglish. At most two sentences (about ${REPLY_LIMITS.short} words). No headings, no lists.`,
    },
    next: {
      type: ["string", "null"],
      description:
        "The id of the agent who should act next, or null if the work is finished.",
    },
    steps: {
      type: "array",
      description:
        "Every plan step whose status changed this turn. A turn often finishes more than one, and a turn that finishes three and reports one leaves the board lying about the work. Report them all, or an empty array if nothing changed.",
      items: {
        type: "object",
        properties: {
          index: { type: "number", description: "0-based index into the plan." },
          status: {
            type: "string",
            enum: ["pending", "active", "done", "blocked"],
            description:
                "pending = not started yet, INCLUDING a step waiting on an earlier step of this same plan. " +
                "active = being worked on now. done = genuinely finished. " +
                "blocked = something OUTSIDE this room has stopped it and no agent here can move it; say what in note. " +
                "Waiting its turn is pending, never blocked: a goal that closes with a blocked step closes as stopped and " +
                "never picks itself back up, so calling an unstarted step blocked ends the whole goal on a dependency that " +
                "was about to be met.",
          },
          note: {
            type: ["string", "null"],
            description: "Short reason, required when blocked.",
          },
        },
        required: ["index", "status", "note"],
        additionalProperties: false,
      },
    },
    discuss: {
      type: ["object", "null"],
      description:
        "Open the floor to several agents at once instead of assigning one. Use it when the call needs judgement rather than legwork — which of two fixes, is this severity right, is anyone seeing a risk here. They speak in the order you list and each one hears the ones before, so put the person with the most context first and the one who has to decide last. Null on a normal turn; assigning one agent to go and do something is still the common case.",
      properties: {
        agents: {
          type: "array",
          items: { type: "string" },
          description: "Two to four agent ids, in speaking order.",
        },
        question: {
          type: "string",
          description:
            "The actual question you are putting to them. One sentence, specific enough to disagree with.",
        },
      },
      required: ["agents", "question"],
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
        "ONLY for work this room genuinely cannot do itself — because it has no execution grant, or because the task needs something outside it such as a multi-hour training run or a push. Then: the exact prompt Dominic pastes into Claude CLI, with the task, files, acceptance criteria and an instruction to verify. Plain text, no surrounding commentary. Otherwise NULL. In a room that can execute, handing him a prompt instead of a result is a failure, not a deliverable — the findings go in say, and handoff stays null.",
    },
    spawn: {
      type: ["object", "null"],
      description:
        "Forge a new member for this room, ONLY when no current member can do a step. Null almost always. The template fixes what the new agent may do — you choose who it is and what it works on, never what it may touch.",
      properties: {
        template: {
          type: "string",
          description:
            "helper = chat-only specialist who reasons from the transcript. researcher = web search, page reading and the ECC skills library, for finding things out. mechanic = improves agents' Instructions/Personality through a guarded wrapper and measures the result.",
        },
        id: {
          type: "string",
          description: "Slug: lowercase letters, digits and dashes, e.g. bland-docs. Becomes the agent id.",
        },
        name: { type: "string", description: "Display name, e.g. Bland Docs." },
        role: { type: "string", description: "Two or three words, e.g. Docs Researcher." },
        brief: {
          type: "string",
          description: "What this agent is for, in two or three sentences. Appended to its instructions.",
        },
      },
      required: ["template", "id", "name", "role", "brief"],
      additionalProperties: false,
    },
    notify: {
      type: ["object", "null"],
      description:
        "Set only when a human genuinely needs this on their phone. Otherwise null.",
      properties: {
        headline: {
          type: "string",
          description: "One line, plain Taglish: the effect, not the mechanism.",
        },
        detail: {
          type: "string",
          description:
            "At most five short lines, plain Taglish. No paths, line numbers, error codes, tool names or acronyms — he reads this on a phone.",
        },
      },
      required: ["headline", "detail"],
      additionalProperties: false,
    },
  },
  required: ["say", "next", "steps", "discuss", "spawn", "verify", "handoff", "notify"],
  additionalProperties: false,
} as const;

interface Decision {
  say: string;
  next: string | null;
  spawn: SpawnRequest | null;
  steps: Array<{ index: number; status: StepStatus; note: string | null }> | null;
  discuss: { agents: string[]; question: string } | null;
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

  get saturated(): boolean {
    return this.active >= this.limit;
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

/**
 * One line of transcript, named so it can be cited.
 *
 * The `[#seq]` prefix is the whole point: an agent answering a specific message
 * writes that id back, and correlation stops depending on a model paraphrasing
 * what it thinks it is replying to.
 */
function renderLine(m: Message, agents: Map<string, Agent>): string | null {
  if (m.kind === "human") return `[#${m.seq}] dominic: ${m.text}`;
  if (m.kind === "agent") {
    const a = agents.get(m.authorId);
    return `[#${m.seq}] ${a?.id ?? m.authorId}: ${m.text}`;
  }
  if (m.kind === "notify") return `[#${m.seq}] (pushed to WhatsApp): ${m.text}`;
  return null;
}

/**
 * A flat list of lines, no headings and no split.
 *
 * Still the right shape where "since your last turn" has no meaning: folding
 * messages into the mind stone, and anywhere the reader is not an agent taking
 * a turn.
 */
function renderTranscript(messages: Message[], agents: Map<string, Agent>): string {
  return messages
    .map((m) => renderLine(m, agents))
    .filter((l): l is string => l !== null)
    .join("\n");
}

/**
 * The room as one agent sees it, in three labelled blocks.
 *
 * A flat transcript gives an agent no way to tell what it has already answered
 * from what arrived while it was away, so every turn re-reads the whole thread
 * and the room fills with agents restating each other. The split at the agent's
 * own last message makes that distinction structural rather than something the
 * model has to infer:
 *
 *   CARRIED  the mind stone — what the room knows, compacted
 *   SETTLED  everything up to and including this agent's last turn
 *   NEW      everything since
 *
 * `viewerId` null renders no split — used for views that are not one agent's
 * turn, where "since your last turn" has no meaning.
 */
function renderRoomView(opts: {
  roomId: string;
  viewerId: string | null;
  messages: Message[];
  agents: Map<string, Agent>;
}): string {
  const { roomId, viewerId, messages, agents } = opts;
  const blocks: string[] = [];

  const stone = getMindStone(roomId);
  if (stone?.content.trim()) {
    blocks.push(
      [
        "## CARRIED — what this room already knows",
        stone.content.trim(),
        `(${stone.messages} messages folded in over ${stone.revisions} revision${
          stone.revisions === 1 ? "" : "s"
        })`,
      ].join("\n"),
    );
  }

  const lines = messages
    .map((m) => ({ seq: m.seq, text: renderLine(m, agents) }))
    .filter((x): x is { seq: number; text: string } => x.text !== null);

  if (viewerId === null) {
    blocks.push(
      lines.length
        ? ["## TRANSCRIPT", ...lines.map((l) => l.text)].join("\n")
        : "## TRANSCRIPT\n(empty)",
    );
    return blocks.join("\n\n");
  }

  const mark = getLastSpokenSeq(roomId, viewerId);
  const settled = lines.filter((l) => l.seq <= mark);
  const fresh = lines.filter((l) => l.seq > mark);

  if (settled.length) {
    blocks.push(
      [
        "## SETTLED — context only, do not reply to these",
        ...settled.map((l) => l.text),
      ].join("\n"),
    );
  }

  blocks.push(
    fresh.length
      ? ["## NEW — since your last turn", ...fresh.map((l) => l.text)].join("\n")
      : "## NEW — since your last turn\n(nothing new)",
  );

  return blocks.join("\n\n");
}

/**
 * The message that lands on Dominic's phone when a run ends.
 *
 * The handoff prompt is the deliverable — nobody here edits code — so it has to
 * arrive here, not sit in a tab he has to remember to open. WhatsApp renders
 * ``` blocks as monospace, which makes the prompt copyable in one press.
 */
/**
 * `findings` is the room's own last substantive message. A room that can
 * execute produces a RESULT, and that result is what Dominic should receive —
 * so the report leads with it. The pasteable prompt is the fallback for work
 * the room could not do, not the shape of every report.
 */
function buildRunReport(
  goal: Goal,
  agents: Map<string, Agent>,
  findings?: string | null,
): string {
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

  const result = findings?.trim();
  if (result) {
    // Capped: this is read on a phone, and the full exchange is in the room.
    const body = result.length > 1500 ? `${result.slice(0, 1500)}\n…(more in the room)` : result;
    lines.push("", "🔎 *What they found:*", body);
  }

  if (goal.handoff) {
    lines.push(
      "",
      "This part the room could not do itself — paste into Claude CLI:",
      "```",
      goal.handoff.trim(),
      "```",
    );
  } else if (!result) {
    lines.push("", "Nothing came out of this run — no findings and no prompt.");
  }

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

/**
 * The mind stone: the room's compacted long-term memory.
 *
 * Agents see only the last `transcriptWindow` messages, so without this a room
 * forgets everything older — re-deriving facts it established last week and
 * re-asking questions Dominic already answered. Rendered ahead of the
 * transcript in every prompt, so the recent detail sits on top of the durable
 * residue rather than replacing it.
 */
/**
 * What the goal already carries as its deliverable.
 *
 * The plan text lists steps; it says nothing about whether the prompt Dominic
 * runs has actually been produced. A reviewer that cannot see the handoff will
 * happily report it missing while it is sitting in the record.
 */
function handoffState(goalId: string | null): string {
  if (!goalId) return "";
  const goal = getGoal(goalId);
  if (!goal) return "";
  const parts: string[] = [];
  if (goal.handoff?.trim()) {
    parts.push(
      `This goal ALREADY HAS its handoff prompt (${goal.handoff.trim().length} characters):`,
      "---",
      goal.handoff.trim(),
      "---",
      `Do not report it as missing, and do not write it again. If it is good`,
      `enough to run, the deliverable exists — say so.`,
    );
  } else {
    parts.push(`This goal has NO handoff prompt recorded yet.`);
  }
  if (goal.verify?.trim()) parts.push("", `Verification steps are recorded too.`);
  return parts.join("\n");
}

/**
 * Strip structured-output scaffolding that leaked into a string field.
 *
 * Seen in the wild: a review's `summary` came back ending
 * `...substitute for the lease.</summary>\n<steps>[{...}]</steps>\n<blocker>...`
 * — the model emitted its whole StructuredOutput envelope as the value of the
 * first field. The schema layer accepted it because a string is a string, and
 * the entire envelope went to WhatsApp as the summary.
 *
 * So cut at the first closing tag. Everything after it belongs to a sibling
 * field that was parsed separately anyway, which makes this lossless in the
 * failure case and a no-op in the normal one.
 */
function cleanField(v: string | null | undefined): string {
  if (!v) return "";
  const cut = v.search(/<\/?[A-Za-z][A-Za-z0-9_]*>/);
  const body = cut === -1 ? v : v.slice(0, cut);
  return body.trim();
}

function mindStoneText(roomId: string): string {
  const stone = getMindStone(roomId);
  if (!stone?.content.trim()) return "";
  return [
    "=== MIND STONE — what this room already knows ===",
    stone.content.trim(),
    `=== end (${stone.messages} messages folded in over ${stone.revisions} revision${stone.revisions === 1 ? "" : "s"}) ===`,
    "",
    "Treat that as established. Do not re-derive it, and do not ask again for",
    "anything it already answers. If the transcript below contradicts it, the",
    "transcript is newer and wins — say so rather than silently picking one.",
    "",
  ].join("\n");
}

/**
 * The periodic progress review.
 *
 * A run reaching its turn budget is not evidence that the work is finished,
 * and it is not evidence that it is stuck either. It is only a moment to ask.
 * The three verdicts are the only honest answers, and `blocked` is the one
 * that reaches Dominic — everything else the room settles by itself.
 */
const PROGRESS_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["continue", "done", "blocked"],
      description:
        "continue: the room is advancing and the remaining steps are reachable. done: the goal is genuinely met. blocked: the room cannot proceed without Dominic. Do not answer blocked because progress is slow — only because it has stopped and nothing in this room can restart it.",
    },
    summary: {
      type: "string",
      description: `Where the goal actually stands right now, in Taglish, at most ${REPLY_LIMITS.result} words: what is finished, what is in flight, what is left. This is what Dominic reads to follow along, so no filler and no restating the goal back to him.`,
    },
    steps: {
      type: "array",
      description:
        "The true status of EVERY step that is not still waiting, right now — not just what changed since last time. This is the board Dominic is watching; if it disagrees with what you just said in the room, the board is what he believes. Settle it.",
      items: {
        type: "object",
        properties: {
          index: { type: "number", description: "0-based index into the plan." },
          status: {
            type: "string",
            enum: ["pending", "active", "done", "blocked"],
            description:
                "pending = not started yet, INCLUDING a step waiting on an earlier step of this same plan. " +
                "active = being worked on now. done = genuinely finished. " +
                "blocked = something OUTSIDE this room has stopped it and no agent here can move it; say what in note. " +
                "Waiting its turn is pending, never blocked: a goal that closes with a blocked step closes as stopped and " +
                "never picks itself back up, so calling an unstarted step blocked ends the whole goal on a dependency that " +
                "was about to be met.",
          },
          note: {
            type: ["string", "null"],
            description: "Short reason, required when blocked.",
          },
        },
        required: ["index", "status", "note"],
        additionalProperties: false,
      },
    },
    blocker: {
      type: ["string", "null"],
      description:
        "On blocked: precisely what stopped, and what was already tried. Null otherwise.",
    },
    needFromDominic: {
      type: ["string", "null"],
      description:
        "On blocked: the one thing you need from him, stated as an action he can take. Null otherwise.",
    },
    choices: {
      type: ["array", "null"],
      description:
        "On blocked, WHEN the thing you need is a decision between concrete options: two to four of them. He gets a button per option and the room restarts the moment he taps one, so this turns a question that would have waited hours into one that waits seconds. Only for real alternatives you have actually thought through — never 'yes/no', never 'you decide'. Null when what you need is not a choice, such as a credential or an answer only he knows.",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description:
              "The button. Short and concrete — 'Separate read-state join table', not 'Option A'. He is reading this on a phone.",
          },
          detail: {
            type: "string",
            description:
              "One line under the button: what picking it actually commits the room to, and the cost of it.",
          },
        },
        required: ["label", "detail"],
        additionalProperties: false,
      },
    },
  },
  // blocker / needFromDominic / choices are REQUIRED, not optional-and-nullable.
  // Left optional, structured output simply omits them, and it did: a run ended
  // `blocked` with all three absent, so the escalation read "stuck and needs
  // you" and nothing else — no ask, and no choices means no button, so the only
  // way back into the room was Dominic noticing and typing. Required forces an
  // answer to each; null is still the right answer when the verdict is not
  // blocked.
  required: ["verdict", "summary", "blocker", "needFromDominic", "choices"],
  additionalProperties: false,
} as const;

const MIND_STONE_SCHEMA = {
  type: "object",
  properties: {
    memory: {
      type: "string",
      description:
        "The room's whole memory, rewritten. Not an append — you are producing the replacement. Keep what still matters, drop what does not, merge duplicates.",
    },
  },
  required: ["memory"],
  additionalProperties: false,
} as const;

/**
 * What the room was last doing, handed to the planner.
 *
 * Without this every message is read in isolation, so a follow-up like "the
 * browser is now up, he can check it now" has no antecedent — no "he", no
 * "it" — and the planner cannot tell it refers to work that stalled ninety
 * seconds earlier. Naming the stalled goal and who owned each step is what
 * makes a pronoun resolvable.
 */
function lastGoalContext(roomId: string): string {
  const goal = listGoals(roomId, 1)[0];
  if (!goal) return "";

  const age = Math.round((Date.now() - goal.createdAt) / 60000);
  const lines = [
    `The room's most recent goal (${age}m ago, ${goal.status}):`,
    `  "${goal.title}"`,
  ];
  for (const s of goal.steps) {
    const owner = s.ownerId ? ` — ${s.ownerId}` : "";
    const note = s.note ? `  (${s.note.slice(0, 120)})` : "";
    lines.push(`  [${s.status}] ${s.title}${owner}${note}`);
  }
  lines.push(
    "",
    `If what he just said is a follow-up to THAT — a green light, an answer to`,
    `something that blocked it, or "try again now" — treat it as work and`,
    `restart the part that stalled, with the SAME owner. Do not send it to`,
    `whoever happens to be free.`,
  );
  return lines.join("\n");
}

/**
 * Who answers when the planner did not name anybody.
 *
 * This used to be `roster.find(a => a.id !== orchestrator.id)` — the first
 * agent in the room that is not the orchestrator. The roster is alphabetical,
 * so in the HelloAlex room that is always Belick, and "the browser is now up,
 * he can check it now" went to Security, who correctly said it was not his.
 * A whole minute to be told the obvious.
 *
 * Order below is by who is most likely to actually know:
 *   1. whoever owns unfinished work in the newest goal — a short follow-up is
 *      almost always about the thing that just stalled,
 *   2. whoever spoke last, since Dominic is usually replying to them,
 *   3. the orchestrator, which at least holds the whole room's context.
 * Never "first in the list".
 */
function pickResponder(
  named: string | null,
  roster: Agent[],
  roomId: string,
  orchestrator: Agent,
): Agent {
  const explicit = resolveNext(named, roster);
  if (explicit) return explicit;

  const latest = listGoals(roomId, 1)[0];
  const open = latest?.steps.find(
    (s) => s.status === "blocked" || s.status === "active" || s.status === "pending",
  );
  if (open?.ownerId) {
    const owner = roster.find((a) => a.id === open.ownerId);
    if (owner) return owner;
  }

  for (const m of [...listMessages(roomId, 12)].reverse()) {
    if (m.kind !== "agent" || m.authorId === orchestrator.id) continue;
    const spoke = roster.find((a) => a.id === m.authorId);
    if (spoke) return spoke;
  }

  return orchestrator;
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

/**
 * The last thing a dispatched agent reads before it writes. Recency is the
 * strongest lever on length there is: the discussion prompt carried ~900 chars
 * of "this is a chat" and its rooms averaged half the length of the rooms whose
 * dispatch line was "reply once, in your own voice".
 */
function turnInstruction(lead: string): string {
  return [
    `${lead} Do whatever the work needs, then reply as ONE chat message, Taglish:`,
    `what you found or decided, in 1 to 3 plain sentences (about ${REPLY_LIMITS.short} words;`,
    `${REPLY_LIMITS.result} for a \`result\` with evidence). No headings, no bullets, no summary`,
    `of what others said. Cite the \`[#id]\` you are answering; end with \`@next:\`.`,
    `Wala kang idadagdag? Reply \`PASS\`.`,
  ].join("\n");
}

/**
 * Commit one file the harness wrote on an agent's behalf, authored as that
 * agent, so `git log --author=@agents.agora` is the audit trail and one revert
 * undoes any forge. Best effort: a commit failing must never fail a run.
 */
function gitCommitFile(file: string, message: string, author: string): void {
  const rel = relative(config.root, file);
  const git = (args: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
      execFile("git", ["-C", config.root, ...args], { timeout: 15_000 }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  void git(["add", "--", rel])
    .then(() =>
      git([
        "-c",
        `user.name=${author}`,
        "-c",
        `user.email=${author}@agents.agora`,
        "commit",
        "-q",
        "-o",
        rel,
        "-m",
        `${message}\n\nAgora-Forge: ${author} ${rel}`,
      ]),
    )
    .catch((err: unknown) =>
      console.error("[git] commit failed:", err instanceof Error ? err.message : err),
    );
}

/** Two nullable turn costs as one nullable message cost. */
function sumCost(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${String(rem).padStart(2, "0")}s`;
}

export type Emit = (event: ServerEvent) => void;

export class Orchestrator {
  // AGORA_DRIVER picks the CLI. Announced at boot next to the engine line, so a
  // run is never quietly attributed to the wrong subscription.
  private readonly claude = new ClaudeCliDriver();
  private readonly cursor = new CursorCliDriver();

  /**
   * Which CLI runs a given turn.
   *
   * "hybrid" splits them along the one line that actually matters, and the
   * split is not arbitrary — it is drawn where each engine failed:
   *
   *   AGENT TURNS (generating) -> Cursor. This is where the money goes. The
   *   roster runs its heavy roles on opus-high, and those turns are prose:
   *   Cursor handled them fine on speed, quality and tools.
   *
   *   ORCHESTRATOR TURNS (planning, deciding, compacting) -> Claude. These are
   *   the structured ones. Cursor has no --json-schema, so its objects are
   *   extracted from prose rather than validated, and a decision turn came back
   *   unparseable — "cursor-cli: a structured turn returned no parseable JSON"
   *   is what ended a run at 2 of 6. They also run on sonnet, not opus, so
   *   keeping them on Claude is the cheap half of the bill.
   *
   * "cursor" and "claude" still force everything one way.
   */
  private driverFor(phase: string | undefined) {
    if (config.driver === "cursor") return this.cursor;
    if (config.driver !== "hybrid") return this.claude;
    return phase === "generating" ? this.cursor : this.claude;
  }
  private readonly gate = new Semaphore(config.maxConcurrency);
  /** Rooms already told once this run that their blocker contradicts the roster. */
  private readonly corrected = new Set<string>();

  /** Rooms already sent back once this run for a blocker with nothing to act on. */
  private readonly vague = new Set<string>();

  /** Auto-resumes spent per goal. Bounded so a stuck goal cannot spin forever. */
  private readonly resumes = new Map<string, number>();

  /** Agents forged per goal (keyed by goal id, or the room id before a goal exists). */
  private readonly spawned = new Map<string, number>();

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

  /** Every live run — for the cross-room activity board. */
  listRuns(): RunState[] {
    return [...this.runs.values()].map((r) => ({ ...r.state }));
  }

  private post(input: Parameters<typeof addMessage>[0]): Message {
    // Parse the three markers out of agent prose on the way in, so the columns
    // and the text can never disagree about what a turn said. Done here because
    // post() is the only path by which a message reaches the room.
    //
    // Nothing depends on these yet. They are recorded and their absence counted
    // first, because building dispatch on a marker whose real-world hit rate is
    // unknown is how you get a router that silently stops routing.
    let enriched = input;
    if (input.kind === "agent" && input.authorId !== "human") {
      const m = parseMarkers(input.text);
      enriched = { ...input, act: m.act, refs: m.refs, nextId: m.next };
      console.log(
        JSON.stringify({
          event: "markers",
          room: input.roomId,
          agent: input.authorId,
          act: m.act,
          refs: m.refs.length,
          next: m.next,
          missing: m.missing,
          protocol: PROTOCOL_VERSION,
        }),
      );
    }
    const message = addMessage(enriched);
    // An agent's own message is the marker for what it has already seen. Set it
    // here rather than at the call sites: every agent message in the room goes
    // through post(), and a call site that forgot would silently re-show an
    // agent the thread it just answered.
    //
    // Only kind "agent" counts. Notices, events and notify rows are written by
    // the system on an agent's behalf and are not that agent taking a turn.
    if (message.kind === "agent" && message.authorId !== "human") {
      setLastSpokenSeq(message.roomId, message.authorId, message.seq);
    }
    this.emit({ type: "message", message });
    return message;
  }

  /**
   * Send one report to WhatsApp and record honestly what became of it.
   *
   * A room with no target is not a failed send. Trunks has no group at all
   * (`AGORA_NOTIFY_JID_TRUNKS=off`), so every report came back undelivered and
   * the transcript stamped all eight of them "WhatsApp update — not sent" —
   * which reads as a broken pipe rather than a room that was deliberately
   * silenced, and it is the line Dominic kept seeing above a run that had died
   * for an unrelated reason. The report is already in the room directly above
   * as the handoff, so the duplicate adds nothing but the false alarm.
   *
   * A real failure — the send was attempted and the CLI refused — is still
   * recorded as one, because that one is worth chasing.
   */
  private recordNotify(roomId: string, report: string, kind: NotifyKind): void {
    void notify(roomId, report, { force: true, kind }).then((r) => {
      if (!r.delivered && (r.reason === "no_jid" || r.reason === "suppressed")) {
        this.post({
          roomId,
          authorId: "system",
          kind: "event",
          text:
            r.reason === "no_jid"
              ? "WhatsApp is off for this room — the report above is the whole of it"
              : "WhatsApp is prompt-only for this room — this one was not sent",
        });
        return;
      }
      this.post({
        roomId,
        authorId: "system",
        kind: "notify",
        text: report,
        delivered: r.delivered,
      });
    });
  }

  private publishRun(state: RunState): void {
    this.emit({ type: "run", state: { ...state } });
    this.emit({ type: "runs", runs: this.listRuns() });
  }

  private setPhase(
    state: RunState,
    phase: RunPhase | null,
    detail: string | null = null,
  ): void {
    state.phase = phase;
    state.phaseDetail = detail;
    this.publishRun(state);
  }

  /**
   * Honour an orchestrator's `spawn`: forge the agent from a template, add it
   * to the room, commit the file, and put it on this run's roster so it can be
   * dispatched on the very next turn.
   *
   * Every refusal is posted to the room rather than thrown: the orchestrator
   * asked for something the harness would not do, and it needs to know why so
   * it can carry on with the members it has.
   */
  private forge(opts: {
    roomId: string;
    room: Room;
    orchestrator: Agent;
    roster: Agent[];
    agents: Map<string, Agent>;
    request: SpawnRequest;
    goalId: string | null;
  }): Agent | null {
    const { roomId, room, orchestrator, roster, agents, request, goalId } = opts;
    const key = goalId ?? roomId;
    const refuse = (why: string): null => {
      this.post({ roomId, authorId: "system", kind: "notice", text: `Not forged: ${why}` });
      return null;
    };
    const templates = listTemplates();
    const template = (request.template ?? "").trim().toLowerCase();
    if (!templates.includes(template)) {
      return refuse(`no template "${request.template}". Templates: ${templates.join(", ") || "(none)"}.`);
    }
    const forgedHere = roster.filter((a) => a.forgedBy).length;
    if (forgedHere >= config.maxForgedPerRoom) {
      return refuse(`this room already holds ${forgedHere} forged agents (cap ${config.maxForgedPerRoom}). Retire one first.`);
    }
    const spent = this.spawned.get(key) ?? 0;
    if (spent >= config.maxSpawnsPerGoal) {
      return refuse(`${spent} agents already forged for this goal (cap ${config.maxSpawnsPerGoal}).`);
    }
    if (!SLUG.test((request.id ?? "").trim().toLowerCase())) {
      return refuse(`"${request.id}" is not a valid id — lowercase letters, digits and dashes.`);
    }
    if (agents.has(request.id.trim().toLowerCase())) {
      return refuse(`an agent called "${request.id}" already exists; add it to the room instead.`);
    }

    let agent: Agent;
    try {
      agent = forgeAgent({ ...request, forgedBy: orchestrator.id });
    } catch (err) {
      return refuse(err instanceof Error ? err.message : String(err));
    }
    this.spawned.set(key, spent + 1);

    // On this run's roster now; the watcher will also reload the server's map.
    agents.set(agent.id, agent);
    roster.push(agent);
    const members = [...new Set([...room.members, agent.id])];
    room.members = members;
    setRoomMembers(roomId, members);
    this.emit({ type: "rooms", rooms: listRooms() });
    this.emit({ type: "agents", agents: [...agents.values()] });

    this.post({
      roomId,
      authorId: "system",
      kind: "event",
      text: `forged · ${agent.name} (${agent.role}) from ${template} · by ${orchestrator.name}`,
    });
    gitCommitFile(agent.file, `forge(${agent.id}): ${template} by ${orchestrator.id}`, orchestrator.id);
    return agent;
  }

  /**
   * Honour a planner's `access`: Dominic said "i-access mo ang X" or "tignan mo
   * ang KooyaPedia" in the room, so the named agents get read access to X, or
   * the KooyaPedia lookup wrapper, before anyone answers. This is what makes
   * the room behave like Claude Code in auto mode: he names a project, the
   * room can look at it.
   *
   * Guards, in order: the message is Dominic's own (not relayed from WhatsApp),
   * it actually asks to look, the folder exists and sits under ACCESS_ROOTS,
   * and it is not the agora repo itself. Everything else is a notice, not an
   * exception, so the run carries on with what the room already had.
   */
  private applyAccess(opts: {
    roomId: string;
    orchestrator: Agent;
    roster: Agent[];
    agents: Map<string, Agent>;
    humanText: string;
    request: { kind: "dir" | "kooyapedia"; path: string | null; agents: string[] };
  }): void {
    const { roomId, orchestrator, roster, agents, humanText, request } = opts;
    const refuse = (why: string): void => {
      this.post({ roomId, authorId: "system", kind: "notice", text: `Access not granted: ${why}` });
    };
    if (/^\s*\[relayed via/i.test(humanText)) return refuse("only a message Dominic types into the room can grant access.");
    if (!LOOK_WORDS.test(humanText)) return refuse("Dominic's message did not ask the room to look at anything.");

    let grant: { tools?: string[]; dirs?: string[]; allow?: string[] };
    let label: string;
    if (request.kind === "kooyapedia") {
      grant = KOOYAPEDIA_GRANT;
      label = "KooyaPedia";
    } else {
      const wanted = toWslPath(request.path ?? "");
      if (!wanted.startsWith("/")) return refuse(`"${request.path}" is not an absolute folder path.`);
      if (!existsSync(wanted)) return refuse(`"${wanted}" does not exist as seen from WSL.`);
      let real: string;
      try {
        real = realpathSync(wanted);
      } catch {
        return refuse(`"${wanted}" cannot be resolved.`);
      }
      if (!statSync(real).isDirectory()) return refuse(`"${real}" is a file, not a folder.`);
      if (real === config.root || real.startsWith(config.root + "/")) {
        return refuse("the agora repo itself is never opened to a room — it holds the .env.");
      }
      if (!ACCESS_ROOTS.some((r) => real === r || real.startsWith(r + "/"))) {
        return refuse(`"${real}" is outside the folders a room may be given (${ACCESS_ROOTS.join(", ")}).`);
      }
      grant = { tools: ["Read", "Glob", "Grep"], dirs: [real] };
      label = real;
    }

    const named = (request.agents ?? []).map((a) => a.trim().toLowerCase()).filter((a) => agents.has(a));
    const targets = (named.length ? named : roster.map((a) => a.id)).filter((id) => id !== orchestrator.id || named.includes(id));
    if (!targets.length) return refuse("no agent on the roster to grant it to.");

    const done: string[] = [];
    for (const id of targets) {
      try {
        const updated = grantAccess(id, grant);
        agents.set(id, updated);
        const at = roster.findIndex((a) => a.id === id);
        if (at !== -1) roster[at] = updated;
        gitCommitFile(updated.file, `access(${id}): ${label} — granted by Dominic in the room`, "dominic");
        done.push(updated.name);
      } catch (err) {
        this.post({
          roomId,
          authorId: "system",
          kind: "notice",
          text: `Access to ${label} for ${id} failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    if (!done.length) return;
    this.emit({ type: "agents", agents: [...agents.values()] });
    this.post({
      roomId,
      authorId: "system",
      kind: "event",
      text: `access · ${done.join(", ")} may now read ${label} · granted by Dominic`,
    });
    if (request.kind === "dir") {
      this.post({
        roomId,
        authorId: "system",
        kind: "notice",
        text: `Read-only. Never open or quote a .env* file under ${label}; anything said here can reach WhatsApp.`,
      });
    }
  }

  /**
   * Honour a planner's `createRoom`. Only when Dominic's own message asked for
   * a room — the schema says so, and the cheap word check here is the backstop
   * against a planner that got carried away. The new room reads a fresh rules
   * file and inherits WhatsApp from the global JID until Dominic sets
   * AGORA_NOTIFY_JID_<SLUG>, which the notice below tells him.
   */
  private createRoomFor(opts: {
    roomId: string;
    orchestrator: Agent;
    agents: Map<string, Agent>;
    humanText: string;
    request: { name: string; topic: string; members: string[] };
  }): void {
    const { roomId, orchestrator, agents, humanText, request } = opts;
    const refuse = (why: string): void => {
      this.post({ roomId, authorId: "system", kind: "notice", text: `Room not created: ${why}` });
    };
    if (!/\b(room|channel|kwarto|group)\b/i.test(humanText)) {
      return refuse("Dominic's message did not ask for one.");
    }
    const name = (request.name ?? "").trim().slice(0, 60);
    const slug = slugify(name);
    if (!name || !slug) return refuse("it needs a name.");
    if (listRooms().some((r) => slugify(r.name) === slug)) {
      return refuse(`"${name}" already exists.`);
    }
    const members = [...new Set((request.members ?? []).filter((m) => agents.has(m)))];
    if (!members.includes(orchestrator.id)) members.unshift(orchestrator.id);
    const orchestratorId = members.find((m) => agents.get(m)?.orchestrator) ?? orchestrator.id;

    const room = createRoom({ name, topic: (request.topic ?? "").trim(), members, orchestratorId });
    const rules = writeRoomRules(name, room.topic);
    if (rules) gitCommitFile(rules, `room(${slug}): rules file`, orchestrator.id);
    this.emit({ type: "rooms", rooms: listRooms() });
    this.post({
      roomId,
      authorId: "system",
      kind: "event",
      text: `room created · ${name} · ${members.length} member${members.length === 1 ? "" : "s"} · orchestrator ${agents.get(orchestratorId)?.name ?? orchestratorId}`,
    });
    this.post({
      roomId,
      authorId: "system",
      kind: "notice",
      text:
        `Dominic: ang bagong room na "${name}" ay magpapadala sa global na WhatsApp group hangga't ` +
        `walang AGORA_NOTIFY_JID_${slug.toUpperCase().replace(/-/g, "_")} sa .env ` +
        `(ilagay ang JID, o "off"). Rules file: agents/_rules-${slug}.md`,
    });
    this.post({
      roomId: room.id,
      authorId: "system",
      kind: "event",
      text: `created by ${orchestrator.name} · ${humanText.slice(0, 120)}`,
    });
  }

  /** Run one agent turn, streaming deltas out as they arrive. */
  private async runTurn(opts: {
    agent: Agent;
    roomName: string;
    roster: Agent[];
    /** Tools off for this one reply — see buildSystemPrompt's chatTurn note. */
    chatTurn?: boolean;
    /** Override the agent's own effort: chat, discussion and rewrite turns run low. */
    effort?: string;
    /** Override the agent's model: the length guard compresses on the cheap one. */
    model?: string;
    prompt: string;
    schema?: object;
    signal: AbortSignal;
    roomId: string;
    /** Phase once the Claude slot is held. */
    busyPhase: RunPhase;
  }): Promise<{
    text: string;
    structured: unknown;
    costUsd: number | null;
    isError: boolean;
    timedOut: boolean;
    durationMs: number;
    /** Identifies the exact system prompt this turn ran under. */
    promptSha: string;
  }> {
    const run = this.runs.get(opts.roomId);
    if (run && this.gate.saturated) {
      this.setPhase(
        run.state,
        "waiting_slot",
        `Waiting for a free Claude slot (${config.maxConcurrency} max)`,
      );
    }

    const release = await this.gate.acquire();
    const turnStartedAt = Date.now();
    if (run) {
      run.state.speaking = opts.agent.id;
      run.state.turnStartedAt = turnStartedAt;
      this.setPhase(run.state, opts.busyPhase, null);
    }

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

    // Hashed so a message row can say which L0 + room rules + agent file
    // produced it; before/after comparisons of a prompt edit group on this.
    const systemPrompt = buildSystemPrompt(opts.agent, opts.roomName, opts.roster, {
      chatTurn: opts.chatTurn,
    });
    const promptSha = createHash("sha1").update(systemPrompt).digest("hex").slice(0, 12);

    try {
      let text = "";
      let structured: unknown = null;
      let costUsd: number | null = null;
      let isError = false;

      for await (const event of this.driverFor(opts.busyPhase).run({
        systemPrompt,
        prompt: opts.prompt,
        model: opts.model ?? opts.agent.model,
        effort: opts.effort ?? opts.agent.effort,
        // Enforcement stays: a chat turn genuinely gets no tools. What changed
        // is that the agent is told they are off for this reply, not absent.
        tools: opts.chatTurn ? [] : opts.agent.tools,
        addDirs: opts.chatTurn ? [] : opts.agent.addDirs,
        mcp: opts.chatTurn ? [] : opts.agent.mcp,
        allow: opts.chatTurn ? [] : opts.agent.allow,
        mcpConfigs: opts.agent.mcpConfigs,
        ...(opts.schema ? { schema: opts.schema } : {}),
        phase: opts.busyPhase,
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
          if (run) {
            this.setPhase(run.state, "rate_limited", event.detail.slice(0, 200));
          }
          this.emit({ type: "rate_limit", roomId: opts.roomId, detail: event.detail });
        } else if (event.type === "tool_use") {
          if (run) {
            this.setPhase(run.state, opts.busyPhase, `Using ${event.name}`);
          }
        } else {
          text = event.text;
          structured = event.structured;
          costUsd = event.costUsd;
          isError = event.isError;
        }
      }
      return {
        text,
        structured,
        costUsd,
        isError,
        timedOut,
        durationMs: Date.now() - turnStartedAt,
        promptSha,
      };
    } finally {
      clearTimeout(turnTimer);
      opts.signal.removeEventListener("abort", onRunAbort);
      if (run) {
        run.state.lastTurnMs = Date.now() - turnStartedAt;
        run.state.turnStartedAt = null;
      }
      release();
    }
  }

  /**
   * Backstop for the length rule.
   *
   * L0 states the budget once and the per-turn instruction repeats it, so most
   * turns land inside it. This catches the ones that do not: one rewrite on the
   * cheap model with tools off and the same system prompt (so the cache prefix
   * is hit), asking for the same facts in fewer words. It never truncates —
   * `@next:` is the last line and the fast path reads it, so cutting text off
   * would silently break dispatch. If the rewrite is still over, the shorter of
   * the two posts and the miss is logged so the metric records it.
   */
  private async enforceLength(opts: {
    agent: Agent;
    roomName: string;
    roster: Agent[];
    roomId: string;
    signal: AbortSignal;
    text: string;
  }): Promise<{ text: string; costUsd: number | null }> {
    const original = opts.text.trim();
    if (!config.lengthGuard || !original) return { text: original, costUsd: null };
    const act = parseMarkers(original).act;
    const limit = wordLimitFor(act);
    const words = bodyWords(original);
    const over = words > limit * 1.3 || original.length > REPLY_LIMITS.hardChars;
    if (!over) return { text: original, costUsd: null };

    const result = await this.runTurn({
      agent: opts.agent,
      roomName: opts.roomName,
      roster: opts.roster,
      roomId: opts.roomId,
      signal: opts.signal,
      chatTurn: true,
      effort: "low",
      model: config.model,
      busyPhase: "generating",
      prompt: [
        `You just wrote this reply (${words} words; the room limit for a \`${act ?? "claim"}\` is ${limit}):`,
        "---",
        original,
        "---",
        "",
        `Rewrite it as ONE chat message under ${limit} words, Taglish. Keep every fact,`,
        `number, path and \`[#id]\`. Keep the first-line \`kind:\` and the last-line`,
        `\`@next:\` exactly as they are. Drop headings, bullets, narration, and any`,
        `closing checklist. Output only the message.`,
      ].join("\n"),
    });
    const rewritten = result.text.trim();
    const after = rewritten ? bodyWords(rewritten) : words;
    const usable =
      rewritten.length > 0 &&
      !result.isError &&
      after < words &&
      (parseMarkers(rewritten).act !== null || act === null);
    console.log(
      JSON.stringify({
        event: "length",
        room: opts.roomId,
        agent: opts.agent.id,
        act,
        words,
        limit,
        rewritten: usable,
        after: usable ? after : words,
        stillOver: (usable ? after : words) > limit * 1.3,
      }),
    );
    return { text: usable ? rewritten : original, costUsd: result.costUsd };
  }

  /**
   * Several agents talk the question through, in the room, hearing each other.
   *
   * The rest of this system is deliberately hub-and-spoke: one agent works,
   * reports to the orchestrator, and the orchestrator picks who is next. That
   * is the right shape for getting work done and the wrong shape for making a
   * call, because nobody ever hears anybody else — every opinion arrives
   * addressed to the manager and dies there.
   *
   * Here each speaker sees what the people before them just said and is asked
   * to answer THEM, by name. The last one is asked to land it, so a discussion
   * ends with a position rather than three parallel monologues.
   */
  private async runDiscussion(opts: {
    roomId: string;
    room: Room;
    roster: Agent[];
    agents: Map<string, Agent>;
    orchestrator: Agent;
    state: RunState;
    signal: AbortSignal;
    question: string;
    speakers: Agent[];
  }): Promise<void> {
    const { roomId, room, roster, agents, orchestrator, state, signal, question, speakers } =
      opts;

    this.post({
      roomId,
      authorId: "system",
      kind: "event",
      text: `discussing · ${speakers.map((a) => a.name).join(", ")}`,
    });

    for (let i = 0; i < speakers.length; i++) {
      if (signal.aborted) return;
      const speaker = speakers[i]!;
      const before = speakers.slice(0, i);
      const after = speakers.slice(i + 1);
      const last = i === speakers.length - 1;

      state.speaking = speaker.id;
      this.publishRun(state);
      this.emit({
        type: "turn_start",
        roomId,
        agentId: speaker.id,
        // The chain, not the manager: this shows in the transcript as who they
        // are actually answering.
        directedBy: before.length ? before[before.length - 1]!.id : orchestrator.id,
        turn: state.turn,
      });

      const result = await this.runTurn({
        agent: speaker,
        roomName: room.name,
        roster,
        roomId,
        signal,
        busyPhase: "generating",
        // A position in a conversation, not an investigation.
        effort: "low",
        prompt: [
          renderRoomView({
            roomId,
            viewerId: speaker.id,
            messages: listMessages(roomId, config.transcriptWindow),
            agents,
          }),
          "",
          `${orchestrator.name} has put this to the room:`,
          "---",
          question,
          "---",
          "",
          before.length
            ? `${before.map((a) => `${a.name} (${a.role})`).join(" and ")} ` +
              `${before.length === 1 ? "has" : "have"} already spoken — their messages are` +
              ` at the end of the transcript above. Answer THEM, by name. Say where you` +
              ` agree, and say plainly where you do not. "I think X is wrong about the` +
              ` severity here, because…" is exactly the kind of thing this room is for.`
            : `You are first. Give your actual position and the reason for it, so the` +
              ` others have something concrete to push against.`,
          after.length
            ? `${after.map((a) => a.name).join(" and ")} will answer after you.`
            : "",
          last
            ? `You are last. Land it: say what the room should actually do, and if the` +
              ` others disagreed, say whose argument you are taking and why.`
            : "",
          "",
          `This is a conversation, not a report. Taglish, 1 to 3 sentences, about`,
          `${REPLY_LIMITS.short} words, no preamble, no "great point", no restating the`,
          `question. Speak only to what you actually know; outside your area, say so`,
          `in one line and name who should call it. Start with \`kind:\`, end with \`@next:\`.`,
        ]
          .filter(Boolean)
          .join("\n"),
      });

      this.emit({ type: "turn_end", roomId, agentId: speaker.id });
      if (result.costUsd) state.costUsd += result.costUsd;
      state.lastTurnCostUsd = result.costUsd;
      state.lastTurnMs = result.durationMs;

      if (result.text.trim()) {
        const guarded = await this.enforceLength({
          agent: speaker,
          roomName: room.name,
          roster,
          roomId,
          signal,
          text: result.text,
        });
        if (guarded.costUsd) state.costUsd += guarded.costUsd;
        this.post({
          roomId,
          authorId: speaker.id,
          kind: "agent",
          text: guarded.text,
          directedBy: before.length ? before[before.length - 1]!.id : orchestrator.id,
          costUsd: sumCost(result.costUsd, guarded.costUsd),
          durationMs: result.durationMs,
          promptSha: result.promptSha,
        });
      }
    }
    state.speaking = null;
    this.publishRun(state);
  }

  /**
   * Hand the floor to one agent and record what it said.
   *
   * Extracted because two paths now reach it: the orchestrator assigning a turn,
   * and the cheap path honouring an `@next:` marker. Keeping one implementation
   * means the fast path cannot quietly diverge — same prompt shape, same timeout
   * handling, same row written.
   */
  private async dispatchTo(opts: {
    agent: Agent;
    room: Room;
    roomId: string;
    roster: Agent[];
    agents: Map<string, Agent>;
    directedBy: string;
    /** What to tell the agent about why it is speaking. */
    instruction: string;
    state: RunState;
    signal: AbortSignal;
  }): Promise<"ok" | "timed_out" | "aborted"> {
    const { agent, room, roomId, roster, agents, directedBy, instruction, state, signal } = opts;

    state.speaking = agent.id;
    this.publishRun(state);
    this.emit({
      type: "turn_start",
      roomId,
      agentId: agent.id,
      directedBy,
      turn: state.turn,
    });

    const result = await this.runTurn({
      agent,
      roomName: room.name,
      roster,
      roomId,
      signal,
      busyPhase: "generating",
      prompt: [
        // Split at this agent's own last message, so it can tell what it has
        // already answered from what arrived while it was away.
        renderRoomView({
          roomId,
          viewerId: agent.id,
          messages: listMessages(roomId, config.transcriptWindow),
          agents,
        }),
        "",
        instruction,
      ].join("\n"),
    });

    this.emit({ type: "turn_end", roomId, agentId: agent.id });
    if (result.costUsd) state.costUsd += result.costUsd;
    state.lastTurnCostUsd = result.costUsd;
    state.lastTurnMs = result.durationMs;
    this.publishRun(state);

    // A turn that hit its own deadline fails alone. The orchestrator sees it in
    // the transcript next turn and can reassign, narrow the ask, or stop — which
    // is a better outcome than losing the whole run.
    if (result.timedOut) {
      this.post({
        roomId,
        authorId: "system",
        kind: "notice",
        text: `${agent.name} ran past ${Math.round(config.turnTimeoutMs / 1000)}s and was cut off. Nothing from that turn was kept.`,
        durationMs: result.durationMs,
      });
      return "timed_out";
    }

    if (signal.aborted) return "aborted";

    const guarded = await this.enforceLength({
      agent,
      roomName: room.name,
      roster,
      roomId,
      signal,
      text: result.text,
    });
    if (guarded.costUsd) state.costUsd += guarded.costUsd;

    this.post({
      roomId,
      authorId: agent.id,
      kind: "agent",
      text: guarded.text || "(no reply)",
      directedBy,
      costUsd: sumCost(result.costUsd, guarded.costUsd),
      durationMs: result.durationMs,
      promptSha: result.promptSha,
    });
    return "ok";
  }

  /**
   * Who the last speaker handed to, when that can be honoured without asking the
   * orchestrator — the change that removes a full model round trip per message.
   *
   * Returns null whenever the decision genuinely needs a mind behind it. Every
   * refusal is deliberate:
   *
   *   no marker / unparsed   the room has not earned the fast path yet
   *   @next: none            the author thinks the work is done, and closing a
   *                          goal is never a thing to do without a decision turn
   *   BLOCKED:               belongs to whoever owns the plan, not to the next
   *                          agent in a chain
   *   not on the roster      a hallucinated colleague
   *   itself                 the contract forbids it; honouring it is a loop
   *   ping-pong              two agents volleying is a conversation with no
   *                          progress; a decision turn breaks it
   *   starvation             someone has gone unheard long enough that the room
   *                          needs re-planning, not another hop
   */
  private fastNext(opts: {
    roomId: string;
    roster: Agent[];
    orchestrator: Agent;
    recent: string[];
    lastSpokeTurn: Map<string, number>;
    turn: number;
  }): Agent | null {
    const { roomId, roster, orchestrator, recent, lastSpokeTurn, turn } = opts;
    if (!config.fastDispatch) return null;

    const recentMsgs = listMessages(roomId, 8);
    const last = [...recentMsgs].reverse().find((m) => m.kind === "agent");
    if (!last) return null;

    const refuse = (reason: string): null => {
      console.log(
        JSON.stringify({ event: "fast_dispatch", room: roomId, taken: false, reason }),
      );
      return null;
    };

    if (/^\s*BLOCKED:/m.test(last.text)) return refuse("blocked");
    if (!last.nextId) return refuse("no_marker");
    if (last.nextId === "none") return refuse("next_none");
    if (last.nextId === last.authorId) return refuse("self");

    const target = roster.find((a) => a.id === last.nextId);
    if (!target) return refuse("not_on_roster");
    if (target.id === orchestrator.id) return refuse("names_orchestrator");

    // Ping-pong: A,B,A,B is two full round trips with nobody else involved.
    const tail = recent.slice(-4);
    if (
      tail.length === 4 &&
      tail[0] === tail[2] &&
      tail[1] === tail[3] &&
      tail[0] !== tail[1] &&
      tail[3] === last.authorId &&
      tail[2] === target.id
    ) {
      return refuse("ping_pong");
    }

    // Starvation: somebody on the roster has not been heard from in a while.
    for (const a of roster) {
      if (a.id === orchestrator.id) continue;
      const seen = lastSpokeTurn.get(a.id);
      if (seen === undefined) continue; // never spoken this run; the plan owns that
      if (turn - seen >= 10) return refuse("starvation");
    }

    console.log(
      JSON.stringify({
        event: "fast_dispatch",
        room: roomId,
        taken: true,
        from: last.authorId,
        to: target.id,
      }),
    );
    return target;
  }

  /**
   * Write reported step statuses to the board and announce each change.
   *
   * Every path that learns something about a step goes through here, so the
   * board and the transcript can never drift apart.
   */
  private applySteps(
    roomId: string,
    goalId: string,
    reported: Array<{ index: number; status: StepStatus; note: string | null }> | null | undefined,
    agents: Map<string, Agent>,
  ): void {
    if (!reported?.length) return;
    let touched = false;
    for (const r of reported) {
      const updated = updateStep(goalId, r.index, r.status, r.note);
      if (!updated) continue;
      touched = true;
      const owner = updated.ownerId ? agents.get(updated.ownerId) : undefined;
      this.post({
        roomId,
        authorId: "system",
        kind: "event",
        text:
          `step ${r.status} · ${updated.idx + 1}. ${updated.title}` +
          (owner ? ` · ${owner.name}` : "") +
          (r.note ? ` — ${r.note}` : ""),
      });
    }
    if (touched) {
      const goal = getGoal(goalId);
      if (goal) this.emit({ type: "goal", goal });
    }
  }

  /**
   * Is this "blocked" contradicted by what the room actually holds?
   *
   * Twice in the Trunks room a run stopped with "nobody here has a write grant"
   * while four agents held `erasr-edit.sh` the whole time. The agents were not
   * lying — a direct `Write` really is denied — they just could not see that
   * their grant had a different shape. Both times it reached Dominic as a
   * blocker only he could clear, and both times the room could have cleared it
   * itself.
   *
   * So before an escalation leaves the building, check the claim against the
   * roster. Returns the correction to post, or null when the blocker is real.
   *
   * Deliberately narrow: it only fires on a claim about tooling that the roster
   * plainly contradicts. A blocker needing a decision, a credential, or the GPU
   * is not something this can second-guess, and must still reach him.
   */
  private capabilityCorrection(text: string, roster: Agent[]): string | null {
    const claim = text.toLowerCase();
    const deniesTooling =
      /(no|nobody|no one|none of us|nor any)[^.]{0,60}(write|edit|execute|run|tool|grant|access)/.test(
        claim,
      ) ||
      /(cannot|can't|can not|unable to)[^.]{0,40}(write|edit|apply|execute|run)/.test(claim) ||
      /sandbox deni|permission deni|tooling wall|read-only (this )?session/.test(claim);
    if (!deniesTooling) return null;

    const holders = roster.filter((a) => a.allow.length > 0 || a.tools.length > 0);
    if (holders.length === 0) return null;

    const lines = holders.map((a) => {
      const wrappers = a.allow
        .map((g) => /scripts\/([a-z-]+\.sh)/.exec(g)?.[1])
        .filter((x): x is string => Boolean(x));
      const what = wrappers.length
        ? wrappers.join(", ")
        : a.tools.join(", ") || "no tools";
      return `  · ${a.name} (${a.role}) — ${what}`;
    });

    return [
      "Hold on — that is not what the roster says.",
      "",
      "The run was about to stop and tell Dominic nobody here can do this. What",
      "this room actually holds right now:",
      "",
      ...lines,
      "",
      "A direct Write or Edit IS denied — that part is true. The grant has a",
      "different shape: it is a wrapper script, called through Bash. If you hold",
      "one, you are not blocked, and reporting yourself blocked while holding it",
      "is a stalled turn.",
      "",
      "Assign whoever owns the lane and have them use their wrapper. Escalate",
      "only if that genuinely fails, and then say what the wrapper did.",
    ].join("\n");
  }

  /**
   * Stop and ask the orchestrator where the goal actually stands.
   *
   * Runs every `config.maxTurns` turns. Returns true to keep working. This is
   * the pulse Dominic follows in the room, and the only thing that can decide
   * a run is over short of the goal being met.
   */
  private async reviewProgress(opts: {
    roomId: string;
    room: Room;
    orchestrator: Agent;
    roster: Agent[];
    agents: Map<string, Agent>;
    state: RunState;
    signal: AbortSignal;
    round: number;
    /** The orchestrator just said the work is finished — check that. */
    final?: boolean;
  }): Promise<boolean> {
    const { roomId, room, orchestrator, roster, agents, state, signal, round } = opts;
    const final = opts.final === true;

    const result = await this.runTurn({
      agent: orchestrator,
      roomName: room.name,
      roster,
      roomId,
      schema: PROGRESS_SCHEMA,
      signal,
      busyPhase: "deciding",
      prompt: [
        mindStoneText(roomId),
        final
          ? `You just said the work is finished. Before this goal closes, settle the board.`
          : `Progress review ${round} of ${config.maxRounds}. Stop and take stock.`,
        "",
        `Room transcript so far:`,
        "---",
        renderTranscript(listMessages(roomId, config.transcriptWindow), agents) || "(empty)",
        "---",
        "",
        planText(state.goalId),
        "",
        // Without this the review judged the deliverable purely from step
        // statuses and escalated "the prompt was never written" while a
        // complete 1,977-character prompt sat in the goal's handoff field.
        handoffState(state.goalId),
        "",
        `This room does not stop because it has used up turns. It stops when the`,
        `goal is met, or when it genuinely cannot proceed without Dominic.`,
        "",
        `Answer "continue" if the remaining steps are still reachable from here —`,
        `slow is not blocked, and a step nobody has started yet is not blocked.`,
        `Answer "done" only if every step is genuinely finished; a step you never`,
        `reached is not done, and reporting one that way is the false green the`,
        `house rules exist to prevent.`,
        `Answer "blocked" only when the work has actually stopped and nothing in`,
        `this room can restart it: you need a decision, a credential, a change to`,
        `the code, or access that none of us has. Then say exactly what you need.`,
        "",
        `And mark the board the same way. A step that is only waiting its turn is`,
        `"pending", never "blocked" — "depends on step 1" is the single most common`,
        `thing written in a blocked note here, and it is not a blocker, it is the`,
        `plan working. It matters because a goal that closes with any blocked step`,
        `closes as stopped, and a stopped goal never picks itself back up: calling`,
        `an unstarted step blocked ends the whole goal on a dependency that was`,
        `about to be met, and then waits for Dominic to notice.`,
        "",
        `The summary is what Dominic reads to follow along. Where things stand,`,
        `not what you are about to do next.`,
        "",
        `In "steps", give the real status of every step that is no longer just`,
        `waiting. Dominic watches that board; a step the room finished but never`,
        `ticked reads to him as work that was never done. If the room did it,`,
        `mark it done. If it never happened, leave it — do not tick it to make`,
        `the card look better.`,
        final
          ? `Answer "done" only if the board you just gave says every step is done.`
          : "",
      ].join("\n"),
    });

    if (signal.aborted) return false;

    const out = result.structured as {
      verdict?: string;
      summary?: string;
      steps?: Array<{ index: number; status: StepStatus; note: string | null }>;
      blocker?: string | null;
      needFromDominic?: string | null;
      choices?: Choice[] | null;
    } | null;

    // Before anything else: make the board match what actually happened. This
    // is why a goal could read "1 of 3 done" while the orchestrator was saying
    // the work was finished — nothing ever went back and settled the steps.
    if (state.goalId) this.applySteps(roomId, state.goalId, out?.steps, agents);

    // A failed review is not a reason to abandon work that is going fine. Say
    // so and carry on; the wall-clock cap and round ceiling still bound it.
    if (result.isError || !out?.verdict) {
      this.post({
        roomId,
        authorId: "system",
        kind: "notice",
        text: "Progress review failed to return a verdict — continuing.",
      });
      return true;
    }

    const summary = cleanField(out.summary);
    if (summary) {
      this.post({
        roomId,
        authorId: orchestrator.id,
        kind: "agent",
        text: `Progress check ${round}/${config.maxRounds}\n\n${summary}`,
        directedBy: null,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      });
    }

    if (out.verdict === "continue") return true;

    if (out.verdict === "done") {
      state.stopReason = "done";
      return false;
    }

    // blocked — but first, is it true? A claim that the room lacks a capability
    // it demonstrably holds is not a blocker, it is a misread of its own grants,
    // and sending it to Dominic teaches him to distrust the ones that are real.
    const claimed = `${out.blocker ?? ""} ${out.needFromDominic ?? ""} ${summary ?? ""}`;
    const correction = this.capabilityCorrection(claimed, roster);
    if (correction && !this.corrected.has(roomId)) {
      // Once per run. If the room insists after being corrected, it has looked
      // and the second answer is believed — otherwise this becomes a loop that
      // never lets a real blocker out.
      this.corrected.add(roomId);
      this.post({
        roomId,
        authorId: "system",
        kind: "notice",
        text: correction,
      });
      return true;
    }

    // A blocker with nothing in it to act on is not a blocker — it is a run
    // that stopped and left him a notice he cannot answer. Sending it back once
    // costs one turn; letting it through costs the rest of the goal, because
    // "blocked" never auto-resumes. If the second answer is still empty the
    // room has genuinely nothing to ask for and it escalates as it is, rather
    // than looping here.
    const hasAsk =
      Boolean(cleanField(out.blocker)) ||
      Boolean(cleanField(out.needFromDominic)) ||
      (out.choices ?? []).length >= 2;
    if (!hasAsk && !this.vague.has(roomId)) {
      this.vague.add(roomId);
      this.post({
        roomId,
        authorId: "system",
        kind: "notice",
        text:
          "You answered blocked but named nothing to act on — no blocker, no ask, " +
          "no options. Stopping there ends the goal and nobody can restart it, " +
          "because a blocked run never picks itself back up. Carry on, and when " +
          "you next stop say exactly what stopped, the one thing you need from " +
          "Dominic, and — if it is a decision — the two to four options he can " +
          "tap.",
      });
      return true;
    }

    state.stopReason = "blocked";
    const need = cleanField(out.needFromDominic);
    const blocker = cleanField(out.blocker);
    const report = withRoles(
      [
        `⚠️ Not done — ${room.name} is stuck and needs you.`,
        blocker ? `\nWhat stopped: ${blocker}` : "",
        need ? `\nWhat I need from you: ${need}` : "",
        summary ? `\nWhere it stands: ${summary}` : "",
        (out.choices ?? []).length >= 2
          ? "\nYour options (tap one in Agora, or just reply here):\n" +
            (out.choices ?? [])
              .map((c, i) => `${i + 1}. ${c.label}${c.detail ? ` — ${c.detail}` : ""}`)
              .join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      roster,
    );

    const choices = (out.choices ?? [])
      .filter((c) => c?.label?.trim())
      .map((c) => ({ label: c.label.trim().slice(0, 90), detail: (c.detail ?? "").trim() }))
      .slice(0, 4);

    this.post({
      roomId,
      authorId: orchestrator.id,
      kind: "handoff",
      text: report,
      directedBy: null,
      // Two or more, or none: a single button is not a decision.
      choices: choices.length >= 2 ? choices : null,
    });
    // Forced past the rate limiter: a room that has stopped working is exactly
    // the message that must not be dropped for being too soon after the last.
    this.recordNotify(roomId, report, "escalation");
    return false;
  }

  /**
   * Fold everything since the last compaction into the room's mind stone.
   *
   * Runs after a goal closes, never during one — a compaction turn competes
   * for the same rate limit as the work, and folding a half-finished run in
   * would record conclusions the room has not reached yet.
   *
   * The model REWRITES the whole memory rather than appending. Appending grows
   * without bound and accumulates contradictions; a rewrite forces a decision
   * about what still matters.
   */
  private async compactMindStone(
    roomId: string,
    orchestrator: Agent,
    roster: Agent[],
    roomName: string,
    agents: Map<string, Agent>,
  ): Promise<void> {
    const pending = unfoldedMessages(roomId);
    if (pending.length < config.mindStoneEvery) return;

    const existing = getMindStone(roomId);
    const newest = pending[pending.length - 1]!.createdAt;

    const result = await this.runTurn({
      agent: orchestrator,
      roomName,
      roster,
      roomId,
      schema: MIND_STONE_SCHEMA,
      signal: new AbortController().signal,
      busyPhase: "compacting",
      prompt: [
        `You are compacting this room's long-term memory — its "mind stone".`,
        `Agents only see the most recent messages, so anything not written here`,
        `is forgotten the moment it scrolls out of the window.`,
        "",
        existing?.content.trim()
          ? ["Current memory:", "---", existing.content.trim(), "---", ""].join("\n")
          : "There is no memory yet; you are writing the first one.\n",
        `${pending.length} new messages since the last compaction:`,
        "---",
        renderTranscript(pending, agents),
        "---",
        "",
        `Rewrite the WHOLE memory. You are replacing it, not appending to it.`,
        "",
        `Keep, because these are expensive to re-learn:`,
        `  · decisions Dominic made, and what he explicitly rejected`,
        `  · facts established with evidence — a file and line, a confirmed bug,`,
        `    a measured number, a verdict that was corroborated`,
        `  · what is blocked and precisely what would unblock it`,
        `  · constraints and preferences he has stated`,
        `  · anything that would otherwise be asked a second time`,
        "",
        `Drop: pleasantries, restatements, superseded plans, anything already`,
        `implied by the room's rules, and detail nobody will act on again.`,
        `Merge duplicates rather than listing them twice.`,
        "",
        `Write it for an agent starting cold. Short declarative lines grouped`,
        `under plain headings. No narrative of who said what and when — this is`,
        `what the room KNOWS, not a diary of how it found out.`,
        `If something is uncertain, say so; a memory that overstates is worse`,
        `than one that admits a gap.`,
      ].join("\n"),
    });

    const memory = (result.structured as { memory?: string } | null)?.memory?.trim();
    if (!memory || result.isError) return;

    const stone = saveMindStone(roomId, memory, newest, pending.length);
    this.post({
      roomId,
      authorId: "system",
      kind: "event",
      text: `mind stone updated · ${pending.length} messages folded in · ${stone.messages} total`,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    });
    this.emit({ type: "mind_stone", roomId, stone });
  }

  /**
   * Run the room. With `resumeGoalId` the run picks up an existing goal
   * instead of planning a new one from `humanText`.
   */
  async start(roomId: string, humanText: string, resumeGoalId?: string): Promise<void> {
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

    let resumed: Goal | null = null;
    if (resumeGoalId) {
      resumed = reopenGoal(resumeGoalId);
      if (!resumed) {
        this.emit({ type: "error", roomId, detail: "That goal no longer exists." });
        return;
      }
      this.emit({ type: "goal", goal: resumed });
    } else {
      this.post({ roomId, authorId: "human", kind: "human", text: humanText });
    }

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
      phase: "planning",
      phaseDetail: null,
      timeoutMs: config.runTimeoutMs,
      turnStartedAt: null,
      lastTurnMs: null,
      lastTurnCostUsd: null,
    };
    if (resumed) {
      state.goalId = resumed.id;
      state.phase = "deciding";
    }
    this.runs.set(roomId, { abort, state });
    this.publishRun(state);
    if (resumed) {
      const left = resumed.steps.filter((st) => st.status !== "done").length;
      this.post({
        roomId,
        authorId: "system",
        kind: "event",
        text: `resumed · ${resumed.title} · ${left} step${left === 1 ? "" : "s"} left`,
      });
    }

    const deadline = setTimeout(() => {
      state.stopReason = "timeout";
      abort.abort();
    }, config.runTimeoutMs);

    try {
      // Resuming skips planning entirely: the goal and its steps already
      // exist, and re-planning them would produce a second goal describing
      // the same work — which is exactly what retyping the prompt does, and
      // exactly what resume exists to avoid.
      if (!resumeGoalId) {
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
          busyPhase: "planning",
          prompt: [
            mindStoneText(roomId),
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
            lastGoalContext(roomId),
            "",
            `FIRST decide the mode. This is the most consequential call you make.`,
            ``,
            `"answer" — he is TALKING to the room. A question, an opinion, "what do`,
            `  you think", "explain this", "is that right". He wants a reply, not a`,
            `  project. Nothing is planned and nobody investigates. Leave steps empty.`,
            `  Then choose HOW the room answers:`,
            `    · one agent, in responder — when somebody plainly owns it and`,
            `      the others would only be agreeing.`,
            `    · two to four agents, in discuss — when the question has more`,
            `      than one defensible answer, spans specialties, or asks the room`,
            `      to weigh something up. They hear each other and argue it out.`,
            `      This is what he means by wanting the room to talk, so reach`,
            `      for it whenever it honestly fits; a real question with one`,
            `      obvious owner is still one reply.`,
            ``,
            `"work" — he ASSIGNED something. Build, run, check, audit, compare, find`,
            `  out, plan this properly. The room does it together. Break it into the`,
            `  smallest set of checkable steps and set responder to null.`,
            ``,
            `A PLAN HE HANDED YOU IS ALWAYS "work" — never "answer", never a`,
            `discussion. If his message carries steps, a spec, a config, a diff, an`,
            `experiment design or anything that reads as instructions, that IS the`,
            `plan. Do not re-derive it. Do not improve it into your own version. Do`,
            `not end it by handing it back to him.`,
            `Your steps ARE his steps, in his order, with an owner attached to each.`,
            `If something in it is wrong, note it in ONE line and carry on anyway —`,
            `stop only if proceeding would corrupt evidence or destroy an artifact.`,
            ``,
            `When it is genuinely ambiguous, choose "answer" — UNLESS he handed you a`,
            `plan, which is never ambiguous. Otherwise answer is far cheaper and he`,
            `can always follow up by assigning the work. Turning a question into a`,
            `six-step project is the more expensive mistake; handing a plan back`,
            `unexecuted is the worse one.`,
          ].join("\n"),
        });
        this.emit({ type: "turn_end", roomId, agentId: orchestrator.id });
        if (planResult.costUsd) state.costUsd += planResult.costUsd;
        state.lastTurnCostUsd = planResult.costUsd;
        state.lastTurnMs = planResult.durationMs;
        this.publishRun(state);

        const plan = (planResult.structured ?? null) as Plan | null;

        if (plan?.access && !abort.signal.aborted) {
          this.applyAccess({ roomId, orchestrator, roster, agents, humanText, request: plan.access });
        }
        if (plan?.createRoom && !abort.signal.aborted) {
          this.createRoomFor({ roomId, orchestrator, agents, humanText, request: plan.createRoom });
        }
        if (plan?.spawn && !abort.signal.aborted) {
          this.forge({ roomId, room, orchestrator, roster, agents, request: plan.spawn, goalId: null });
        }

        // --- answer mode: he asked, he did not assign -------------------------
        // No goal is created, which also means the finally block sends no
        // WhatsApp run report — a question answered in the room should not buzz
        // anybody's phone. One orchestrator turn plus one reply, then stop.
        // A question worth more than one voice becomes a discussion rather than
      // a single reply. Most of what Dominic sends is a question, so this is
      // where the room either feels alive or feels like a help desk.
      if (!abort.signal.aborted && plan?.mode === "answer" && plan.discuss?.length) {
        const speakers = plan.discuss
          .map((id) => resolveNext(id, roster))
          .filter((a): a is Agent => a !== null)
          .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i)
          .slice(0, 4);
        if (speakers.length >= 2) {
          await this.runDiscussion({
            roomId,
            room,
            roster,
            agents,
            orchestrator,
            state,
            signal: abort.signal,
            question: humanText,
            speakers,
          });
          const spoken = [...listMessages(roomId, 12)]
            .reverse()
            .filter((m) => m.kind === "agent")
            .slice(0, speakers.length)
            .reverse();
          if (spoken.length) {
            const digest = withRoles(
              `💬 ${room.name} talked it through:\n\n` +
                spoken
                  .map((m) => {
                    const who = agents.get(m.authorId);
                    return `*${who?.name ?? m.authorId}*: ${m.text.trim().slice(0, 420)}`;
                  })
                  .join("\n\n"),
              roster,
            );
            void notify(roomId, digest, { force: true, kind: "chatter" }).then((r) => {
              this.post({
                roomId,
                authorId: "system",
                kind: "notify",
                text: digest,
                delivered: r.delivered,
              });
            });
          }
          state.stopReason = "done";
          return;
        }
      }

      if (!abort.signal.aborted && plan?.mode === "answer") {
          const responder = pickResponder(
            plan.responder ?? null,
            roster,
            roomId,
            orchestrator,
          );


          state.turn++;
          state.speaking = responder.id;
          this.publishRun(state);
          this.emit({
            type: "turn_start",
            roomId,
            agentId: responder.id,
            directedBy: orchestrator.id,
            turn: state.turn,
          });

          // Tools off is the cheap default, but a factual question about the
          // repo cannot be answered from memory and should not be. Alex asked
          // to confirm a line in a workflow file, with no way to open it, can
          // only refuse — which is honest and useless.
          // The planner's call, with a deterministic backstop: when Dominic
          // literally asks someone to look at something and the responder can,
          // tools stay on for this reply.
          const asksToLook = LOOK_WORDS.test(humanText);
          const lookup = (plan.needsLookup === true || asksToLook) && responder.tools.length > 0;
          const reply = await this.runTurn({
            agent: responder,
            chatTurn: !lookup,
            ...(lookup ? {} : { effort: "low" }),
            roomName: room.name,
            roster,
            roomId,
            signal: abort.signal,
            busyPhase: "generating",
            prompt: [
              mindStoneText(roomId),
              `Room transcript so far:`,
              "---",
              renderTranscript(listMessages(roomId, config.transcriptWindow), agents) || "(empty)",
              "---",
              "",
              `Dominic asked this directly:`,
              "---",
              humanText,
              "---",
              "",
              lookup
                ? `Go and look at exactly what you need to answer this — the file, the`
                : `Answer him and stop. This is a conversation, not an assignment — do`,
              lookup
                ? `workflow, the tree, the screen in the browser — then answer from what`
                : `not open an investigation, do not plan, do not hand anything off, and`,
              lookup
                ? `you actually saw, with the path and line or what the page did. Do only`
                : `do not promise to go and look at something.`,
              lookup
                ? `what this question needs; this is one answer, not a full audit. Your`
                : `Answer from what you already know. If answering properly would need`,
              lookup
                ? `standing safety rules still hold — they are not suspended by a go-ahead.`
                : `work he has not asked for, say what you can and name the work he`,
              lookup ? `` : `would have to ask for — in one line, not a proposal.`,
              asksToLook && !lookup
                ? `He asked you to look at something and nothing you hold in this room can open it. ` +
                  `Say so in one plain sentence and name what would let you — a folder he can open ` +
                  `by saying "i-access mo ang <path>", or "tignan mo ang KooyaPedia" — then stop.`
                : ``,
              `Answer in at most three sentences, Taglish. Ito ang pupunta sa phone niya`,
              `as written, so plain words, no paths or tool names.`,
            ].join("\n"),
          });

          this.emit({ type: "turn_end", roomId, agentId: responder.id });
          if (reply.costUsd) state.costUsd += reply.costUsd;
          state.lastTurnCostUsd = reply.costUsd;
          state.lastTurnMs = reply.durationMs;

          if (reply.text.trim()) {
            const guarded = await this.enforceLength({
              agent: responder,
              roomName: room.name,
              roster,
              roomId,
              signal: abort.signal,
              text: reply.text,
            });
            if (guarded.costUsd) state.costUsd += guarded.costUsd;
            this.post({
              roomId,
              authorId: responder.id,
              kind: "agent",
              text: guarded.text,
              costUsd: sumCost(reply.costUsd, guarded.costUsd),
              durationMs: reply.durationMs,
              promptSha: reply.promptSha,
            });
            const answer = withRoles(
              `💬 ${responder.name} (${responder.role}) answered:\n\n` +
                guarded.text.slice(0, 1500),
              roster,
            );
            void notify(roomId, answer, { force: true, kind: "chatter" }).then((r) => {
              this.post({
                roomId,
                authorId: "system",
                kind: "notify",
                text: answer,
                delivered: r.delivered,
              });
            });
          }
          state.stopReason = "done";
          return;
        }

        if (!abort.signal.aborted && plan) {
          const steps = (plan.steps ?? []).slice(0, 12).map((s) => ({
            title: s.title,
            ownerId: resolveNext(s.owner, roster)?.id ?? null,
          }));
          if (steps.length > 0) {
            const goal = createGoal({ roomId, title: plan.goal, steps });
            state.goalId = goal.id;
            this.emit({ type: "goal", goal });
            this.publishRun(state);
            this.post({
              roomId,
              authorId: "system",
              kind: "event",
              text: `planned · ${goal.title} · ${steps.length} step${steps.length === 1 ? "" : "s"}`,
              costUsd: planResult.costUsd,
              durationMs: planResult.durationMs,
            });
          }
        }
      }

      let round = 0;
      let lastReview = Date.now();
      // Who has spoken, in order, and when — the two things the cheap dispatch
      // guards need. Kept local to the run rather than on RunState: they are
      // routing bookkeeping, not something the UI should render.
      const recent: string[] = [];
      const lastSpokeTurn = new Map<string, number>();

      while (!abort.signal.aborted) {
        // The money backstop. A run that has spent its allowance stops and says
        // so; Resume grants a fresh one. Blocked, not turn_cap, so it never
        // picks itself back up and spends another.
        if (config.goalCostCapUsd > 0 && state.costUsd >= config.goalCostCapUsd) {
          state.stopReason = "blocked";
          const spent = `$${state.costUsd.toFixed(2)}`;
          this.post({
            roomId,
            authorId: "system",
            kind: "handoff",
            text:
              `Umabot na sa ${spent} ang run na ito (cap: $${config.goalCostCapUsd}). ` +
              `Huminto muna ako. Press Resume kung ituloy, o sabihin kung ano ang babaguhin.`,
          });
          this.recordNotify(
            roomId,
            `⏸️ ${room.name}: umabot na sa ${spent} ang run. Press Resume sa Agora kung ituloy.`,
            "escalation",
          );
          break;
        }

        // Whichever comes first: the turn budget, or ten minutes of wall clock.
        // A room grinding through one long browser turn still owes Dominic a
        // status line, and a room burning fast cheap turns still owes him one.
        const dueOnClock = Date.now() - lastReview >= config.reviewEveryMs;
        if (state.turn >= state.maxTurns || dueOnClock) {
          round++;
          if (round > config.maxRounds) {
            state.stopReason = "turn_cap";
            this.post({
              roomId,
              authorId: "system",
              kind: "notice",
              text:
                `Stopped after ${config.maxRounds} progress reviews. The room kept ` +
                `reporting progress without finishing — that is a stall, whatever it called itself.`,
            });
            break;
          }
          const carryOn = await this.reviewProgress({
            roomId,
            room,
            orchestrator,
            roster,
            agents,
            state,
            signal: abort.signal,
            round,
          });
          if (!carryOn) break;
          lastReview = Date.now();
          // Fresh budget, so the next review lands another maxTurns later.
          state.maxTurns = state.turn + config.maxTurns;
          this.publishRun(state);
        }
        state.turn++;

        // --- cheap dispatch: honour @next instead of paying for a decision ---
        //
        // The orchestrator turn below is a full model round trip, and most of
        // the time it only restates a hand-off the last speaker already named.
        // When the marker is unambiguous and none of the guards fire, take it.
        //
        // What is deliberately given up on this path: the orchestrator's spoken
        // line, step updates, notify and discuss. Steps still settle on every
        // decision turn that does happen and on the progress review, so the
        // board cannot drift for more than one hop — and BLOCKED: refuses the
        // fast path outright, so nothing that changes a step's status is
        // silently skipped.
        const hop = this.fastNext({
          roomId,
          roster,
          orchestrator,
          recent,
          lastSpokeTurn,
          turn: state.turn,
        });
        if (hop) {
          this.post({
            roomId,
            authorId: "system",
            kind: "event",
            text: `handed to ${hop.name} · turn ${state.turn}`,
          });
          const prev = recent[recent.length - 1] ?? orchestrator.id;
          const outcome = await this.dispatchTo({
            agent: hop,
            room,
            roomId,
            roster,
            agents,
            directedBy: prev,
            instruction: turnInstruction(
              `The last speaker handed you this directly. Answer what is in NEW.`,
            ),
            state,
            signal: abort.signal,
          });
          recent.push(hop.id);
          lastSpokeTurn.set(hop.id, state.turn);
          if (outcome === "aborted") break;
          continue;
        }

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
          busyPhase: "deciding",
          prompt: [
            mindStoneText(roomId),
            `Room transcript so far:`,
            "---",
            transcript || "(empty)",
            "---",
            "",
            planText(state.goalId),
            `Agents you can assign:`,
            rosterText || "(none)",
            "",
            `Decide the next step. Turn ${state.turn}; the next progress review is at ${state.maxTurns}.`,
            `Reaching that review does NOT end the run. Do not rush a step or`,
            `declare something finished because turns are running down.`,
            `Report EVERY plan step that changed this turn in "steps". A turn`,
            `that finishes three steps and reports one leaves the board lying.`,
            `Only mark a step done when it genuinely is. Blocked is an honest answer.`,
            `When the next move is a JUDGEMENT rather than legwork — which fix,`,
            `how bad is this really, is anyone seeing a risk — set "discuss" with`,
            `two to four agents instead of assigning one. They will hear each`,
            `other and argue it out. Use it when you would otherwise ask two`,
            `people the same question separately.`,
            `Set next to null the moment the request is satisfied.`,
          ].join("\n"),
        });

        this.emit({ type: "turn_end", roomId, agentId: orchestrator.id });
        if (decisionResult.costUsd) state.costUsd += decisionResult.costUsd;
        state.lastTurnCostUsd = decisionResult.costUsd;
        state.lastTurnMs = decisionResult.durationMs;
        this.publishRun(state);
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

        if (state.goalId) this.applySteps(roomId, state.goalId, decision.steps, agents);

        const said = cleanField(decision.say);
        if (said) {
          this.post({
            roomId,
            authorId: orchestrator.id,
            kind: "agent",
            text: said,
            costUsd: decisionResult.costUsd,
            durationMs: decisionResult.durationMs,
            promptSha: decisionResult.promptSha,
          });
        }

        if (decision.spawn) {
          this.forge({
            roomId,
            room,
            orchestrator,
            roster,
            agents,
            request: decision.spawn,
            goalId: state.goalId,
          });
        }

        if (decision.notify) {
          const text = withRoles(
            `📢 ${decision.notify.headline}\n${decision.notify.detail}`,
            roster,
          );
          const result = await notify(roomId, text, { kind: "chatter" });
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

        // A discussion happens instead of assigning one agent, then control
        // returns to the orchestrator with everyone's positions on the record.
        if (decision.discuss?.agents?.length) {
          const speakers = decision.discuss.agents
            .map((id) => resolveNext(id, roster))
            .filter((a): a is Agent => a !== null && a.id !== orchestrator.id)
            .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i)
            .slice(0, 4);
          if (speakers.length >= 2) {
            await this.runDiscussion({
              roomId,
              room,
              roster,
              agents,
              orchestrator,
              state,
              signal: abort.signal,
              question: decision.discuss.question,
              speakers,
            });
            continue;
          }
        }

        const next = resolveNext(decision.next, roster);
        if (!next) {
          // Declaring the work finished is not the same as it being finished.
          // A final review runs first: it settles every step and has to answer
          // done or blocked on the record. Without this, "next: null" closed
          // the goal with steps still marked pending, which then rendered as
          // "never reached" on work that had in fact been done.
          if (state.goalId) {
            round++;
            const carryOn = await this.reviewProgress({
              roomId,
              room,
              orchestrator,
              roster,
              agents,
              state,
              signal: abort.signal,
              round,
              final: true,
            });
            if (carryOn) {
              // It looked at the board and found work still open. Keep going.
              lastReview = Date.now();
              state.maxTurns = state.turn + config.maxTurns;
              this.publishRun(state);
              continue;
            }
            break;
          }
          state.stopReason = "done";
          break;
        }

        this.post({
          roomId,
          authorId: "system",
          kind: "event",
          text: `assigned · ${next.name} (${next.role}) · turn ${state.turn}`,
        });

        // --- the assigned agent speaks ---------------------------------------
        const outcome = await this.dispatchTo({
          agent: next,
          room,
          roomId,
          roster,
          agents,
          directedBy: orchestrator.id,
          instruction: turnInstruction(`${orchestrator.name} handed you this.`),
          state,
          signal: abort.signal,
        });
        recent.push(next.id);
        lastSpokeTurn.set(next.id, state.turn);
        if (outcome === "timed_out") continue;
        if (outcome === "aborted") break;
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
      state.phase = null;
      state.phaseDetail = null;
      state.turnStartedAt = null;
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
        }
        if (goal && state.stopReason !== "blocked") {
          // Every finished run reports to WhatsApp, prompt included — forced
          // past the rate limiter, because this is the message that matters.
          // The last thing an agent actually said IS the result. Without this
          // the report can only describe steps and a prompt, which is how a
          // finished piece of work gets reported as "nothing actionable".
          const lastSaid = [...listMessages(roomId, config.transcriptWindow)]
            .reverse()
            .find((m) => m.kind === "agent" && m.text.trim().length > 0);
          // In a prompt-only room the report collapses to the deliverable
          // itself. The steps, the findings and the run stats are all still in
          // the room; what belongs on his phone is the thing he has to act on.
          const quiet = levelForRoom(roomId) === "prompt";
          const report = withRoles(
            quiet && goal.handoff?.trim()
              ? [
                  `📋 ${goal.title}`,
                  "",
                  ...(goal.verify?.trim() ? ["👀 See it yourself first:", goal.verify.trim(), ""] : []),
                  "Paste into Claude CLI:",
                  "```",
                  goal.handoff.trim(),
                  "```",
                ].join("\n")
              : buildRunReport(goal, agents, lastSaid?.text ?? null),
            roster,
          );
          // A quiet room with nothing to run stays quiet: a goal that produced
          // no prompt has produced nothing he can act on, and telling him that
          // on WhatsApp is exactly the noise he asked to be rid of.
          if (quiet && !goal.handoff?.trim()) {
            this.post({
              roomId,
              authorId: "system",
              kind: "event",
              text: "no prompt produced — nothing sent to WhatsApp",
            });
          } else {
            this.recordNotify(roomId, report, "prompt");
          }
        }
      }

      this.publishRun(state);
      this.runs.delete(roomId);
      this.corrected.delete(roomId);
      this.vague.delete(roomId);
      this.emit({ type: "runs", runs: this.listRuns() });

      // Fold the run into the room's memory, AFTER the run is released — the
      // room is free again immediately, and a slow compaction never holds up
      // the next thing Dominic types. Failure here loses a compaction, never
      // the run that produced it.
      void this.compactMindStone(roomId, orchestrator, roster, room.name, agents).catch(
        (err: unknown) =>
          console.error("[mind-stone] compaction failed:", err instanceof Error ? err.message : err),
      );

      // ── carry on by itself ────────────────────────────────────────────
      //
      // A run that stops with steps still open has not finished, and making
      // Dominic notice that and press Resume is asking him to be the retry
      // loop. He is not the retry loop.
      //
      // Only the stop reasons that mean "ran out of budget" or "one turn
      // misfired" resume. The ones that mean something real — he pressed Stop,
      // or the room genuinely needs him — never do, because auto-resuming those
      // would either override him or spin against a wall.
      // The board decides, not the stop reason.
      //
      // The first version of this keyed off stopReason and missed the case that
      // actually happens: the orchestrator says "done" and the run logs `run
      // finished`, while three steps were never started. closeGoal already
      // catches that — it derives the goal's status from the steps, so a goal
      // that closes `stopped` means the board disagreed with whoever declared
      // it finished, whatever they called it.
      //
      // So: unfinished board + a stop that was not a human decision = carry on.
      const NEVER_RESUME = new Set(["stopped", "blocked"]);
      if (state.goalId && !NEVER_RESUME.has(state.stopReason ?? "")) {
        const goal = getGoal(state.goalId);
        const open = goal?.steps.filter((st) => st.status !== "done").length ?? 0;
        const spent = this.resumes.get(state.goalId) ?? 0;
        const goalId = state.goalId;
        if (goal && goal.status !== "done" && open > 0 && spent < config.maxAutoResumes) {
          this.resumes.set(goalId, spent + 1);
          this.post({
            roomId,
            authorId: "system",
            kind: "event",
            text:
              `picking this back up on its own · ${open} step${open === 1 ? "" : "s"} still open · ` +
              `attempt ${spent + 1} of ${config.maxAutoResumes}`,
          });
          // Off the current stack: the run is not released until this `finally`
          // returns, and start() refuses a room that still holds one.
          setTimeout(() => {
            void this.start(roomId, "", goalId).catch((err: unknown) =>
              console.error(
                "[auto-resume] failed:",
                err instanceof Error ? err.message : err,
              ),
            );
          }, 1500);
        } else if (goal && goal.status !== "done" && open > 0) {
          this.post({
            roomId,
            authorId: "system",
            kind: "notice",
            text:
              `Stopped with ${open} step${open === 1 ? "" : "s"} open after ` +
              `${config.maxAutoResumes} automatic attempts. Something here needs a human ` +
              `— press Resume to try again, or say what changed.`,
          });
        }
      }
      if (state.goalId) {
        const g = getGoal(state.goalId);
        if (g?.status === "done") this.resumes.delete(state.goalId);
      }

      const elapsed = Date.now() - state.startedAt;
      if (state.stopReason === "stopped" || state.stopReason === "timeout") {
        this.post({
          roomId,
          authorId: "system",
          kind: "notice",
          text:
            state.stopReason === "stopped"
              ? `Run stopped after ${formatDuration(elapsed)}.`
              : `Run timed out after ${formatDuration(elapsed)}.`,
        });
      } else if (state.stopReason === "done" || state.stopReason === "turn_cap") {
        this.post({
          roomId,
          authorId: "system",
          kind: "event",
          text: `run ${state.stopReason === "done" ? "finished" : "hit turn cap"} · ${formatDuration(elapsed)}`,
        });
      }
    }
  }
}
