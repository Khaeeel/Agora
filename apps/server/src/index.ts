import { config, notifyIsLive } from "./config.ts";
import { createRoom, listRooms, reconcileOrphanedGoals } from "./db.ts";
import { loadAgents } from "./agents/registry.ts";
import { buildServer } from "./server.ts";

/**
 * First run gets one room holding whoever is in agents/, so the UI is never an
 * empty shell. Deliberately not a hardcoded roster — renaming the team should
 * not require touching this file.
 */
function seed(): void {
  if (listRooms().length > 0) return;
  const agents = loadAgents();
  const members = [...agents.keys()];
  if (members.length === 0) {
    console.warn("[seed] no agents found in", config.agentsDir);
    return;
  }
  const room = createRoom({
    name: "HelloAlex | Agora",
    topic: "Product, QA and release coordination",
    members,
    orchestratorId: members.find((id) => agents.get(id)?.orchestrator) ?? members[0]!,
  });
  console.log(`[seed] created room "${room.name}" with ${members.join(", ")}`);
}

seed();

// Runs live in memory, so anything in flight died with the previous process.
const orphaned = reconcileOrphanedGoals();
if (orphaned > 0) {
  console.log(`[boot] closed ${orphaned} goal(s) orphaned by a previous run`);
}

const app = await buildServer();

await app.listen({ port: config.port, host: config.host });

console.log(`
  Agora server   http://127.0.0.1:${config.port}
  agents dir     ${config.agentsDir}
  engine         ${config.claudeBin} (${config.model}, effort ${config.effort})
  caps           ${config.maxTurns} turns, ${config.runTimeoutMs / 1000}s, ${config.maxConcurrency} concurrent
  whatsapp       ${
    notifyIsLive()
      ? `LIVE -> ${config.notifyJid}`
      : config.notifyJid
        ? `dry-run (target ${config.notifyJid})`
        : "disabled (no AGORA_NOTIFY_JID)"
  }
`);
