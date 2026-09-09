// The eval runner behind scripts/agora-eval.sh.
//
// Runs eval/tasks.json against one agent in the "Eval" room, grades each reply
// (length, required substrings, forbidden patterns, markers, PASS), reads the
// live metrics for the agent's current prompt sha from the database, appends
// one line to eval/results.jsonl and commits it. Prints one human line first.
//
// Usage: node scripts/agora-eval.mjs --agent <id> [--task <id>]
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const BASE = process.env.AGORA_BASE ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws") + "/ws";
const ROOM = "Eval";
const TURN_MS = 200_000;

const args = process.argv.slice(2);
const agentId = args[args.indexOf("--agent") + 1];
const only = args.includes("--task") ? args[args.indexOf("--task") + 1] : null;
if (!agentId) {
  console.error("usage: agora-eval.mjs --agent <id> [--task <id>]");
  process.exit(64);
}

const tasks = JSON.parse(readFileSync(`${ROOT}/eval/tasks.json`, "utf8")).filter((t) => !only || t.id === only);
if (!tasks.length) {
  console.error(`no task called ${only}`);
  process.exit(77);
}

const state = await (await fetch(`${BASE}/api/state`)).json();
const agents = new Map(state.agents.map((a) => [a.id, a]));
const agent = agents.get(agentId);
if (!agent) {
  console.error(`no agent called ${agentId}`);
  process.exit(77);
}

let room = state.rooms.find((r) => r.name === ROOM);
const orchestratorId = room?.orchestratorId ?? state.agents.find((a) => a.orchestrator && !a.forgedBy)?.id;
if (!orchestratorId) {
  console.error("no orchestrator to run the Eval room");
  process.exit(70);
}
if (!room) {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: ROOM, topic: "Harness checks. Never reaches WhatsApp.", members: [orchestratorId, agentId], orchestratorId }),
  });
  room = (await res.json()).room;
} else if (!room.members.includes(agentId)) {
  const res = await fetch(`${BASE}/api/rooms/${room.id}/members`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ members: [...room.members, agentId] }),
  });
  room = (await res.json()).room;
}
const orchestrator = agents.get(room.orchestratorId);

const words = (t) => t.replace(/^\s*kind:.*$/im, "").replace(/^\s*@next:.*$/im, "").trim().split(/\s+/).filter(Boolean).length;

/** One task: broadcast, wait for the run to end, return this agent's replies and the run cost. */
function runTask(prompt) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const replies = [];
    let sent = false;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("turn timed out"));
    }, TURN_MS);
    ws.addEventListener("error", () => reject(new Error("websocket error")));
    ws.addEventListener("message", (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "runs" && !sent) {
        sent = true;
        ws.send(JSON.stringify({ type: "broadcast", roomId: room.id, text: prompt }));
      }
      if (ev.type === "message" && ev.message.roomId === room.id && ev.message.kind === "agent" && ev.message.authorId === agentId) {
        replies.push(ev.message);
      }
      if (ev.type === "run" && ev.state.roomId === room.id && sent && ev.state.active === false) {
        clearTimeout(timer);
        ws.close();
        resolve({ replies, costUsd: ev.state.costUsd });
      }
    });
  });
}

const results = [];
let costUsd = 0;
for (const t of tasks) {
  const prompt = t.prompt.replaceAll("{agent}", agent.name).replaceAll("{orchestrator}", orchestrator?.name ?? "the orchestrator");
  let outcome;
  try {
    outcome = await runTask(prompt);
  } catch (err) {
    results.push({ id: t.id, pass: false, words: null, reason: err.message });
    continue;
  }
  costUsd += outcome.costUsd ?? 0;
  const m = outcome.replies.at(-1);
  if (!m) {
    results.push({ id: t.id, pass: false, words: null, reason: `${agent.name} did not speak` });
    continue;
  }
  const text = m.text.trim();
  const w = words(text);
  const reasons = [];
  if (t.expectPass) {
    if (!/^pass$/i.test(text)) reasons.push("expected a bare PASS");
  } else {
    if (w > (t.maxWords ?? 45)) reasons.push(`${w} words > ${t.maxWords}`);
    for (const s of t.mustContain ?? []) if (!text.toLowerCase().includes(s.toLowerCase())) reasons.push(`missing "${s}"`);
    for (const p of t.mustNotMatch ?? []) if (new RegExp(p, "m").test(text)) reasons.push(`matched /${p}/`);
    if (t.needsMarkers && (!m.act || !m.nextId)) reasons.push("markers missing");
  }
  results.push({ id: t.id, pass: reasons.length === 0, words: w, reason: reasons.join("; ") || null, promptSha: m.promptSha ?? null });
}

// ---- live metrics for the current prompt, and for everything before it ----
function live(where, params) {
  const db = new DatabaseSync(`${ROOT}/data/agora.db`, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT LENGTH(text) AS len, cost_usd, act, next_id FROM messages
       WHERE kind='agent' AND author_id=? AND text NOT LIKE 'Progress check%' ${where}`,
    )
    .all(agentId, ...params);
  if (!rows.length) return null;
  const lens = rows.map((r) => r.len).sort((a, b) => a - b);
  const cost = rows.filter((r) => r.cost_usd != null);
  return {
    n: rows.length,
    avgChars: Math.round(lens.reduce((a, b) => a + b, 0) / lens.length),
    p90Chars: lens[Math.min(lens.length - 1, Math.floor(0.9 * lens.length))],
    pctOver900: +((100 * lens.filter((l) => l > 900).length) / lens.length).toFixed(1),
    avgCostUsd: cost.length ? +(cost.reduce((a, r) => a + r.cost_usd, 0) / cost.length).toFixed(3) : null,
    markerHitPct: +((100 * rows.filter((r) => r.act && r.next_id).length) / rows.length).toFixed(1),
  };
}
const sha = results.find((r) => r.promptSha)?.promptSha ?? null;
const now = sha ? live("AND prompt_sha = ?", [sha]) : null;
const prev = sha ? live("AND (prompt_sha IS NULL OR prompt_sha <> ?)", [sha]) : live("", []);

const row = { ts: new Date().toISOString(), kind: "eval", agent: agentId, promptSha: sha, tasks: results, live: now, prev, costUsd: +costUsd.toFixed(3) };
appendFileSync(`${ROOT}/eval/results.jsonl`, JSON.stringify(row) + "\n");
try {
  execFileSync("git", ["-C", ROOT, "add", "--", "eval/results.jsonl"]);
  execFileSync("git", [
    "-C", ROOT, "-c", "user.name=agora-eval", "-c", "user.email=agora-eval@agents.agora",
    "commit", "-q", "-o", "eval/results.jsonl", "-m", `eval(${agentId}): ${results.filter((r) => r.pass).length}/${results.length}`,
  ]);
} catch (err) {
  console.error("[git] results commit failed:", err.message);
}

const passed = results.filter((r) => r.pass).length;
const fmt = (m) => (m ? `avg ${m.avgChars} chars · p90 ${m.p90Chars} · markers ${m.markerHitPct}%` : "no data");
console.log(`eval ${agentId}: ${passed}/${results.length} · now ${fmt(now)} · prev ${prev ? `avg ${prev.avgChars} chars` : "no data"} · $${costUsd.toFixed(2)}`);
for (const r of results) console.log(`  ${r.pass ? "ok  " : "FAIL"} ${r.id}${r.words != null ? ` · ${r.words} words` : ""}${r.reason ? ` · ${r.reason}` : ""}`);
process.exit(passed === results.length ? 0 : 1);
