/**
 * Isolated check of the Cursor CLI driver, mirroring smoke/driver.ts.
 *
 * Runs the same turn twice: once as an ordinary turn (auto / Composer) and
 * once as a planning turn, so the phase routing is proved rather than assumed.
 * If the second line does not name a different model, routing is not working.
 */
import { CursorCliDriver } from "../drivers/cursor-cli.ts";
import { config } from "../config.ts";

const driver = new CursorCliDriver();
const controller = new AbortController();

console.log(`bin         ${config.cursorBin}`);
console.log(`ordinary    ${config.cursorModel}`);
console.log(`planning    ${config.cursorPlanModel || "(same as ordinary)"}\n`);

async function turn(label: string, phase: string | undefined) {
  let streamed = "";
  let final: { text: string; costUsd: number | null; isError: boolean } | null = null;
  const started = Date.now();

  for await (const event of driver.run({
    systemPrompt: "You are a research analyst. Terse. No greetings, no sign-offs.",
    prompt: "In exactly two short sentences, say what a changelog is.",
    model: config.model,
    effort: config.effort,
    tools: [],
    addDirs: [],
    mcp: [],
    allow: [],
    mcpConfigs: [],
    ...(phase ? { phase } : {}),
    signal: controller.signal,
  })) {
    if (event.type === "delta") {
      streamed += event.text;
      process.stdout.write(event.text);
    } else if (event.type === "tool_use") {
      process.stdout.write(`\n[tool: ${event.name}]\n`);
    } else if (event.type === "final") {
      final = { text: event.text, costUsd: event.costUsd, isError: event.isError };
    }
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n--- ${label}
  streamed chars   ${streamed.length}
  final text chars ${final?.text.length ?? 0}
  costUsd          ${final?.costUsd ?? "(not reported)"}
  isError          ${final?.isError}
  wall clock       ${secs}s`);
  if (final?.isError) console.log(`  final text: ${final.text.slice(0, 600)}`);

  return !final?.isError && streamed.length > 0;
}

const a = await turn("ordinary turn (expect Composer via auto)", "generating");
console.log();
const b = await turn("planning turn (expect the plan model)", "planning");

console.log(`\n${a && b ? "PASS" : "FAIL"}`);
process.exit(a && b ? 0 : 1);
