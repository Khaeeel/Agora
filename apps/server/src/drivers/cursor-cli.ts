import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { toCursorModelId } from "../agent-models.ts";
import { config } from "../config.ts";
import type { AgentDriver, DriverEvent, DriverRequest } from "./types.ts";

/**
 * Drives the Cursor Agent CLI in print mode, on the Cursor subscription login
 * stored in ~/.cursor — same idea as the Claude driver, no API key in the app.
 *
 * WHY THIS EXISTS
 * The Cursor seat is paid for and idle. Turns run here draw on that quota
 * instead of the Claude Max pool that room rule 11 accounts for, which is the
 * entire point: it takes load off the pool Dominic's own chats share.
 *
 * FOUR THINGS THE CURSOR CLI DOES NOT HAVE, AND WHAT IS DONE INSTEAD
 *
 * 1. No `--system-prompt`. The system prompt is prepended to the turn prompt
 *    with a separator. This is genuinely weaker: it is ordinary prompt text the
 *    model may weigh against the transcript, not a privileged channel.
 *
 * 2. No `--json-schema`. Structured turns are requested in prose and the JSON
 *    is extracted afterwards. The Claude driver gets a VALIDATED object back;
 *    here the model can return prose, malformed JSON, or a schema-shaped object
 *    with wrong field types, and nothing upstream catches it. The orchestrator's
 *    per-turn decision depends on that object, so treat structured turns as the
 *    weak spot of this driver and prefer Claude for the orchestrator seat.
 *
 * 3. No per-invocation tool grants. Cursor reads permissions from the single
 *    global ~/.cursor/cli-config.json (verified: no CURSOR_CONFIG_DIR or
 *    CURSOR_HOME exists in the binary — only CURSOR_INVOKED_AS). So a
 *    per-agent allowlist cannot be passed the way `--tools` passes one.
 *    See MODE below for what is enforced instead.
 *
 * 4. No `--no-session-persistence`. Each run starts a fresh chat by default;
 *    `--resume`/`--continue` are opt-in, so turns stay stateless as the room
 *    requires. Chats do accumulate under ~/.cursor/chats.
 *
 * MODE — how the read-only boundary survives without per-agent grants
 * `--mode` IS per-invocation and IS enforced by the CLI, so the roles that must
 * never write are pinned by flag rather than by trust:
 *   no tools at all            -> `--mode ask`  (Q&A, read-only)
 *   only read-shaped tools     -> `--mode plan` (analyse, propose, no edits)
 *   any exec/write tool        -> default mode, governed by the global config
 * That keeps Ceb, Gaben and Topson genuinely unable to edit — the property room
 * rule 6 depends on — while the engine-door holders still work. It does NOT
 * reproduce per-agent Shell() scoping: in default mode every such agent shares
 * one allowlist. Narrow that allowlist in cli-config.json, not here.
 */

/** Tools that cannot change anything. Anything absent from this list is treated
 *  as write/exec, which is the safe direction to be wrong in. */
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "NotebookRead",
  "TodoWrite",
]);

function isReadOnly(tools: string[]): boolean {
  return tools.every((t) => READ_ONLY_TOOLS.has(t.split("(")[0]!.trim()));
}

/**
 * Cursor bakes effort into the model ID rather than taking it as a separate
 * flag: `claude-sonnet-5-low`, `-medium`, `-high`, `-xhigh`, `-max`.
 * See `toCursorModelId` — bare Claude ids are rejected by cursor-agent.
 *
 * When AGORA_CURSOR_MODEL=auto (the default), EVERY turn — including planning —
 * stays on `auto`. Per-agent Claude/Opus ids burn Pro+ API usage limits;
 * `auto` stays on the subscription seat.
 */
function modelArg(model: string, effort: string, phase: string | undefined): string {
  const fallback = config.cursorModel.trim() || "auto";
  if (fallback === "auto") return "auto";

  if (phase === "planning") {
    const planModel = config.cursorPlanModel.trim();
    if (planModel) return planModel;
  }

  return toCursorModelId(model, effort, fallback);
}

export class CursorCliDriver implements AgentDriver {
  readonly id = "cursor-cli";

  private buildArgs(req: DriverRequest): string[] {
    const args: string[] = [];

    if (req.tools.length === 0) {
      args.push("--mode", "ask");
    } else if (isReadOnly(req.tools)) {
      args.push("--mode", "plan");
      for (const dir of req.addDirs) args.push("--add-dir", dir);
    } else {
      // Default (full) mode. Permissions come from the global config; nothing
      // can be scoped to this agent here. See the header note.
      for (const dir of req.addDirs) args.push("--add-dir", dir);
    }

    args.push(
      // Required, not optional. On a directory it has not seen before the CLI
      // asks "Workspace Trust Required" even under -p, and a spawned child has
      // nobody to answer: it does not time out and does not fail, it just never
      // returns a turn. This grants no tools — the --mode split above and the
      // global allowlist still decide what an agent may do.
      "--trust",
      "--model",
      modelArg(req.model, req.effort, req.phase),
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "-p",
    );
    return args;
  }

  /** The system prompt has no channel of its own — see note 1. */
  private buildPrompt(req: DriverRequest): string {
    const parts: string[] = [];
    if (req.systemPrompt) {
      parts.push(req.systemPrompt, "\n\n---\n\n");
    }
    parts.push(req.prompt);
    if (req.schema) {
      parts.push(
        "\n\n---\n\nReply with ONE JSON object and nothing else — no prose",
        " before or after it, no markdown fence. It must validate against this",
        " schema:\n",
        JSON.stringify(req.schema),
      );
    }
    return parts.join("");
  }

  async *run(req: DriverRequest): AsyncIterable<DriverEvent> {
    const child = spawn(config.cursorBin, this.buildArgs(req), {
      // Same rule as the Claude driver: an agent that may write runs inside the
      // folder it was granted. Pinning config.root here meant a scaffold with
      // relative paths landed in the agora repo, not the project.
      cwd: req.cwd ?? config.root,
      stdio: ["pipe", "pipe", "pipe"],
      signal: req.signal,
    });

    child.stdin.on("error", () => {});
    child.stdin.end(this.buildPrompt(req), "utf8");

    let stderr = "";
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    const exited = new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? -1));
      child.on("error", () => resolve(-1));
    });

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

    let text = "";
    let costUsd: number | null = null;
    let isError = false;
    let sawResult = false;
    let sawAnyJson = false;

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      sawAnyJson = true;

      const kind = evt["type"];

      // Shapes below were captured from a live run of this CLI version, not
      // guessed. If a future version changes them the `!sawResult` branch at
      // the bottom fails loudly instead of returning an empty turn.

      // {"type":"assistant","message":{"role":"assistant",
      //  "content":[{"type":"text","text":"hello"}]}}
      // The text is nested in the message, NOT on the event.
      if (kind === "assistant") {
        // TWO ways this stream doubles a reply (observed live with --stream-partial-output):
        //
        // 1. End-of-turn recap with NO timestamp_ms that repeats the whole message.
        // 2. Mid-turn recap WITH timestamp_ms that repeats the sentence just streamed
        //    word-by-word (e.g. after "Running…sentences." comes another assistant
        //    event whose text is exactly that sentence again). Skipping only (1)
        //    left every tool-using turn saying each line twice in the transcript.
        if (evt["timestamp_ms"] === undefined) continue;

        const message = evt["message"] as Record<string, unknown> | undefined;
        const content = message?.["content"];
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b["type"] === "text" && typeof b["text"] === "string" && b["text"]) {
              const chunk = b["text"];
              // Exact mid-turn recap of everything accumulated so far.
              if (chunk === text) continue;
              // Cumulative snapshot (rare): replace, only stream the new suffix.
              if (text && chunk.startsWith(text) && chunk.length > text.length) {
                const suffix = chunk.slice(text.length);
                text = chunk;
                if (suffix) yield { type: "delta", text: suffix };
                continue;
              }
              text += chunk;
              yield { type: "delta", text: chunk };
            } else if (b["type"] === "tool_use" && typeof b["name"] === "string") {
              yield { type: "tool_use", name: b["name"] };
            }
          }
        }
        continue;
      }

      // {"type":"thinking","subtype":"delta","text":"..."} — reasoning, not the
      // reply. Deliberately dropped: streaming it would put the model's working
      // out into the room transcript as if it were the agent's answer.
      if (kind === "thinking" || kind === "system" || kind === "user") continue;

      if (kind === "tool_call" || kind === "tool_use") {
        const name =
          (typeof evt["name"] === "string" && evt["name"]) ||
          (typeof evt["tool"] === "string" && evt["tool"]) ||
          "tool";
        yield { type: "tool_use", name };
        continue;
      }

      // {"type":"result","subtype":"success","is_error":false,"result":"...",
      //  "usage":{"inputTokens":…,"outputTokens":…}}
      if (kind === "result") {
        sawResult = true;
        isError = evt["is_error"] === true || evt["subtype"] === "error";
        // NO COST FIELD. Cursor reports token counts, not dollars, so room
        // rule 4's `Usage:` line has no figure to quote on this driver. Left
        // null rather than invented — a made-up cost is worse than none.
        // Prefer the result payload over streamed deltas. It is the CLI's own
        // de-duplicated final text (same idea as the Claude driver's result
        // replace). Stream accumulation can still carry a mid-turn recap we
        // missed; this is the backstop that keeps the posted message clean.
        if (typeof evt["result"] === "string" && evt["result"]) {
          text = evt["result"];
        }
      }
    }

    const code = await exited;

    // Structured output is extracted, not validated — see note 2. The LAST
    // balanced object wins, because a model that reasons before answering
    // leaves earlier objects in the text.
    let structured: unknown = null;
    if (req.schema && text) {
      structured = extractLastJsonObject(text);
      if (structured === null) {
        isError = true;
        text = `cursor-cli: a structured turn returned no parseable JSON.\n${text.slice(-800)}`;
      }
    }

    if (!sawResult) {
      isError = true;
      if (!text) {
        // Fail loudly rather than returning an empty turn. If this fires with
        // JSON on stdout, the stream vocabulary differs from what is handled
        // above and the raw line is what tells you the real shape.
        text = req.signal.aborted
          ? "(stopped)"
          : sawAnyJson
            ? `cursor-agent produced JSON this driver did not recognise (exit ${code}). ` +
              `The stream-json event names need checking against a live run.` +
              (stderr ? ` stderr: ${stderr.trim().slice(-300)}` : "")
            : `cursor-agent exited ${code}${stderr ? `: ${stderr.trim().slice(-500)}` : ""}`;
      }
    }

    yield { type: "final", text, structured, costUsd, isError };
  }
}

/** Scans for the last balanced {...} run, ignoring braces inside strings. */
function extractLastJsonObject(s: string): unknown | null {
  for (let end = s.lastIndexOf("}"); end !== -1; end = s.lastIndexOf("}", end - 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = end; i >= 0; i--) {
      const ch = s[i]!;
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === "}") depth++;
      else if (ch === "{") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(i, end + 1));
          } catch {
            break; // not valid — fall back to an earlier closing brace
          }
        }
      }
    }
  }
  return null;
}
