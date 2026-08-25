/**
 * End-to-end check over the real WebSocket, exactly as the browser does it:
 * connect, broadcast into a room, and watch the events come back.
 *
 *   node scripts/e2e-ws.mjs "your prompt"
 */
const BASE = process.env.AGORA_BASE ?? "http://127.0.0.1:8787";
const ask = process.argv[2] ?? "Say hello to the room in one short sentence, then stop.";

const state = await (await fetch(`${BASE}/api/state`)).json();
const room = state.rooms[0];
if (!room) {
  console.error("No rooms exist.");
  process.exit(1);
}
const names = new Map(state.agents.map((a) => [a.id, a.name]));

console.log(`room        ${room.name} [${room.members.map((m) => names.get(m)).join(", ")}]`);
console.log(`notifyLive  ${state.notifyLive}`);
console.log(`ask         ${ask}\n`);

const socket = new WebSocket(`${BASE.replace("http", "ws")}/ws`);

const seen = { turns: 0, deltas: 0, messages: 0, notifies: 0, errors: 0 };
let finished = false;

const done = new Promise((resolve) => {
  // Must outlast the server's own run cap, or this harness reports a timeout
  // for a run that is still happily working — which it did.
  const timer = setTimeout(() => resolve("harness-gave-up"), 2_760_000);
  socket.addEventListener("message", (raw) => {
    const e = JSON.parse(raw.data);
    switch (e.type) {
      case "hello":
        console.log(`connected — ${e.agents.length} agents, ${e.rooms.length} rooms`);
        socket.send(JSON.stringify({ type: "broadcast", roomId: room.id, text: ask }));
        break;
      case "turn_start":
        seen.turns++;
        process.stdout.write(
          `\n[${e.turn}] ${names.get(e.agentId) ?? e.agentId}` +
            (e.directedBy ? ` <- ${names.get(e.directedBy)}` : " (deciding)") +
            "\n",
        );
        break;
      case "delta":
        seen.deltas++;
        process.stdout.write(e.text);
        break;
      case "message":
        seen.messages++;
        if (e.message.kind === "notify") {
          seen.notifies++;
          console.log(`\n  NOTIFY delivered=${e.message.delivered}`);
        }
        break;
      case "error":
        seen.errors++;
        console.log(`\n  ERROR ${e.detail}`);
        break;
      case "run":
        if (!e.state.active && !finished) {
          finished = true;
          clearTimeout(timer);
          console.log(
            `\n\nrun ended: ${e.state.stopReason}, ` +
              `${e.state.turn} turns, $${e.state.costUsd.toFixed(4)}`,
          );
          setTimeout(() => resolve(e.state.stopReason), 400);
        }
        break;
    }
  });
});

const reason = await done;
socket.close();

console.log(`
checks
  turn_start events  ${seen.turns}
  delta events       ${seen.deltas}   ${seen.deltas > 0 ? "(streaming works)" : "(NO STREAMING)"}
  messages persisted ${seen.messages}
  notify rows        ${seen.notifies}
  errors             ${seen.errors}
  outcome            ${reason}
`);

process.exit(seen.errors === 0 && seen.deltas > 0 ? 0 : 1);
