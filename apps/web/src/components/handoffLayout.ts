import type { Agent, AgentStatus, Goal, Step, StepStatus } from "../lib/types.ts";

/* Layout for the handoff graph (HandoffGraph.tsx). It is pure, so it can be
   checked without a browser. The rules, so the graph reads left to right:

   - The PM (the room's orchestrator) always stands alone in the first column,
     at the start of every chain.
   - Everyone else sits one column past whoever hands to them, and GOAL comes
     after the last column. Agents with no part in the goal wait on a bench
     under the graph instead of crowding it.
   - Each agent sits level with the agents that hand to it, a full node height
     from its neighbours.
   - A handoff back to the PM, or to anyone earlier, is a loop over the top of
     the graph that ends on that agent's name tag. Each loop has its own track.
   - A handoff that would cut through an agent runs along a lane under the
     graph instead. Every line ends in an arrow.
   - A line's label sits on the line, moved until it touches nothing. With no
     room it is left off; the line's tooltip and the panel under the graph
     still carry it. */

export type GraphStatus = "done" | "active" | "pending" | "blocked";

export const LABEL: Record<GraphStatus, string> = {
  done: "handed off",
  active: "in progress",
  pending: "waiting",
  blocked: "blocked",
};

export interface Pt {
  x: number;
  y: number;
}

export interface GraphAgent {
  id: string;
  name: string;
  role: string;
  status: GraphStatus;
  progress: number;
  task: string;
  color: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  what: string;
  status: GraphStatus;
}

export interface PlacedEdge extends GraphEdge {
  kind: "direct" | "lane" | "loop";
  /** The SVG path. */
  d: string;
  /** Points along the line, for checking what it runs through. */
  pts: Pt[];
  /** The short label, or null when there was no room for one. */
  label: string | null;
  lx: number;
  ly: number;
}

export interface HandoffLayout {
  nodes: GraphAgent[];
  /** Agents in the room with no part in this goal. */
  idle: { id: string; name: string; role: string }[];
  edges: PlacedEdge[];
  goal: Pt;
  width: number;
  height: number;
  floorY: number;
  goalTitle: string;
}

export interface Box {
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const GOAL_ID = "goal";
const LEFT = 110; // x of the PM's column
const COL_GAP = 240; // a long role line plus a free band where lines turn
const BAND = 100; // half the widest node: past this, the space between columns is free
const ROW_GAP = 130; // a node is about 98px tall: tag, figure, bar, role line
const NODE_TOP = 84; // y of the highest node when nothing loops over the top
const TRACK = 14; // gap between lines that share a lane
const MIN_W = 960;
const MIN_H = 400;
const OUT = 36; // a line leaves this far right of a node's centre
const IN = 30; // and its arrow stops this far left of the next node's centre
const LABEL_CHARS = 21;
const CHAR_W = 6.2; // one monospace character at 10px

function graphStatus(s: StepStatus): GraphStatus {
  if (s === "done") return "done";
  if (s === "blocked") return "blocked";
  if (s === "active") return "active";
  return "pending";
}

function worse(a: GraphStatus, b: GraphStatus): GraphStatus {
  const rank: Record<GraphStatus, number> = { done: 0, pending: 1, active: 2, blocked: 3 };
  return rank[a] >= rank[b] ? a : b;
}

function ownedTask(steps: Step[]): string {
  const live = steps.find((s) => s.status === "blocked" || s.status === "active");
  return (live ?? steps[steps.length - 1])?.title ?? "Waiting on a step";
}

const avg = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A line's label: the step without its "EXECUTE — " kind, and "+2" for merged steps. */
export function edgeLabel(what: string): string {
  const parts = what.split("; ");
  const head = parts[0] ?? what;
  const first = head.replace(/^[A-Z][A-Z_ ]{2,}\s+[—–-]\s+/, "").trim() || head;
  const more = parts.length > 1 ? ` +${parts.length - 1}` : "";
  const room = LABEL_CHARS - more.length;
  return (first.length > room ? `${first.slice(0, room - 1).trimEnd()}…` : first) + more;
}

/** The line under a node: its role, cut to fit a column, and its progress. */
export function roleLine(role: string, progress: number): string {
  const r = role.length > 22 ? `${role.slice(0, 21).trimEnd()}…` : role;
  return `${r} · ${Math.round(progress * 100)}%`;
}

export function tagWidth(name: string): number {
  return Math.max(70, name.length * 8 + 22);
}

/** The parts of a node a label must not cover: name tag, figure and bar, role line. */
export function nodeParts(n: GraphAgent): Box[] {
  const tag = tagWidth(n.name);
  const role = roleLine(n.role, n.progress).length * CHAR_W;
  return [
    { id: n.id, x: n.x - tag / 2 - 2, y: n.y - 52, w: tag + 10, h: 32 },
    { id: n.id, x: n.x - 32, y: n.y - 16, w: 64, h: 46 },
    { id: n.id, x: n.x - role / 2 - 4, y: n.y + 29, w: role + 8, h: 16 },
  ];
}

/** All the space a node takes, which a line must not cross. */
export function nodeBox(n: GraphAgent): Box {
  const w = Math.max(tagWidth(n.name), roleLine(n.role, n.progress).length * CHAR_W) + 8;
  return { id: n.id, x: n.x - w / 2, y: n.y - 52, w, h: 98 };
}

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push({ x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x, y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y });
  }
  return out;
}

function segment(a: Pt, b: Pt, n = 12): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

/** Whether a line's points come within pad of a box. */
export const touches = (pts: Pt[], box: Box, pad = 4) =>
  pts.some((p) => p.x > box.x - pad && p.x < box.x + box.w + pad && p.y > box.y - pad && p.y < box.y + box.h + pad);

interface Route {
  d: string;
  pts: Pt[];
  mx: number;
  my: number;
}

/** An S-curve from a line's start to its end. */
function direct(s: Pt, e: Pt): Route {
  const xm = (s.x + e.x) / 2;
  return {
    d: `M${s.x},${s.y} C${xm},${s.y} ${xm},${e.y} ${e.x},${e.y}`,
    pts: bezier(s, { x: xm, y: s.y }, { x: xm, y: e.y }, e),
    mx: xm,
    my: (s.y + e.y) / 2,
  };
}

/** Down to a lane under the graph in the gap at gx1, along it, and up in the gap at gx2. */
function viaLane(s: Pt, e: Pt, lane: number, gx1: number, gx2: number): Route {
  const a = { x: gx1 + 30, y: lane };
  const b = { x: gx2 - 30, y: lane };
  return {
    d: `M${s.x},${s.y} C${gx1},${s.y} ${gx1},${lane} ${a.x},${lane} L${b.x},${lane} C${gx2},${lane} ${gx2},${e.y} ${e.x},${e.y}`,
    pts: [...bezier(s, { x: gx1, y: s.y }, { x: gx1, y: lane }, a), ...segment(a, b), ...bezier(b, { x: gx2, y: lane }, { x: gx2, y: e.y }, e)],
    mx: (gx1 + gx2) / 2,
    my: lane,
  };
}

/**
 * Right from the sender, up the free band at rx to a lane over the graph, and
 * across. Then down onto b's name tag when nobody stands above b; otherwise
 * down the free band at land.x and in from the left, like any other line.
 */
function loopOver(s: Pt, b: Pt, lane: number, rx: number, land: { top: boolean; x: number }, inset: number): Route {
  const r = 8;
  const dir = land.x < rx ? -1 : 1;
  const d =
    `M${s.x},${s.y} L${rx - r},${s.y} Q${rx},${s.y} ${rx},${s.y - r} L${rx},${lane + r}` +
    ` Q${rx},${lane} ${rx + dir * r},${lane} L${land.x - dir * r},${lane} Q${land.x},${lane} ${land.x},${lane + r}`;
  const pts = [
    ...segment(s, { x: rx, y: s.y }),
    ...segment({ x: rx, y: s.y }, { x: rx, y: lane }),
    ...segment({ x: rx, y: lane }, { x: land.x, y: lane }),
  ];
  if (land.top) {
    const ey = b.y - 54;
    return { d: `${d} L${land.x},${ey}`, pts: [...pts, ...segment({ x: land.x, y: lane }, { x: land.x, y: ey })], mx: (rx + land.x) / 2, my: lane };
  }
  const ex = b.x - inset;
  return {
    d: `${d} L${land.x},${b.y - r} Q${land.x},${b.y} ${land.x + r},${b.y} L${ex},${b.y}`,
    pts: [...pts, ...segment({ x: land.x, y: lane }, { x: land.x, y: b.y }), ...segment({ x: land.x, y: b.y }, { x: ex, y: b.y })],
    mx: (rx + land.x) / 2,
    my: lane,
  };
}

export function buildHandoffLayout(opts: {
  goal: Goal | null;
  members: string[];
  orchestratorId: string | null;
  agents: Map<string, Agent>;
  statuses: Record<string, AgentStatus>;
}): HandoffLayout {
  const { goal, members, orchestratorId: pm, agents, statuses } = opts;
  const steps = goal?.steps ?? [];
  const byIdx = new Map(steps.map((s) => [s.idx, s]));
  const roster = [...new Set([pm, ...members].filter((id): id is string => typeof id === "string"))];
  const inRoom = new Set(roster);

  // --- who hands what to whom ---
  const edges: GraphEdge[] = [];
  const addEdge = (from: string, to: string, what: string, status: GraphStatus) => {
    if (from === to) return;
    const hit = edges.find((e) => e.from === from && e.to === to);
    if (hit) {
      hit.status = worse(hit.status, status);
      if (!hit.what.includes(what)) hit.what = `${hit.what}; ${what}`;
      return;
    }
    edges.push({ from, to, what, status });
  };
  for (const step of steps) {
    const owner = step.ownerId;
    if (!owner || !inRoom.has(owner)) continue;
    const deps = step.dependsOn ?? [];
    if (deps.length === 0) {
      if (pm && owner !== pm) addEdge(pm, owner, step.title, graphStatus(step.status));
      continue;
    }
    for (const i of deps) {
      const src = byIdx.get(i);
      if (!src?.ownerId || !inRoom.has(src.ownerId)) continue;
      let st: GraphStatus = "pending";
      if (step.status === "blocked") st = "blocked";
      else if (src.status === "done") st = "done";
      else if (src.status === "active") st = "active";
      addEdge(src.ownerId, owner, src.title, st);
    }
  }
  const depended = new Set(steps.flatMap((s) => s.dependsOn ?? []));
  for (const step of steps) {
    if (step.ownerId && inRoom.has(step.ownerId) && !depended.has(step.idx)) {
      addEdge(step.ownerId, GOAL_ID, step.title, graphStatus(step.status));
    }
  }

  // --- on the graph: the PM, and everyone with a part in the goal ---
  const onGraph = roster.filter(
    (id) => id === pm || steps.some((s) => s.ownerId === id) || edges.some((e) => e.from === id || e.to === id),
  );
  const idleIds = roster.filter((id) => !onGraph.includes(id));

  // --- columns: the PM first, then everyone in the order they joined the goal,
  // one column past whoever hands to them. Only a handoff to someone who joined
  // later moves anyone right. A handoff back to the PM, or to anyone who joined
  // earlier, is a loop; before, a back-and-forth between two agents pushed them
  // both into one column. ---
  const joined = new Map<string, number>();
  for (const s of [...steps].sort((p, q) => p.idx - q.idx)) {
    if (s.ownerId && !joined.has(s.ownerId)) joined.set(s.ownerId, s.idx);
  }
  if (pm) joined.set(pm, -Infinity);
  const joinOf = (id: string) => joined.get(id) ?? Infinity;
  const layerOf = new Map<string, number>(onGraph.map((id) => [id, id === pm ? 0 : pm ? 1 : 0]));
  for (const id of [...onGraph].sort((p, q) => joinOf(p) - joinOf(q) || 0)) {
    for (const e of edges) {
      if (e.to !== id || id === pm || joinOf(e.from) >= joinOf(id)) continue;
      layerOf.set(id, Math.max(layerOf.get(id) ?? 0, (layerOf.get(e.from) ?? 0) + 1));
    }
  }
  const byLayer: string[][] = [];
  for (const id of onGraph) (byLayer[layerOf.get(id) ?? 0] ??= []).push(id);
  const cols = byLayer.filter((col) => col && col.length > 0);
  const colOf = new Map<string, number>();
  cols.forEach((col, ci) => col.forEach((id) => colOf.set(id, ci)));
  const goalCol = cols.length;
  const colOfAny = (id: string) => (id === GOAL_ID ? goalCol : colOf.get(id) ?? 0);
  const live = edges.filter((e) => colOf.has(e.from) && (e.to === GOAL_ID || colOf.has(e.to)));
  const isLoop = (e: GraphEdge) => e.to !== GOAL_ID && colOfAny(e.to) <= colOfAny(e.from);

  // --- rows ---
  const loops = live.filter(isLoop);
  const tallest = Math.max(1, ...cols.map((col) => col.length));
  const overTop = loops.length ? loops.length * TRACK + 18 : 0;
  const content = NODE_TOP + overTop + (tallest - 1) * ROW_GAP + 110;
  const top = NODE_TOP + overTop + Math.max(0, (MIN_H - content) / 2);
  const lowest = top + (tallest - 1) * ROW_GAP;
  const mid = (top + lowest) / 2;

  const fedBy = (id: string) => live.filter((e) => e.to === id && !isLoop(e)).map((e) => e.from);
  const yOf = new Map<string, number>();
  for (const col of cols) {
    const order = col
      .map((id, i) => {
        const ys = fedBy(id).map((p) => yOf.get(p)).filter((y): y is number => y !== undefined);
        return { id, i, want: ys.length ? avg(ys) : mid, anchored: ys.length > 0 };
      })
      .sort((p, q) => p.want - q.want || p.i - q.i);
    let ys: number[] = [];
    if (!order.some((o) => o.anchored)) {
      ys = order.map((_, i) => mid + (i - (order.length - 1) / 2) * ROW_GAP);
    } else {
      order.forEach((o, i) => ys.push(i === 0 ? o.want : Math.max(o.want, (ys[i - 1] ?? o.want) + ROW_GAP)));
      const over = (ys[ys.length - 1] ?? lowest) - lowest;
      if (over > 0) ys = ys.map((y) => y - over);
      const under = top - (ys[0] ?? top);
      if (under > 0) ys = ys.map((y) => y + under);
    }
    order.forEach((o, i) => yOf.set(o.id, ys[i] ?? mid));
  }

  // --- nodes; the PM's progress is the goal's ---
  const finished = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const overall = steps.length ? finished / steps.length : 0;
  const left = LEFT + Math.max(0, (MIN_W - (LEFT + goalCol * COL_GAP + 130)) / 2);
  const nodes: GraphAgent[] = [];
  cols.forEach((col, ci) => {
    for (const id of col) {
      const agent = agents.get(id);
      const mine = steps.filter((s) => s.ownerId === id);
      const done = mine.filter((s) => s.status === "done").length;
      let status: GraphStatus = "pending";
      if (mine.some((s) => s.status === "blocked")) status = "blocked";
      else if (statuses[id] === "processing" || mine.some((s) => s.status === "active")) status = "active";
      else if (mine.length > 0 && mine.every((s) => s.status === "done" || s.status === "skipped")) status = "done";
      if (id === pm && mine.length === 0 && steps.length > 0) {
        status = overall >= 1 ? "done" : steps.some((s) => s.status === "blocked") ? "blocked" : "active";
      }
      nodes.push({
        id,
        name: (agent?.name ?? id).toUpperCase(),
        role: agent?.role ?? "Agent",
        status,
        progress: id === pm ? overall : mine.length === 0 ? 0 : done / mine.length,
        task: mine.length ? ownedTask(mine) : id === pm ? "Starts the goal and hands out the steps" : "On the roster — no step yet",
        color: agent?.color ?? "#9aa3b8",
        x: left + ci * COL_GAP,
        y: yOf.get(id) ?? mid,
      });
    }
  });
  const idle = idleIds.map((id) => ({
    id,
    name: (agents.get(id)?.name ?? id).toUpperCase(),
    role: agents.get(id)?.role ?? "Agent",
  }));

  const intoGoal = live
    .filter((e) => e.to === GOAL_ID)
    .map((e) => yOf.get(e.from))
    .filter((y): y is number => y !== undefined);
  const goalPos = { x: left + goalCol * COL_GAP + 30, y: clamp(intoGoal.length ? avg(intoGoal) : mid, top, lowest) };
  const goalBox: Box = { id: GOAL_ID, x: goalPos.x - 62, y: goalPos.y - 40, w: 124, h: 80 };
  const posOf = (id: string): Pt => (id === GOAL_ID ? goalPos : nodes.find((n) => n.id === id) ?? goalPos);
  const obstacles = [...nodes.map(nodeBox), goalBox];
  const colX = (ci: number) => left + ci * COL_GAP;
  const start = (id: string): Pt => ({ x: posOf(id).x + OUT, y: posOf(id).y });
  const end = (id: string): Pt => ({ x: posOf(id).x - (id === GOAL_ID ? 66 : IN), y: posOf(id).y });
  const spanOf = (e: GraphEdge) => Math.abs(posOf(e.to).x - posOf(e.from).x);

  // --- lines ---
  type Draft = { e: GraphEdge; kind: PlacedEdge["kind"]; route: Route };
  const drafts: Draft[] = [];
  const under: GraphEdge[] = [];
  for (const e of live) {
    if (isLoop(e)) continue;
    const route = direct(start(e.from), end(e.to));
    const clear = !obstacles.some((box) => box.id !== e.from && box.id !== e.to && touches(route.pts, box));
    if (clear) drafts.push({ e, kind: "direct", route });
    else under.push(e);
  }
  // lanes under the graph, the widest lowest so they nest without crossing
  const laneBase = lowest + 64;
  [...under]
    .sort((p, q) => spanOf(q) - spanOf(p))
    .forEach((e, k, all) => {
      const lane = laneBase + (all.length - 1 - k) * TRACK;
      const route = viaLane(start(e.from), end(e.to), lane, colX(colOfAny(e.from)) + BAND + 32, colX(colOfAny(e.to)) - BAND - 4);
      drafts.push({ e, kind: "lane", route });
    });
  // loops over the top, the widest highest. Each rises in the free band right
  // of its sender's column and lands on the receiver's name tag, or, when
  // someone stands above the receiver, comes in from the band left of its column.
  const rises = new Map<number, number>();
  const tops = new Map<string, number>();
  const sides = new Map<number, number>();
  const standsAbove = (id: string) => {
    const b = posOf(id);
    return nodes.some((m) => m.id !== id && Math.abs(m.x - b.x) < 1 && m.y < b.y);
  };
  [...loops]
    .sort((p, q) => spanOf(q) - spanOf(p))
    .forEach((e, k) => {
      const lane = 22 + k * TRACK;
      const ca = colOfAny(e.from);
      const cb = colOfAny(e.to);
      const rise = rises.get(ca) ?? 0;
      rises.set(ca, rise + 1);
      const b = posOf(e.to);
      let land: { top: boolean; x: number };
      if (!standsAbove(e.to)) {
        const slot = tops.get(e.to) ?? 0;
        tops.set(e.to, slot + 1);
        land = { top: true, x: b.x - 24 + 12 * (slot % 5) };
      } else {
        const slot = sides.get(cb) ?? 0;
        sides.set(cb, slot + 1);
        land = { top: false, x: Math.max(6, colX(cb) - BAND - 36 + 5 * (slot % 4)) };
      }
      const rx = colX(ca) + BAND + 4 + 5 * (rise % 4);
      drafts.push({ e, kind: "loop", route: loopOver(start(e.from), b, lane, rx, land, IN) });
    });

  const height = Math.max(MIN_H, (under.length ? laneBase + under.length * TRACK : lowest + 50) + 56);
  const floorY = height - 40;
  const width = Math.max(MIN_W, goalPos.x + 100);

  // --- labels: short direct lines first, then lanes and loops ---
  const taken: Box[] = [...nodes.flatMap(nodeParts), goalBox];
  const rank = { direct: 0, lane: 1, loop: 2 };
  const placed = new Map<Draft, { label: string | null; lx: number; ly: number }>();
  for (const dr of [...drafts].sort((p, q) => rank[p.kind] - rank[q.kind] || spanOf(p.e) - spanOf(q.e))) {
    const text = edgeLabel(dr.e.what);
    const w = text.length * CHAR_W + 8;
    const tries: Array<[number, number]> =
      dr.kind === "direct"
        ? [[0, 0], [0, -16], [0, 16], [0, -32], [0, 32], [0, -48], [0, 48]]
        : [[0, 0], [-70, 0], [70, 0], [-140, 0], [140, 0]];
    const baseY = dr.kind === "direct" ? dr.route.my - 6 : dr.route.my - 4;
    let spot: { lx: number; ly: number } | null = null;
    for (const [dx, dy] of tries) {
      const lx = dr.route.mx + dx;
      const ly = baseY + dy;
      const box = { x: lx - w / 2, y: ly - 11, w, h: 14 };
      if (box.x < 2 || box.x + w > width - 2 || box.y < 2 || box.y + box.h > floorY - 2) continue;
      if (taken.some((t) => overlaps(t, box))) continue;
      taken.push(box);
      spot = { lx, ly };
      break;
    }
    placed.set(dr, { label: spot ? text : null, lx: spot?.lx ?? dr.route.mx, ly: spot?.ly ?? baseY });
  }

  return {
    nodes,
    idle,
    edges: drafts.map((dr) => ({ ...dr.e, kind: dr.kind, d: dr.route.d, pts: dr.route.pts, ...placed.get(dr)! })),
    goal: goalPos,
    width,
    height,
    floorY,
    goalTitle: goal?.title ?? "No goal yet",
  };
}
