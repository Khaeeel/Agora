import { config, notifyIsLive } from "./config.ts";
import {
  createRoom,
  goalsAbandonedWithin,
  listRooms,
  reconcileOrphanedGoals,
} from "./db.ts";
import { loadAgents } from "./agents/registry.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";
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
// Capture what was open BEFORE reconciliation rewrites their statuses, so the
// unfinished ones can be picked up again once the server is listening.
const abandoned = goalsAbandonedWithin(15 * 60_000);
const orphaned = reconcileOrphanedGoals();
if (orphaned > 0) {
  console.log(`[boot] closed ${orphaned} goal(s) orphaned by a previous run`);
}

const app = await buildServer();

await app.listen({ port: config.port, host: config.host });

// A restart is not a decision to abandon the work. Anything that was mid-flight
// when the process died gets picked back up here — the same path the Resume
// button uses — so a deploy, a crash or a machine reboot costs a pause rather
// than a goal. Delayed a little so the first agents are not racing boot.
const freshlyOrphaned = goalsAbandonedWithin(60_000).filter((g) =>
  abandoned.some((a) => a.id === g.id),
);
if (freshlyOrphaned.length > 0) {
  console.log(
    `[boot] resuming ${freshlyOrphaned.length} goal(s) interrupted by the restart`,
  );
  setTimeout(() => {
    for (const goal of freshlyOrphaned) {
      void app.orchestrator
        .start(goal.roomId, "", goal.id)
        .catch((err: unknown) =>
          console.error(
            "[boot] resume failed:",
            err instanceof Error ? err.message : err,
          ),
        );
    }
  }, 4000);
}

console.log(`
  Agora server   http://127.0.0.1:${config.port}
  agents dir     ${config.agentsDir}
  engine         ${
    config.driver === "cursor"
      ? `${config.cursorBin} (cursor: ${config.cursorModel}, planning on ${config.cursorPlanModel || config.cursorModel})`
      : config.driver === "hybrid"
        ? `hybrid — agent turns on cursor (${config.cursorModel}), orchestrator on claude (${config.model})`
        : `${config.claudeBin} (${config.model}, effort ${config.effort})`
  }
  loop           review every ${config.maxTurns} turns or ${config.reviewEveryMs / 60000}min, max ${config.maxRounds} rounds
  dispatch       ${
    config.fastDispatch
      ? "@next honoured directly — decision turn skipped when unambiguous"
      : "every turn via the orchestrator (AGORA_FAST_DISPATCH=1 to use @next)"
  }
  protocol       v${PROTOCOL_VERSION}
  caps           ${config.runTimeoutMs / 1000}s wall clock, ${config.maxConcurrency} concurrent
  whatsapp       ${
    notifyIsLive()
      ? `LIVE -> ${config.notifyJid}`
      : config.notifyJid
        ? `dry-run (target ${config.notifyJid})`
        : "disabled (no AGORA_NOTIFY_JID)"
  }
`);
