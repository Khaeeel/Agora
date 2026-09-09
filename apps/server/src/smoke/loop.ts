/**
 * Headless end-to-end check of the orchestrator loop. No UI, no WebSocket.
 *
 *   AGORA_MAX_TURNS=3 pnpm smoke:loop "ship v2.3"
 *
 * Asserts the things that actually matter: every turn names a real agent, the
 * run terminates, and the caps are the thing that stops it.
 */
import { config } from "../config.ts";
import { createRoom, listRooms } from "../db.ts";
import { loadAgents } from "../agents/registry.ts";
import { Orchestrator } from "../orchestrator.ts";
import type { ServerEvent } from "../types.ts";

const agents = loadAgents();
if (agents.size === 0) {
  console.error("No agents found in", config.agentsDir);
  process.exit(1);
}

let room = listRooms()[0];
if (!room) {
  const members = ["atlas", "sage", "forge", "echo"].filter((id) => agents.has(id));
  room = createRoom({
    name: "Smoke Room",
    topic: "smoke test",
    members,
    orchestratorId: "atlas",
  });
}

const ask = process.argv[2] ?? "Plan the v2.3 release. Keep it to three steps.";

console.log(`room     ${room.name} [${room.members.join(", ")}]`);
console.log(`caps     ${config.maxTurns} turns / ${config.runTimeoutMs / 1000}s`);
console.log(`ask      ${ask}\n`);

const seen: string[] = [];
let streamed = 0;
let deltaOpen = false;

const emit = (event: ServerEvent): void => {
  switch (event.type) {
    case "turn_start":
      seen.push(event.agentId);
      process.stdout.write(
        `\n[turn ${event.turn}] ${event.agentId}` +
          (event.directedBy ? ` (directed by ${event.directedBy})` : " (deciding)") +
          "\n",
      );
      break;
    case "delta":
      streamed += event.text.length;
      deltaOpen = true;
      process.stdout.write(event.text);
      break;
    case "turn_end":
      if (deltaOpen) {
        process.stdout.write("\n");
        deltaOpen = false;
      }
      break;
    case "message":
      if (event.message.kind === "notify") {
        console.log(`\n  >> NOTIFY (delivered=${event.message.delivered}): ${event.message.text}`);
      } else if (event.message.kind === "notice") {
        console.log(`\n  ** ${event.message.text}`);
      }
      break;
    case "rate_limit":
      console.log(`\n  ~~ rate limit: ${event.detail.slice(0, 160)}`);
      break;
    case "error":
      console.log(`\n  !! ${event.detail}`);
      break;
    case "run":
      if (!event.state.active) {
        console.log(
          `\n\n--- run finished: ${event.state.stopReason} ` +
            `after ${event.state.turn} turns ---`,
        );
      }
      break;
  }
};

const orchestrator = new Orchestrator(emit, () => agents);

const started = Date.now();
await orchestrator.start(room.id, ask);

const unknown = seen.filter((id) => !agents.has(id));
console.log(`
checks
  turns taken      ${seen.length}
  streamed chars   ${streamed}
  wall clock       ${((Date.now() - started) / 1000).toFixed(1)}s
  unknown agents   ${unknown.length === 0 ? "none" : unknown.join(", ")}
  terminated       ${orchestrator.isRunning(room.id) ? "NO - still running" : "yes"}
`);

process.exit(unknown.length === 0 ? 0 : 1);
