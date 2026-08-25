/**
 * Isolated check of the Claude CLI driver: does a chat-only agent turn stream
 * real text back? This is the lowest layer — if this fails, nothing above it
 * can work.
 */
import { ClaudeCliDriver } from "../drivers/claude-cli.ts";
import { config } from "../config.ts";

const driver = new ClaudeCliDriver();
const controller = new AbortController();

console.log(`bin    ${config.claudeBin}`);
console.log(`model  ${config.model} (effort ${config.effort})\n`);

let streamed = "";
let final: { text: string; costUsd: number | null; isError: boolean } | null = null;

const started = Date.now();
for await (const event of driver.run({
  systemPrompt:
    "You are a research analyst. Terse. No greetings, no sign-offs.",
  prompt: "In exactly two short sentences, say what a changelog is.",
  model: config.model,
  effort: config.effort,
  tools: [],
  addDirs: [],
  mcp: [],
  signal: controller.signal,
})) {
  if (event.type === "delta") {
    streamed += event.text;
    process.stdout.write(event.text);
  } else if (event.type === "final") {
    final = { text: event.text, costUsd: event.costUsd, isError: event.isError };
  }
}

console.log(`\n\nchecks
  streamed chars   ${streamed.length}
  final text chars ${final?.text.length ?? 0}
  isError          ${final?.isError}
  cost             $${final?.costUsd?.toFixed(4) ?? "?"}
  wall clock       ${((Date.now() - started) / 1000).toFixed(1)}s
`);

const ok = !final?.isError && streamed.length > 0;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
