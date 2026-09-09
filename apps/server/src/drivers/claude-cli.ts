import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { config } from "../config.ts";
import type { AgentDriver, DriverEvent, DriverRequest } from "./types.ts";

/**
 * Drives the Claude Code CLI in print mode. This runs on the Max-plan OAuth
 * credentials in ~/.claude, so there is no API key anywhere in this app.
 *
 * Do NOT add `--bare`: it reads auth strictly from ANTHROPIC_API_KEY/apiKeyHelper
 * and never touches OAuth, which would break the subscription login.
 */
export class ClaudeCliDriver implements AgentDriver {
  readonly id = "claude-cli";

  /**
   * NOTE ON ARGUMENT ORDER: `--tools` and `--add-dir` are *variadic* — they
   * consume every following argument until the next flag. A positional prompt
   * placed after them is silently eaten as a tool name, and the CLI then dies
   * with "Input must be provided either through stdin or as a prompt argument".
   * So the prompt goes on stdin (which also removes the argv length ceiling as
   * transcripts grow), and every variadic option is followed by another flag.
   */
  private buildArgs(req: DriverRequest): string[] {
    const args: string[] = [];

    // Chat-only agents get no tools at all, so they never hit a permission
    // prompt — which would hang a non-interactive process forever.
    if (req.tools.length === 0) {
      args.push("--tools", "");
    } else {
      args.push("--tools", ...req.tools);
      for (const dir of req.addDirs) args.push("--add-dir", dir);
    }

    // Permission grants. `--tools` only says a tool exists — using it still
    // needs approval, and in print mode there is nobody to approve, so the call
    // comes back as a permission_denial. MCP servers and things like
    // WebFetch(domain:...) are both granted here.
    const grants = [...req.mcp.map((id) => `mcp__${id}__*`), ...req.allow];
    if (grants.length > 0) {
      args.push("--allowedTools", ...grants);
    }

    // stdio MCP servers the CLI does not already know about. Variadic, so it
    // must be followed by another flag — the trailing block below handles that.
    if (req.mcpConfigs.length > 0) {
      args.push("--mcp-config", ...req.mcpConfigs);
    }

    if (req.schema) args.push("--json-schema", JSON.stringify(req.schema));

    args.push(
      "--system-prompt",
      req.systemPrompt,
      "--model",
      req.model,
      "--effort",
      req.effort,
      "--output-format",
      "stream-json",
      // Trailing flags only. Nothing variadic may be last.
      "-p",
      "--no-session-persistence",
      "--include-partial-messages",
      "--verbose",
    );
    return args;
  }

  async *run(req: DriverRequest): AsyncIterable<DriverEvent> {
    const child = spawn(config.claudeBin, this.buildArgs(req), {
      cwd: req.cwd ?? config.root,
      stdio: ["pipe", "pipe", "pipe"],
      signal: req.signal,
    });

    // The prompt travels on stdin — see the note on buildArgs.
    child.stdin.on("error", () => {}); // killed child closes stdin under us
    child.stdin.end(req.prompt, "utf8");

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
    let structured: unknown = null;
    let costUsd: number | null = null;
    let isError = false;
    let sawResult = false;

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue; // non-JSON noise on stdout is not fatal
      }

      const kind = evt["type"];

      if (kind === "stream_event") {
        const inner = evt["event"] as Record<string, unknown> | undefined;
        if (inner?.["type"] === "content_block_start") {
          const block = inner["content_block"] as Record<string, unknown> | undefined;
          if (block?.["type"] === "tool_use" && typeof block["name"] === "string") {
            yield { type: "tool_use", name: block["name"] };
          }
        } else if (inner?.["type"] === "content_block_delta") {
          const delta = inner["delta"] as Record<string, unknown> | undefined;
          if (delta?.["type"] === "text_delta" && typeof delta["text"] === "string") {
            text += delta["text"];
            yield { type: "delta", text: delta["text"] };
          }
        }
        continue;
      }

      if (kind === "rate_limit_event") {
        yield { type: "rate_limit", detail: JSON.stringify(evt).slice(0, 400) };
        continue;
      }

      if (kind === "result") {
        sawResult = true;
        isError = evt["is_error"] === true;
        if (typeof evt["total_cost_usd"] === "number") costUsd = evt["total_cost_usd"];
        if (evt["structured_output"] != null) structured = evt["structured_output"];
        // `result` is the final assistant message on its own: without the
        // narration streamed before tool calls, and without the duplicate
        // text blocks the CLI re-emits after them. With a schema the prose
        // channel is empty and `result` carries the payload. Either way it
        // beats the accumulated deltas whenever it has content.
        if (typeof evt["result"] === "string" && evt["result"].trim()) text = evt["result"];
      }
    }

    const code = await exited;

    if (!sawResult) {
      isError = true;
      if (!text) {
        text = req.signal.aborted
          ? "(stopped)"
          : `claude exited ${code}${stderr ? `: ${stderr.trim().slice(-500)}` : ""}`;
      }
    }

    yield { type: "final", text, structured, costUsd, isError };
  }
}
