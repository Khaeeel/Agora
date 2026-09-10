#!/usr/bin/env node
/**
 * agora-watch.mjs — one look at whether every room is still moving.
 *
 *   node agora-watch.mjs                          every room, one block each
 *   node agora-watch.mjs --json                   the same, machine-readable
 *   node agora-watch.mjs --stuck                  exit 1 if anything is stalled
 *   node agora-watch.mjs --resume "Trunks"        pick its goal back up
 *   node agora-watch.mjs --say "Trunks" "text"    answer the room and start it
 *   node agora-watch.mjs --answer "HelloAlex | Agora" 3   tap option 3
 *
 * WHY THIS EXISTS
 * A run that ends `blocked` never picks itself back up — deliberately, because
 * resuming a real blocker just spins against the same wall. The cost is that a
 * room can sit finished-but-unfinished indefinitely, and the only sign of it is
 * a line in a transcript nobody happens to be reading. This is that sign,
 * pulled out where a timer or a person can check it in one command.
 *
 * It reads the database READ-ONLY. Anything that starts work still goes through
 * the server's WebSocket, so the server remains the only writer.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = process.env.AGORA_ROOT ?? "/home/dominickooya/agora";
const DB = process.env.AGORA_DB ?? `${ROOT}/data/agora.db`;
const BASE = process.env.AGORA_BASE ?? "http://127.0.0.1:8787";
const WS_URL = `${BASE.replace("http", "ws")}/ws`;

/**
 * The room-level WhatsApp settings, read from .env rather than the process.
 *
 * This runs as its own process, not under the server, so it does not inherit
 * `--env-file`. Without this every report from a room set to `off` counts as a
 * failed send — which is precisely the false alarm this tool exists to stop
 * repeating.
 */
const envFile = (() => {
  const out = new Map();
  try {
    for (const line of readFileSync(`${ROOT}/.env`, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out.set(m[1], m[2].trim());
    }
  } catch { /* no .env is the same as no overrides */ }
  return out;
})();

/** Mirrors jidForRoom()/slugify() on the server: room NAME, not id. */
function jidFor(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-/g, "_")
    .toUpperCase();
  const v = (envFile.get(`AGORA_NOTIFY_JID_${slug}`) ?? "").trim();
  if (v.toLowerCase() === "off") return "";
  // Empty is unset, never "off" — the same rule the server states, and for the
  // same reason: treating empty as off would silently route the room to the
  // global group instead.
  return v || (envFile.get("AGORA_NOTIFY_JID") ?? "").trim();
}

const silenced = (name) => jidFor(name) === "";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const after = (f, n = 1) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + n] : undefined);

const db = new DatabaseSync(DB, { readOnly: true });
const q = (sql, ...p) => db.prepare(sql).all(...p);

const rooms = q("select id, name from rooms order by created_at");

/**
 * The live runs, straight from the server rather than inferred from the DB.
 * `null` means the server never answered — which is itself the finding.
 */
function liveRuns() {
  return new Promise((resolve) => {
    let socket;
    try {
      socket = new WebSocket(WS_URL);
    } catch {
      resolve(null);
      return;
    }
    const done = (v) => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* already gone */ }
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 6000);
    socket.addEventListener("error", () => done(null));
    socket.addEventListener("message", (raw) => {
      let e;
      try { e = JSON.parse(raw.data); } catch { return; }
      if (e.type === "runs") done(e.runs ?? []);
    });
  });
}

/**
 * What is wrong with one room, if anything.
 *
 * The board decides, not the stop reason. A goal whose steps are not all done
 * has not finished, whatever the run called itself on the way out — the same
 * rule closeGoal() already applies on the server.
 */
function diagnose(room, runs) {
  const goal = q(
    "select * from goals where room_id = ? order by created_at desc limit 1",
    room.id,
  )[0];
  const running = (runs ?? []).some((r) => r.roomId === room.id && r.active);
  const out = { room: room.name, roomId: room.id, running, goal: null, problems: [] };
  if (!goal) return out;

  const steps = q("select * from steps where goal_id = ? order by idx", goal.id);
  const open = steps.filter((s) => s.status !== "done");
  out.goal = {
    id: goal.id,
    title: goal.title,
    status: goal.status,
    done: steps.length - open.length,
    total: steps.length,
    openTitles: open.map((s) => `${s.idx}. ${s.title.slice(0, 70)} [${s.status}]`),
    idleMin: goal.ended_at ? Math.round((Date.now() - goal.ended_at) / 60000) : null,
  };

  if (running) return out;

  if (goal.status !== "done" && open.length > 0) {
    // A decision already offered and not yet taken is not a stall: the room did
    // its part and is waiting on a tap. Reporting that as broken would mean
    // every check flags the same room while it legitimately waits.
    const pending = q(
      `select id, choices from messages
        where room_id = ? and kind = 'handoff' and choices is not null
              and answered_with is null
        order by created_at desc limit 1`,
      room.id,
    )[0];
    if (pending) {
      out.problems.push({
        kind: "awaiting_choice",
        detail: JSON.parse(pending.choices).map((c) => c.label).join("  /  "),
        messageId: pending.id,
      });
    } else {
      const ask = q(
        `select text from messages where room_id = ? and kind = 'handoff'
          order by created_at desc limit 1`,
        room.id,
      )[0];
      out.problems.push({
        kind: "stalled",
        detail:
          `${open.length} step${open.length === 1 ? "" : "s"} open, nothing running, ` +
          "no decision offered — nothing will restart this on its own",
        ask: ask?.text ?? null,
      });
    }
  }

  // A send that was attempted and refused is worth chasing. A room set to
  // `off` is not — that is a setting, not a fault. New runs no longer write a
  // notify row at all when the room is silenced, but the rows written before
  // that fix are still there, so skip the room outright rather than counting
  // its history as breakage.
  if (silenced(room.name)) return out;
  const failed = q(
    `select count(*) as n from messages
      where room_id = ? and kind = 'notify' and delivered = 0 and created_at > ?`,
    room.id,
    Date.now() - 24 * 3600 * 1000,
  )[0];
  if (failed.n > 0) {
    out.problems.push({
      kind: "notify_failed",
      detail: `${failed.n} report(s) marked undelivered in the last 24h`,
    });
  }
  return out;
}

/** Send one command and leave. The server owns everything that follows. */
function send(cmd) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL);
    const timer = setTimeout(() => reject(new Error("server did not answer")), 8000);
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("could not reach the server on " + WS_URL));
    });
    socket.addEventListener("message", (raw) => {
      let e;
      try { e = JSON.parse(raw.data); } catch { return; }
      // Same race the relay client hit: send after `runs`, never on `hello`,
      // or the command goes out before the server has said what is running.
      if (e.type !== "runs") return;
      socket.send(JSON.stringify(cmd));
      clearTimeout(timer);
      setTimeout(() => { socket.close(); resolve(); }, 750);
    });
  });
}

function findRoom(name) {
  const r = rooms.find((x) => x.name.toLowerCase() === (name ?? "").toLowerCase());
  if (!r) {
    console.error(`no room named "${name}". Rooms: ${rooms.map((x) => x.name).join(", ")}`);
    process.exit(64);
  }
  return r;
}

const runs = await liveRuns();

if (has("--resume") || has("--say") || has("--answer")) {
  const room = findRoom(after("--resume") ?? after("--say") ?? after("--answer"));
  if ((runs ?? []).some((r) => r.roomId === room.id && r.active)) {
    console.error(`${room.name} is already working — refusing to stack on it.`);
    process.exit(1);
  }
  if (has("--answer")) {
    // Goes in as `answer`, not as a broadcast of the same words: only that path
    // marks the message decided, so the button stops being offered and the
    // transcript records which option was taken rather than a stray remark.
    const pick = Number(after("--answer", 2));
    const msg = q(
      `select id, choices from messages
        where room_id = ? and kind = 'handoff' and choices is not null
              and answered_with is null
        order by created_at desc limit 1`,
      room.id,
    )[0];
    if (!msg) {
      console.error(`${room.name} has no decision waiting.`);
      process.exit(1);
    }
    const options = JSON.parse(msg.choices);
    if (!Number.isInteger(pick) || pick < 1 || pick > options.length) {
      console.error(`pick 1..${options.length}:`);
      options.forEach((c, i) => console.error(`  ${i + 1}. ${c.label} — ${c.detail}`));
      process.exit(64);
    }
    const label = options[pick - 1].label;
    await send({ type: "answer", roomId: room.id, messageId: msg.id, label });
    console.log(`answered ${room.name}: "${label}" — a run is starting.`);
  } else if (has("--say")) {
    const text = after("--say", 2);
    if (!text) {
      console.error('usage: --say "Room Name" "what to tell them"');
      process.exit(64);
    }
    await send({ type: "broadcast", roomId: room.id, text });
    console.log(`sent to ${room.name}; a run is starting.`);
  } else {
    const goal = q(
      "select id from goals where room_id = ? order by created_at desc limit 1",
      room.id,
    )[0];
    if (!goal) {
      console.error("no goal to resume");
      process.exit(1);
    }
    await send({ type: "resume", roomId: room.id, goalId: goal.id });
    console.log(`resumed ${room.name} on goal ${goal.id}.`);
  }
  process.exit(0);
}

const report = rooms.map((r) => diagnose(r, runs));
const stalled = report.filter((r) => r.problems.some((p) => p.kind === "stalled"));

if (has("--alert")) {
  // The rooms already push their own escalation to WhatsApp when they decide
  // they are blocked. This covers the case they cannot: a run that died without
  // deciding anything — a crash, a turn that threw, a server restart mid-goal.
  // Nobody is told about those, and the goal simply sits there.
  //
  // One alert per goal, ever. A stall that has been reported is not news on the
  // next tick, and a watchdog that repeats itself every ten minutes is one that
  // gets muted, which costs more than it saves.
  const stateFile = `${ROOT}/data/watch-alerts.json`;
  let seen = {};
  try { seen = JSON.parse(readFileSync(stateFile, "utf8")); } catch { /* first run */ }

  const fresh = stalled.filter((r) => r.goal && seen[r.goal.id] !== "alerted");
  for (const r of fresh) {
    const p = r.problems.find((x) => x.kind === "stalled");
    const text = [
      `🔴 ${r.room} stopped without asking for anything.`,
      "",
      `Goal: ${r.goal.title}`,
      `Board: ${r.goal.done}/${r.goal.total} steps, idle ${r.goal.idleMin}m`,
      "",
      p.ask ? `Last thing it said:\n${p.ask.slice(0, 700)}` : "It left no handoff at all.",
      "",
      `Resume it: node ${ROOT}/scripts/agora-watch.mjs --resume "${r.room}"`,
    ].join("\n");
    const res = spawnSync(
      process.env.OPENCLAW_BIN ?? "/home/dominickooya/.npm-global/bin/openclaw",
      ["message", "send", "--channel", "whatsapp", "--target", jidFor(r.room), "--message", text],
      { timeout: 60_000, encoding: "utf8" },
    );
    const ok = res.status === 0;
    console.error(`[alert] ${r.room}: ${ok ? "sent" : `FAILED ${res.stderr ?? res.error}`}`);
    if (ok) seen[r.goal.id] = "alerted";
  }
  // Forget goals that are no longer the newest one, so the file cannot grow
  // without bound across months of ticks.
  const live = new Set(report.map((r) => r.goal?.id).filter(Boolean));
  seen = Object.fromEntries(Object.entries(seen).filter(([k]) => live.has(k)));
  try { writeFileSync(stateFile, JSON.stringify(seen, null, 2)); } catch { /* best effort */ }
}

if (has("--json")) {
  console.log(JSON.stringify({ serverUp: runs !== null, rooms: report }, null, 2));
} else {
  console.log(runs === null ? "server: DOWN — nothing on 8787\n" : "server: up\n");
  for (const r of report) {
    const flag = r.running
      ? "RUNNING"
      : r.problems.some((p) => p.kind === "stalled")
        ? "STALLED"
        : r.problems.some((p) => p.kind === "awaiting_choice")
          ? "waiting on a decision"
          : r.problems.length
            ? "check"
            : "idle";
    console.log(`${r.room} — ${flag}`);
    if (r.goal) {
      console.log(
        `  goal   ${r.goal.status} · ${r.goal.done}/${r.goal.total} steps` +
          (r.goal.idleMin != null ? ` · idle ${r.goal.idleMin}m` : ""),
      );
      console.log(`  title  ${r.goal.title.slice(0, 110)}`);
      for (const t of r.goal.openTitles) console.log(`         open · ${t}`);
    }
    for (const p of r.problems) console.log(`  ! ${p.kind} — ${p.detail}`);
    console.log("");
  }
}

if (has("--stuck") && stalled.length > 0) process.exit(1);
