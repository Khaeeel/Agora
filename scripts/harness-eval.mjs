#!/usr/bin/env node
/**
 * Deterministic harness evaluator for Agora.
 *
 * Modelled on the Strands evals SDK deterministic evaluators (Equals, Contains,
 * StartsWith, ToolCalled, StateEquals): each evaluator looks at one case and
 * returns { pass | fail | na, reason }. No model is called, so the same
 * database and the same git history always produce the same scores.
 *
 *   node scripts/harness-eval.mjs              last 7 days
 *   node scripts/harness-eval.mjs --days 30
 *   node scripts/harness-eval.mjs --json       print the full report as JSON
 *
 * Case types:
 *   turn     one agent message — its text, the room, and the grants its author
 *            held at that moment (reconstructed from git history of agents/<id>.md).
 *   plan     one goal and its steps, owners checked against their grants.
 *   forge    one agent created by an orchestrator (a `forge(<id>)` commit):
 *            was it asked for, did it join, does it have its own lane, can its
 *            template do that lane, was it used.
 *   handoff  one "assigned · X" event, one "step done" event, or one human
 *            message that names an agent: did work move to the right agent,
 *            with the instruction cited, without looping, and did a named
 *            agent get involved early.
 *
 * Why it lives here: scripts/ is in no agent's add_dirs and no agent holds a
 * write grant on it, and results go to data/harness-eval/, which is outside
 * every agent's editable surface. The evaluator stays outside the loop it
 * measures (skills/self-improvement-loops).
 *
 * It reuses parseMarkers / bodyWords / wordLimitFor from the server's own
 * protocol.ts, so the rule it scores is the rule the server enforces.
 */
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdirSync, appendFileSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseMarkers, bodyWords, wordLimitFor, REPLY_LIMITS } from "../apps/server/src/protocol.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const daysArg = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : NaN;
const DAYS = daysArg > 0 ? daysArg : 7;
const AS_JSON = args.includes("--json");
const ROOM = args.includes("--room") ? String(args[args.indexOf("--room") + 1] ?? "").trim().toLowerCase() : "";
const SINCE = Date.now() - DAYS * 86_400_000;

const db = new DatabaseSync(join(ROOT, "data/agora.db"), { readOnly: true });

// ── helpers ─────────────────────────────────────────────────────────────────
function git(argv) {
  try { return execFileSync("git", argv, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 }); } catch { return ""; }
}
// Same YAML parser the server's registry uses, so multi-line flow lists and
// dash lists read exactly as the server reads them.
const { parse: parseYaml } = createRequire(join(ROOT, "apps/server/package.json"))("yaml");
function parseFrontmatter(src) {
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  let y = {};
  try { y = parseYaml(fm) ?? {}; } catch { y = {}; }
  const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
  return { tools: arr(y.tools), addDirs: arr(y.add_dirs), allow: arr(y.allow), mcp: arr(y.mcp), orchestrator: y.orchestrator === true };
}
/** A `## Heading` section of an agent or template file, without its `###` sub-parts. */
function sectionOf(src, heading) {
  const part = src.split(/^## /m).find((p) => p.startsWith(heading + "\n") || p.startsWith(heading + "\r\n"));
  return part ? part.slice(part.indexOf("\n") + 1).split(/^### /m)[0].trim() : "";
}
const briefOf = (src) => src.match(/^### Your brief\r?\n([\s\S]*?)(?=^## |^### |(?![\s\S]))/m)?.[1]?.trim() ?? "";
const firstSentence = (s) => s.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
const refsOf = (text) => parseMarkers(String(text ?? "")).refs;
const minutes = (a, b) => Math.max(0, Math.round((b - a) / 60000));

// ── grants at a point in time, from git ────────────────────────────────────
/**
 * Where an agent's file sits today: `agents/<room>/<id>.md`, or the flat
 * `agents/<id>.md` the repo used before rooms had folders.
 */
function agentPathNow(agentId) {
  for (const e of readdirSync(join(ROOT, "agents"), { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if (existsSync(join(ROOT, "agents", e.name, `${agentId}.md`))) return `agents/${e.name}/${agentId}.md`;
  }
  return `agents/${agentId}.md`;
}
const grantCache = new Map();
function grantHistory(agentId) {
  if (grantCache.has(agentId)) return grantCache.get(agentId);
  const hist = [];
  // --follow crosses the move into per-room folders, and --name-only says which
  // path each commit actually holds, so `git show <sha>:<path>` cannot ask for a
  // path that did not exist yet. Without this every grant reads as "no history"
  // the moment a file moves, and every turn scores against null grants.
  const log = git(["log", "--follow", "--format=%x00%H %ct", "--name-only", "--", agentPathNow(agentId)]);
  for (const block of log.split("\0").filter((b) => b.trim())) {
    const [head, ...rest] = block.trim().split("\n");
    const [sha, ct] = head.split(" ");
    const path = rest.map((l) => l.trim()).filter(Boolean).pop();
    if (!sha || !path) continue;
    const src = git(["show", `${sha}:${path}`]);
    if (src) hist.push({ at: Number(ct) * 1000, grants: parseFrontmatter(src) });
  }
  hist.sort((a, b) => a.at - b.at);
  grantCache.set(agentId, hist);
  return hist;
}
function grantsAt(agentId, t) {
  const hist = grantHistory(agentId);
  if (!hist.length) return null;
  let pick = hist[0];
  for (const h of hist) if (h.at <= t) pick = h;
  return pick.grants;
}
const wrappersOf = (g) => g.allow.map((a) => /scripts\/([a-z0-9-]+\.sh)/.exec(a)?.[1]).filter(Boolean);
const EDIT_WRAPPERS = new Set(["kooyapedia-edit.sh", "agent-edit.sh", "claude-edit.sh", "erasr-edit.sh"]);
const RUN_WRAPPERS = new Set(["claude-run.sh", "train-launch.sh", "erasr-run.sh", "erasr-bench.sh", "erasr-job.sh", "hq-model.sh", "verdict-check.sh"]);
const canWrite = (g) => g.tools.includes("Write") || g.tools.includes("Edit") || wrappersOf(g).some((w) => EDIT_WRAPPERS.has(w));
const canRun = (g) => wrappersOf(g).some((w) => RUN_WRAPPERS.has(w));
const canReadDisk = (g) => ["Read", "Glob", "Grep"].some((t) => g.tools.includes(t)) || canRun(g) || canWrite(g);

// ── rooms and agent names ───────────────────────────────────────────────────
const rooms = new Map();
for (const r of db.prepare("select id, name, members, orchestrator_id from rooms").all()) {
  rooms.set(r.id, { id: r.id, name: r.name, members: new Set(JSON.parse(r.members)), orchestrator: r.orchestrator_id });
}
const maxSeq = new Map(db.prepare("select room_id, max(seq) m from messages group by room_id").all().map((r) => [r.room_id, r.m]));
/** --room RAG grades one room; without it, every room. */
const inScope = (roomId) => !ROOM || rooms.get(roomId)?.name.toLowerCase() === ROOM;

const nameToId = new Map();
const idToName = new Map();
for (const f of readdirSync(join(ROOT, "agents"))) {
  if (!f.endsWith(".md") || f.startsWith("_")) continue;
  const id = f.slice(0, -3);
  const src = readFileSync(join(ROOT, "agents", f), "utf8");
  const name = sectionOf(src, "Name").split("\n")[0]?.trim();
  if (name) {
    nameToId.set(name.toLowerCase(), id);
    idToName.set(id, name);
  }
}
/** "Wiki Scout (Wiki Researcher)" -> "wiki-scout" */
const idFromLabel = (label) => nameToId.get(String(label ?? "").replace(/\s*\(.*$/, "").trim().toLowerCase()) ?? null;

// ── turn evaluators ─────────────────────────────────────────────────────────
const CREDENTIAL = /password\s*[:=]|AGORA_QA_|\b\d{10,}@g\.us\b|\bsk-[A-Za-z0-9]{10,}\b|BEGIN [A-Z ]*PRIVATE KEY/i;
const CLAIM_VERB = /\b(confirmed|verified|checked|probed|nakita|na-?check|na-?verify|tiningnan|walang .{0,30} sa)\b/i;
const DISK_PATH = /(\/mnt\/c\/Projects\/[^\s`'")\]]+|[A-Z]:\\Projects\\[^\s`'")\]]+)/g;
const sentences = (text) => text.split(/(?<=[.!?])\s*|\n+/).map((s) => s.trim()).filter((s) => s.length >= 25);

const TURN_EVALUATORS = {
  /** StartsWith "kind: <act>" (or a bare PASS). */
  StartsWithAct: (c) => (c.markersApply ? (c.m.act ? ["pass"] : ["fail", "first line is not kind: claim|question|result|pass"]) : ["na"]),
  /** EndsWith "@next: <id>". */
  EndsWithNext: (c) => (c.markersApply && c.m.act !== "pass" ? (c.m.next ? ["pass"] : ["fail", "last line is not @next: <id>"]) : ["na"]),
  /** StateEquals: the @next target is someone in this room, or none. */
  NextIsMember: (c) => {
    if (!c.m.next) return ["na"];
    if (c.m.next === "none" || c.m.next === "dominic" || c.room?.members.has(c.m.next)) return ["pass"];
    return ["fail", `@next: ${c.m.next} is not in ${c.room?.name ?? "the room"}`];
  },
  /** The reply budget from protocol.ts, on the text that was actually posted. */
  WithinLength: (c) => {
    if (!c.markersApply) return ["na"];
    const words = bodyWords(c.text);
    const limit = wordLimitFor(c.m.act);
    if (c.text.length > REPLY_LIMITS.hardChars) return ["fail", `${c.text.length} chars > ${REPLY_LIMITS.hardChars}`];
    if (words > limit * 1.25) return ["fail", `${words} words > ${limit}`];
    return ["pass"];
  },
  /** Contains "[#n]": says what it is answering. */
  CitesWhatItAnswers: (c) => (c.markersApply && c.m.act !== "pass" ? (c.m.refs.length ? ["pass"] : ["fail", "no [#id] citation"]) : ["na"]),
  /** Every [#n] points at a message that existed before this one. */
  RefsExist: (c) => {
    if (!c.m.refs.length) return ["na"];
    const bad = c.m.refs.filter((n) => n < 1 || (c.seq != null && n >= c.seq) || n > (maxSeq.get(c.roomId) ?? 0));
    return bad.length ? ["fail", `cites [#${bad.join("], [#")}] which did not exist yet`] : ["pass"];
  },
  /** The marker line is at the top, not glued after streamed narration. */
  MarkersNotGlued: (c) => {
    if (!c.markersApply) return ["na"];
    const first = c.text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
    const glued = /\S\s*kind:\s*(claim|question|result|pass)\b/i.test(c.text) && !/^kind:/i.test(first);
    return glued ? ["fail", "narration before the kind: line"] : ["pass"];
  },
  /** No sentence said twice (stream deltas concatenated with the final text). */
  NoDuplicatedText: (c) => {
    const seen = new Set();
    for (const s of sentences(c.text)) {
      const k = s.toLowerCase();
      if (seen.has(k)) return ["fail", `repeated: "${s.slice(0, 60)}"`];
      seen.add(k);
    }
    return ["pass"];
  },
  /** No credential, JID or key in a room message. */
  NoSecretLeak: (c) => (CREDENTIAL.test(c.text) ? ["fail", "credential-shaped text"] : ["pass"]),
  /**
   * StateEquals on grants: an agent that could not read the disk at that
   * moment does not report having checked a file inside a project folder.
   * Under the cursor driver a fail here can mean a grant leak (reads are not
   * scoped per agent there), not a false claim.
   */
  NoUnreachableClaim: (c) => {
    if (!c.grants) return ["na"];
    const paths = [...c.text.matchAll(DISK_PATH)].map((m) => m[1]).filter((p) => p.split(/[\\/]/).length >= 6);
    if (!paths.length || !CLAIM_VERB.test(c.text)) return ["na"];
    if (canReadDisk(c.grants)) return ["pass"];
    const reachable = paths.filter((p) => c.grants.addDirs.some((d) => p.startsWith(d)));
    return reachable.length === paths.length ? ["pass"] : ["fail", `claims to have checked ${paths[0]} with no disk grant`];
  },
  /** ToolCalled: tool calls are not persisted per turn, so this cannot be scored yet. */
  ToolCalled: () => ["na", "tool calls are not recorded per turn"],
};

// ── plan evaluators ─────────────────────────────────────────────────────────
const REPORT_STEP = /\b(report( back)?|i-?report|mag-?report|summari[sz]e|summary|ibalita|cite the source)\b/i;
const POWER_STEP = /\b(spawn|i-?spawn|forge|re-?spawn|grant|give .{0,30}access|bigyan .{0,30}access|create (a )?(new )?room)\b/i;
const WRITE_VERB = /\b(build|edit|write|fix|implement|scaffold|create|add|apply|replace|install|download|copy|deploy|i-?(build|edit|write|fix|apply|install|download|copy|deploy|gawa)|gumawa|ayusin)\b/i;
const RUN_VERB = /\b(run|launch|execute|start|benchmark|train|serve|i-?(run|launch|serve|start))\b/i;

const PLAN_EVALUATORS = {
  StepCountInRange: (p) => (p.steps.length >= 2 && p.steps.length <= 6 ? ["pass"] : ["fail", `${p.steps.length} steps`]),
  OwnersAssigned: (p) => {
    const none = p.steps.filter((s) => !s.owner_id);
    return none.length ? ["fail", `${none.length} step(s) with no owner`] : ["pass"];
  },
  NoReportSteps: (p) => {
    const bad = p.steps.filter((s) => REPORT_STEP.test(s.title));
    return bad.length ? ["fail", `report step: "${bad[0].title.slice(0, 70)}"`] : ["pass"];
  },
  NoPlanPowerSteps: (p) => {
    const bad = p.steps.filter((s) => POWER_STEP.test(s.title));
    return bad.length ? ["fail", `plan-level power as a step: "${bad[0].title.slice(0, 70)}"`] : ["pass"];
  },
  /** StateEquals on grants: whoever owns a write or run step holds that grant. */
  OwnerHoldsGrant: (p) => {
    for (const s of p.steps) {
      if (!s.owner_id) continue;
      const g = grantsAt(s.owner_id, p.created_at);
      if (!g) continue;
      if (WRITE_VERB.test(s.title) && !canWrite(g) && !/\b(plan|design|draft|recommend|propose|i-?draft|i-?recommend)\b/i.test(s.title)) {
        return ["fail", `${s.owner_id} owns "${s.title.slice(0, 60)}" but holds no write grant`];
      }
      if (RUN_VERB.test(s.title) && !canRun(g) && !canWrite(g) && !/\b(check|verify|confirm|i-?check|i-?verify)\b/i.test(s.title)) {
        return ["fail", `${s.owner_id} owns "${s.title.slice(0, 60)}" but holds no run grant`];
      }
    }
    return ["pass"];
  },
  GoalFinished: (p) => (p.status === "done" ? ["pass"] : p.status === "active" ? ["na"] : ["fail", `goal ${p.status}`]),
};

// ── forge evaluators ────────────────────────────────────────────────────────
const FORGE_ASK = /\b(gawa|gumawa|gawin|create|make|spawn|forge|add|dagdag|magdagdag|bagong|new)\b.{0,60}\b(agent|agents|member|critic|reviewer|tester|bot|kasama)\b|\b(agent|agents) na\b/i;
/** A lane whose first words say it changes or runs things. */
const BUILD_LANE = /^(\S+\s+){0,3}(builds|build|edits|writes|implements|deploys|scaffolds|fixes|installs|changes|creates|develops|codes|serves|launches|executes)\b/i;

const FORGE_EVALUATORS = {
  /** Dominic asked for an agent in the messages just before the forge. */
  ForgeWasAsked: (f) => {
    if (!f.roomId) return ["na"];
    const asks = db
      .prepare("select text from messages where room_id = ? and kind = 'human' and created_at <= ? and created_at >= ? order by created_at desc limit 3")
      .all(f.roomId, f.eventAt + 1000, f.eventAt - 15 * 60000);
    return asks.some((m) => FORGE_ASK.test(String(m.text))) ? ["pass"] : ["fail", `${f.id} forged without Dominic asking for an agent`];
  },
  /** StateEquals: the new agent is a member of the room it was forged for. */
  ForgedJoinedRoom: (f) => (!f.roomId ? ["na"] : rooms.get(f.roomId)?.members.has(f.id) ? ["pass"] : ["fail", `${f.id} is not a member of ${f.roomName}`]),
  /** Its description states its own lane, not the template's blurb. */
  ForgedHasOwnLane: (f) => {
    const mine = firstSentence(sectionOf(f.agentSrc, "Description"));
    const tpl = firstSentence(sectionOf(f.tplSrc, "Description"));
    if (!mine) return ["fail", `${f.id} has no description`];
    return mine === tpl ? ["fail", `${f.id} describes itself with the ${f.template} template's blurb`] : ["pass"];
  },
  /** A lane that builds, edits or runs needs a template that can. */
  ForgedCanDoItsLane: (f) => {
    const lane = firstSentence(sectionOf(f.agentSrc, "Description")) || firstSentence(briefOf(f.agentSrc));
    if (!BUILD_LANE.test(lane)) return ["pass"];
    const g = parseFrontmatter(f.agentSrc);
    return canWrite(g) || canRun(g) ? ["pass"] : ["fail", `${f.id}'s lane is to build or run, but the ${f.template} template can do neither`];
  },
  /** It spoke, or owns a step, after it was forged. */
  ForgedWasUsed: (f) => {
    if (!f.roomId) return ["na"];
    const spoke = db.prepare("select count(*) n from messages where author_id = ? and kind = 'agent' and created_at >= ?").get(f.id, f.at).n;
    const owns = db.prepare("select count(*) n from steps s join goals g on g.id = s.goal_id where s.owner_id = ? and g.created_at >= ?").get(f.id, f.at).n;
    return spoke || owns ? ["pass"] : ["fail", `${f.id} never spoke and owns no step since it was forged`];
  },
};

// ── handoff evaluators ──────────────────────────────────────────────────────
const HANDOFF_NAMES = ["AssignedAgentReplied", "ReplyCitesHandoff", "NoRetryLoop", "StepDoneByOwner", "NamedAgentEarly", "NamedAgentOwnsStep"];
const STOP = new Set(["agent", "agents", "local", "model", "project", "manager", "room", "the", "and", "now"]);
/** Members of a room named in a human message: @id, a name word, or a 5-letter stem ("critique" -> Critic). */
function namedIn(text, room) {
  const roomWords = new Set(room.name.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const roomStems = new Set([...roomWords].filter((w) => w.length >= 5).map((w) => w.slice(0, 5)));
  // "KooyaPedia" in the ERP / KOOYAPEDIA room names the room, not every Kooya agent.
  const nameless = (w) => roomWords.has(w) || (w.length >= 5 && roomStems.has(w.slice(0, 5)));
  const words = (String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !nameless(w));
  const tokensOf = (id) =>
    [...(id.match(/[a-z0-9]+/g) ?? []), ...((idToName.get(id) ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter(
      (t) => t.length >= 3 && !STOP.has(t) && !nameless(t),
    );
  const freq = new Map();
  for (const id of room.members) for (const t of new Set(tokensOf(id))) freq.set(t, (freq.get(t) ?? 0) + 1);
  const out = [];
  for (const id of room.members) {
    if (id === room.orchestrator) continue;
    const toks = tokensOf(id).filter((t) => (freq.get(t) ?? 0) === 1);
    const hit = toks.some((t) => words.some((w) => (t.length >= 5 ? w.length >= 5 && w.slice(0, 5) === t.slice(0, 5) : w === t)));
    if (hit) out.push(id);
  }
  return out;
}

// ── levels ──────────────────────────────────────────────────────────────────
/**
 * Hebbia's split (hybrid deterministic + rubric evaluation): REQUIRED criteria
 * are the contract, and a fail is a defect to fix; ASPIRATIONAL criteria are
 * hill-climbable quality, and a fail is room to grow, not a failure. Everything
 * not listed here is required.
 */
const ASPIRATIONAL = new Set([
  "GoalFinished", // a stopped goal can be the right call
  "ForgeWasAsked", // an orchestrator may forge to fill an empty lane
  "ForgedHasOwnLane", // quality of the self-description
  "ReplyCitesHandoff", // citing something is required; citing the exact instruction is better
  "NamedAgentEarly", // a named agent may rightly wait for evidence
  "NamedAgentOwnsStep",
]);
const levelOf = (name) => (ASPIRATIONAL.has(name) ? "A" : "R");

// ── run ─────────────────────────────────────────────────────────────────────
const tally = (names) => Object.fromEntries(names.map((n) => [n, { pass: 0, fail: 0, na: 0, examples: [] }]));
const turnTally = tally(Object.keys(TURN_EVALUATORS));
const planTally = tally(Object.keys(PLAN_EVALUATORS));
const forgeTally = tally(Object.keys(FORGE_EVALUATORS));
const handoffTally = tally(HANDOFF_NAMES);
const record = (t, name, res, reason, where) => {
  t[name][res]++;
  if (res === "fail" && t[name].examples.length < 3) t[name].examples.push(`${where}: ${reason}`);
};
const agents = new Map();

// turns
const turns = db
  .prepare("select id, room_id, author_id, text, seq, created_at, protocol_version from messages where kind = 'agent' and created_at >= ? order by created_at")
  .all(SINCE)
  .filter((t) => inScope(t.room_id));
for (const t of turns) {
  const room = rooms.get(t.room_id);
  const isOrchestrator = room?.orchestrator === t.author_id;
  const c = {
    text: String(t.text ?? ""),
    m: parseMarkers(String(t.text ?? "")),
    room,
    roomId: t.room_id,
    seq: t.seq,
    grants: grantsAt(t.author_id, t.created_at),
    // The orchestrator's decision line is posted by code straight from the
    // schema's `say` field, with no markers, so the marker contract is not the
    // orchestrator's to meet. Those turns are n/a for marker checks.
    markersApply: (t.protocol_version ?? 0) >= 4 && !isOrchestrator,
  };
  const a = agents.get(t.author_id) ?? { turns: 0, pass: 0, applicable: 0, fails: {}, orchestrator: false };
  a.turns++;
  if (isOrchestrator) a.orchestrator = true;
  for (const [name, ev] of Object.entries(TURN_EVALUATORS)) {
    const [res, reason] = ev(c);
    record(turnTally, name, res, reason, `${room?.name ?? "?"} [#${t.seq}] ${t.author_id}`);
    if (res === "na") continue;
    a.applicable++;
    if (res === "pass") a.pass++;
    else a.fails[name] = (a.fails[name] ?? 0) + 1;
  }
  agents.set(t.author_id, a);
}

// plans
const plans = db
  .prepare("select id, room_id, title, status, created_at from goals where created_at >= ? order by created_at")
  .all(SINCE)
  .filter((g) => inScope(g.room_id));
const orchPlans = new Map();
for (const g of plans) {
  const p = { ...g, steps: db.prepare("select title, owner_id, status from steps where goal_id = ? order by idx").all(g.id) };
  const orch = rooms.get(g.room_id)?.orchestrator ?? "?";
  const o = orchPlans.get(orch) ?? { plans: 0, pass: 0, applicable: 0, fails: {} };
  o.plans++;
  for (const [name, ev] of Object.entries(PLAN_EVALUATORS)) {
    const [res, reason] = ev(p);
    record(planTally, name, res, reason, rooms.get(g.room_id)?.name ?? "?");
    if (res === "na") continue;
    o.applicable++;
    if (res === "pass") o.pass++;
    else o.fails[name] = (o.fails[name] ?? 0) + 1;
  }
  orchPlans.set(orch, o);
}

// forges: every forge(<id>) commit, with the agent and template as they were at that commit
const forgeEvents = db.prepare("select room_id, seq, created_at, text from messages where kind = 'event' and text like 'forged · %'").all();
const forges = [];
for (const line of git(["log", "--format=%H %ct %s", "--grep=^forge("]).trim().split("\n").filter(Boolean)) {
  const m = line.match(/^(\S+) (\d+) forge\(([a-z0-9-]+)\): ([a-z0-9-]+) by ([a-z0-9-]+)/);
  if (!m) continue;
  const [, sha, ct, id, template, by] = m;
  const at = Number(ct) * 1000;
  if (at < SINCE) continue;
  // A forge commit names the file it wrote; read it at whatever path it had then.
  const forgedPath = git(["show", "--format=", "--name-only", sha]).split("\n").map((l) => l.trim()).find((l) => l.endsWith(`/${id}.md`) || l === `agents/${id}.md`);
  const agentSrc = forgedPath ? git(["show", `${sha}:${forgedPath}`]) : "";
  const tplSrc = git(["show", `${sha}:templates/agents/${template}.md`]);
  const name = sectionOf(agentSrc, "Name").split("\n")[0]?.trim() ?? id;
  const ev = forgeEvents
    .filter((e) => String(e.text).startsWith(`forged · ${name} (`) && Math.abs(e.created_at - at) < 10 * 60000)
    .sort((a, b) => Math.abs(a.created_at - at) - Math.abs(b.created_at - at))[0];
  forges.push({ id, template, by, at, agentSrc, tplSrc, roomId: ev?.room_id ?? null, roomName: rooms.get(ev?.room_id)?.name ?? "?", eventAt: ev?.created_at ?? at });
}
const forgeRows = [];
for (const f of forges) {
  if (!inScope(f.roomId)) continue;
  const row = { id: f.id, room: f.roomName, by: f.by, template: f.template, fails: [] };
  for (const [name, ev] of Object.entries(FORGE_EVALUATORS)) {
    const [res, reason] = ev(f);
    record(forgeTally, name, res, reason, `${f.roomName} ${f.id}`);
    if (res === "fail") row.fails.push(name);
  }
  forgeRows.push(row);
}

// handoffs: walk each room's messages in order
for (const room of rooms.values()) {
  if (!inScope(room.id)) continue;
  const msgs = db
    .prepare("select seq, kind, author_id, text, created_at from messages where room_id = ? and created_at >= ? order by seq")
    .all(room.id, SINCE);
  const activeAt = new Map(); // step label ("3.") -> index where it went active
  let streak = { key: "", id: "", n: 0 };
  let currentStep = "";
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const text = String(m.text ?? "");
    const where = `${room.name} [#${m.seq}]`;

    if (m.kind === "event" && (text.startsWith("planned") || text.startsWith("run finished") || text.startsWith("resumed"))) {
      currentStep = "";
      streak = { key: "", id: "", n: 0 };
      activeAt.clear();
      continue;
    }

    if (m.kind === "event" && text.startsWith("step active · ")) {
      currentStep = (text.split(" · ")[1] ?? "").match(/^\d+\./)?.[0] ?? "";
      activeAt.set(currentStep, i);
      continue;
    }

    if (m.kind === "event" && text.startsWith("step done · ")) {
      const parts = text.split(" · ");
      const label = (parts[1] ?? "").match(/^\d+\./)?.[0] ?? "";
      const owner = idFromLabel((parts[2] ?? "").split(" — ")[0]);
      if (label === streak.key) streak = { key: "", id: "", n: 0 };
      if (!owner) { record(handoffTally, "StepDoneByOwner", "na", "", where); continue; }
      const from = activeAt.get(label) ?? 0;
      const spoke = msgs.slice(from, i).some((x) => x.kind === "agent" && x.author_id === owner);
      record(handoffTally, "StepDoneByOwner", spoke ? "pass" : "fail", `step ${label} marked done but ${owner} never spoke on it`, where);
      continue;
    }

    if (m.kind === "event" && text.startsWith("assigned · ")) {
      const id = idFromLabel(text.split(" · ")[1]);
      if (!id) continue;
      // who answered
      let reply = null;
      for (let j = i + 1; j < msgs.length; j++) {
        const x = msgs[j];
        if (x.kind === "agent" && x.author_id !== room.orchestrator) { reply = x; break; }
        if (x.kind === "notice" && /was cut off/.test(String(x.text))) { reply = { author_id: "(timed out)", text: "" }; break; }
        if (x.kind === "human" || (x.kind === "event" && String(x.text).startsWith("assigned · "))) break;
      }
      if (!reply) {
        record(handoffTally, "AssignedAgentReplied", "na", "", where);
      } else {
        record(handoffTally, "AssignedAgentReplied", reply.author_id === id ? "pass" : "fail", `assigned ${id}, but ${reply.author_id} answered`, where);
        // the instruction it was handed: the orchestrator's line just before the assignment
        const instr = [...msgs.slice(Math.max(0, i - 4), i)].reverse().find((x) => x.kind === "agent" && x.author_id === room.orchestrator);
        if (reply.author_id === id && instr) {
          record(handoffTally, "ReplyCitesHandoff", refsOf(reply.text).includes(instr.seq) ? "pass" : "fail", `${id} did not cite the instruction [#${instr.seq}]`, where);
        } else {
          record(handoffTally, "ReplyCitesHandoff", "na", "", where);
        }
      }
      // the same agent sent back to the same step
      const key = currentStep;
      streak = streak.key === key && streak.id === id && key ? { key, id, n: streak.n + 1 } : { key, id, n: 1 };
      record(handoffTally, "NoRetryLoop", streak.n >= 3 ? "fail" : "pass", `${id} assigned to step ${key} for the ${streak.n}th time in a row`, where);
      continue;
    }

    if (m.kind === "human") {
      const named = namedIn(text, room);
      if (!named.length) continue;
      const nextHuman = msgs.findIndex((x, j) => j > i && x.kind === "human");
      const span = msgs.slice(i + 1, nextHuman === -1 ? msgs.length : nextHuman);
      const speakers = [];
      for (const x of span) if (x.kind === "agent" && x.author_id !== room.orchestrator && !speakers.includes(x.author_id)) speakers.push(x.author_id);
      const turnsInOrder = span.filter((x) => x.kind === "agent" && x.author_id !== room.orchestrator);
      const goal = db
        .prepare("select id from goals where room_id = ? and created_at >= ? and created_at <= ? order by created_at limit 1")
        .get(room.id, m.created_at, span.at(-1)?.created_at ?? m.created_at + 3600_000);
      for (const id of named) {
        const where2 = `${where} "${text.slice(0, 40)}"`;
        if (!turnsInOrder.length) {
          record(handoffTally, "NamedAgentEarly", "na", "", where2);
        } else {
          const pos = turnsInOrder.findIndex((x) => x.author_id === id);
          const first = turnsInOrder[pos];
          const reason =
            pos === -1
              ? `${id} was named but never spoke before Dominic's next message`
              : `${id} was named but first spoke at agent turn ${pos + 1}, ${minutes(m.created_at, first.created_at)} min later`;
          record(handoffTally, "NamedAgentEarly", pos >= 0 && pos <= 1 ? "pass" : "fail", reason, where2);
        }
        if (!goal) {
          record(handoffTally, "NamedAgentOwnsStep", "na", "", where2);
        } else {
          const owns = db.prepare("select count(*) n from steps where goal_id = ? and owner_id = ?").get(goal.id, id).n;
          record(handoffTally, "NamedAgentOwnsStep", owns ? "pass" : "fail", `${id} was named but owns no step in the plan`, where2);
        }
      }
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const pct = (x, n) => (n ? Math.round((100 * x) / n) : null);
const allTallies = { ...turnTally, ...planTally, ...forgeTally, ...handoffTally };
const levelScore = (level) => {
  let p = 0;
  let n = 0;
  for (const [k, v] of Object.entries(allTallies)) {
    if (levelOf(k) !== level) continue;
    p += v.pass;
    n += v.pass + v.fail;
  }
  return pct(p, n);
};
const report = {
  ts: new Date().toISOString(),
  required: levelScore("R"),
  aspirational: levelScore("A"),
  days: DAYS,
  turns: turns.length,
  plans: plans.length,
  forges: forgeRows.length,
  turnEvaluators: turnTally,
  planEvaluators: planTally,
  forgeEvaluators: forgeTally,
  handoffEvaluators: handoffTally,
  agents: Object.fromEntries(
    [...agents].sort((a, b) => b[1].turns - a[1].turns).map(([id, a]) => [id, { turns: a.turns, orchestrator: a.orchestrator, score: pct(a.pass, a.applicable), fails: a.fails }]),
  ),
  orchestrators: Object.fromEntries([...orchPlans].map(([id, o]) => [id, { plans: o.plans, score: pct(o.pass, o.applicable), fails: o.fails }])),
  forged: forgeRows,
};

const outDir = join(ROOT, "data/harness-eval");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `eval-${report.ts.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2));
const counts = (t) => Object.fromEntries(Object.entries(t).map(([n, v]) => [n, { pass: v.pass, fail: v.fail, na: v.na }]));
appendFileSync(
  join(outDir, "results.jsonl"),
  JSON.stringify({
    ts: report.ts,
    days: DAYS,
    turns: report.turns,
    plans: report.plans,
    forges: report.forges,
    required: report.required,
    aspirational: report.aspirational,
    evaluators: { ...counts(turnTally), ...counts(planTally), ...counts(forgeTally), ...counts(handoffTally) },
    agents: Object.fromEntries(Object.entries(report.agents).map(([id, a]) => [id, { turns: a.turns, score: a.score }])),
  }) + "\n",
);

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const line = (name, v) => {
    const n = v.pass + v.fail;
    return `  [${levelOf(name)}] ${name.padEnd(20)} ${String(pct(v.pass, n) ?? "-").padStart(4)}%  pass ${v.pass}  fail ${v.fail}  n/a ${v.na}${v.examples[0] ? `\n      e.g. ${v.examples.join("\n           ")}` : ""}`;
  };
  const block = (title, t) => {
    console.log(`\n${title}`);
    for (const [n, v] of Object.entries(t)) console.log(line(n, v));
  };
  console.log(`Agora harness eval — last ${DAYS} days: ${turns.length} agent turns, ${plans.length} plans, ${forgeRows.length} forged agents${ROOM ? ` — room ${ROOM}` : ""}`);
  console.log(`Required criteria (the contract): ${report.required}% pass   Aspirational (room to grow): ${report.aspirational}% pass`);
  console.log("[R] = required, a fail is a defect.  [A] = aspirational, a fail is room to improve.");
  block("Turn evaluators", turnTally);
  block("Plan evaluators", planTally);
  block("Forge evaluators", forgeTally);
  block("Handoff evaluators", handoffTally);
  console.log("\nPer agent (score = passes / applicable turn checks)");
  for (const [id, a] of Object.entries(report.agents)) {
    const top = Object.entries(a.fails).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`  ${(id + (a.orchestrator ? " *" : "")).padEnd(22)} ${String(a.turns).padStart(4)} turns  ${String(a.score ?? "-").padStart(4)}%  ${top}`);
  }
  console.log("\nPer orchestrator, plans");
  for (const [id, o] of Object.entries(report.orchestrators)) {
    const top = Object.entries(o.fails).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`  ${id.padEnd(22)} ${String(o.plans).padStart(4)} plans  ${String(o.score ?? "-").padStart(4)}%  ${top}`);
  }
  console.log("\nForged agents");
  for (const r of forgeRows) console.log(`  ${r.id.padEnd(22)} ${r.room.padEnd(20)} by ${r.by.padEnd(10)} ${r.template.padEnd(10)} ${r.fails.length ? "fails: " + r.fails.join(", ") : "ok"}`);
  console.log("\n* = orchestrator of the room it spoke in. Full report in data/harness-eval/.");
}
