/**
 * Talk to an Agora room from outside it — built for Zenith, the OpenClaw
 * WhatsApp bot, so Dominic can reach the crew from his phone.
 *
 * TWO MODES, and picking the right one matters because they cost very
 * different amounts:
 *
 *   --status            read only. What is the room doing, what did it last
 *                       say, is a run in flight. Starts nothing, costs nothing.
 *
 *   "<question>"        start a run. The orchestrator plans, assigns agents and
 *                       answers. A real run is roughly $1-2 and takes minutes.
 *
 * So: "any update from the crew?" is --status. "here is what I want, make a
 * plan" is a run. Never start a run to find out what already happened.
 *
 *   node agora-ask.mjs --status
 *   node agora-ask.mjs "Plan how to re-run exp036 without losing the onsets."
 *   node agora-ask.mjs --room "HelloAlex | Agora" --status
 *
 * Loop safety: the prompt is marked as coming from Zenith so the room knows not
 * to call back out. One hop — Zenith asks, the room answers.
 */

const BASE = process.env.AGORA_BASE ?? "http://127.0.0.1:8787";
const TIMEOUT_MS = Number(process.env.AGORA_ASK_TIMEOUT_MS ?? 360_000);
const MARKER = "[relayed via Zenith from WhatsApp]";

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
let roomName = "Voicemail Detection";
let statusOnly = false;
let detach = false;
let tail = 12;
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--room") roomName = argv[++i] ?? roomName;
  else if (a === "--status") statusOnly = true;
  else if (a === "--detach") detach = true;
  else if (a === "--tail") tail = Number(argv[++i] ?? tail) || tail;
  else rest.push(a);
}
const ask = rest.join(" ").trim();

// --- --detach: survive the caller ------------------------------------------
// Zenith runs this from inside a `claude -p` turn. Anything it backgrounds
// itself with `&` dies when that turn ends — which is exactly what happened:
// it reported "Relay running in background, PID 1263131" and the relay never
// reached the room. `detached: true` puts the child in its own session so it
// outlives the turn, and the crew's answer reaches WhatsApp through the room's
// own run report rather than through the caller.
if (detach && !statusOnly) {
  const { spawn } = await import("node:child_process");
  const { openSync } = await import("node:fs");
  const log = openSync("/tmp/agora-relay.log", "a");
  const args = process.argv.slice(1).filter((a) => a !== "--detach");
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  console.log(
    `Relay started (pid ${child.pid}). Do NOT wait for it and do NOT background ` +
      `it yourself — it is already detached. The crew's answer arrives in this ` +
      `group on its own when the run finishes; use --status to check sooner.`,
  );
  process.exit(0);
}

if (!statusOnly && !ask) {
  console.error('usage: agora-ask.mjs --status');
  console.error('       agora-ask.mjs --detach "your request"   (returns immediately)');
  console.error('       agora-ask.mjs [--room "Room Name"] "your request"');
  process.exit(2);
}

// ---- resolve the room by NAME, never by index ------------------------------
async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

let state;
try {
  state = await getJSON("/api/state");
} catch (err) {
  console.error(`Agora is not reachable at ${BASE} (${err.message}).`);
  console.error("The server runs inside WSL; it must be up before the room can be reached.");
  process.exit(1);
}

const room = state.rooms.find((r) => r.name === roomName);
if (!room) {
  console.error(`No room named "${roomName}". Rooms: ${state.rooms.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
const names = new Map(state.agents.map((a) => [a.id, a.name]));
const who = (id) => names.get(id) ?? id;

// ---- MODE 1: status. Read what is already there, start nothing. ------------
if (statusOnly) {
  const [{ messages, run }, { goals }] = await Promise.all([
    getJSON(`/api/rooms/${room.id}/messages`),
    getJSON(`/api/rooms/${room.id}/goals`).catch(() => ({ goals: [] })),
  ]);

  console.log(`room: ${room.name}`);
  console.log(`members: ${room.members.map(who).join(", ")}`);

  if (run?.active) {
    console.log(`RUNNING now — turn ${run.turn}, ${who(run.speaking ?? "")} speaking.`);
  } else {
    console.log("idle — no run in flight.");
  }

  const goal = goals?.[goals.length - 1];
  if (goal) {
    console.log(`\nlatest goal: ${goal.title}`);
    console.log(`status: ${goal.status}`);
    for (const s of goal.steps ?? []) {
      console.log(`  [${s.status}] ${s.title}${s.ownerId ? ` — ${who(s.ownerId)}` : ""}`);
    }
    if (goal.handoff) console.log(`\nhandoff waiting for Dominic:\n${goal.handoff}`);
  }

  const recent = (messages ?? []).slice(-tail);
  if (recent.length === 0) {
    console.log("\n(no messages yet)");
  } else {
    console.log(`\n--- last ${recent.length} messages ---`);
    for (const m of recent) {
      const tag = m.kind && m.kind !== "say" ? ` (${m.kind})` : "";
      console.log(`\n[${who(m.authorId)}${tag}]\n${m.text}`);
    }
  }
  process.exit(0);
}

// ---- Wait for the room to be free -----------------------------------------
// A relay arriving while the room is mid-run used to be refused outright, which
// meant a request sent from WhatsApp vanished silently: the caller had already
// been told "relay started". Queueing instead — the room is busy for minutes,
// not hours, and a request that waits is far better than one that disappears.
const WAIT_MS = Number(process.env.AGORA_WAIT_MS ?? 1_800_000); // 30 min
const POLL_MS = 15_000;

async function roomIsBusy() {
  try {
    const { run } = await getJSON(`/api/rooms/${room.id}/messages`);
    return Boolean(run?.active);
  } catch {
    return false; // if we cannot tell, try — the server refuses if truly busy
  }
}

const waitStarted = Date.now();
let announced = false;
while (await roomIsBusy()) {
  if (Date.now() - waitStarted > WAIT_MS) {
    console.error(
      `The room has been busy for ${Math.round(WAIT_MS / 60000)} minutes and the ` +
        `request was NOT delivered. Nothing was lost — send it again when the ` +
        `room is idle (check with --status).`,
    );
    process.exit(1);
  }
  if (!announced) {
    console.log("Room is busy — queued, will send as soon as it is free.");
    announced = true;
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

// ---- MODE 2: start a run and wait for the answer ---------------------------
const socket = new WebSocket(`${BASE.replace("http", "ws")}/ws`);
const transcript = [];
let finished = false;
let refused = null;
let sent = false;

const outcome = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve("timeout"), TIMEOUT_MS);
  socket.addEventListener("error", () => resolve("socket-error"));

  socket.addEventListener("message", (raw) => {
    let e;
    try {
      e = JSON.parse(raw.data);
    } catch {
      return;
    }

    switch (e.type) {
      // The server sends hello, then status, then runs. Broadcasting on hello
      // meant the request went out BEFORE the busy check could see anything —
      // so a relay would start a run and then report itself as refused, which
      // is exactly backwards. Wait for `runs`, decide, then send.
      case "runs": {
        if (finished || sent) break;
        const active = (e.runs ?? []).find((r) => r.roomId === room.id && r.active);
        if (active) {
          refused =
            "That room is already working on something. Use --status to see " +
            "what, and ask again when it finishes.";
          finished = true;
          clearTimeout(timer);
          resolve("busy");
          break;
        }
        sent = true;
        socket.send(
          JSON.stringify({ type: "broadcast", roomId: room.id, text: `${MARKER}\n\n${ask}` }),
        );
        break;
      }
      case "message": {
        const m = e.message;
        if (m?.text) transcript.push({ who: who(m.authorId), kind: m.kind, text: m.text });
        break;
      }
      case "error":
        transcript.push({ who: "system", kind: "error", text: e.detail });
        break;
      case "run":
        if (!e.state.active && !finished) {
          finished = true;
          clearTimeout(timer);
          setTimeout(() => resolve(e.state.stopReason ?? "done"), 500);
        }
        break;
    }
  });
});

try {
  socket.close();
} catch {
  /* already closed */
}

if (refused) {
  console.error(refused);
  process.exit(1);
}

console.log(`room: ${room.name}`);
console.log(`relayed: ${ask}`);
console.log(`outcome: ${outcome}`);
if (outcome === "timeout") {
  console.log(
    "\nNOTE: stopped waiting, but the room is STILL WORKING. Its answer will\n" +
      "reach the group on its own. Use --status in a few minutes to read it.",
  );
}
console.log("");

if (transcript.length === 0) {
  console.log("(the room produced no messages)");
} else {
  for (const t of transcript) {
    const tag = t.kind && t.kind !== "say" ? ` (${t.kind})` : "";
    console.log(`--- ${t.who}${tag} ---\n${t.text}\n`);
  }
}

process.exit(outcome === "socket-error" ? 1 : 0);
