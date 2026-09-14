import { useMemo, useState } from "react";
import type { Agent, AgentStatus, Goal, Step, StepStatus } from "../lib/types.ts";

type GraphStatus = "done" | "active" | "pending" | "blocked";

const LABEL: Record<GraphStatus, string> = {
  done: "handed off",
  active: "in progress",
  pending: "waiting",
  blocked: "blocked",
};

interface GraphAgent {
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

interface GraphEdge {
  from: string;
  to: string;
  what: string;
  status: GraphStatus;
}

const GOAL_ID = "goal";
const VIEW_W = 960;
const VIEW_H = 420;
const GOAL_X = 820;
const GOAL_Y = 210;

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

/** 5×7 pixel figure matching the handoff-graph mock. */
function Sprite({ x, y, color }: { x: number; y: number; color: string }) {
  const px = 4;
  const shape = ["01110", "01110", "00100", "11111", "10101", "01010", "01010"];
  return (
    <g>
      {shape.flatMap((row, r) =>
        [...row].flatMap((c, i) =>
          c === "1"
            ? [
                <rect
                  key={`${r}-${i}`}
                  x={x - 10 + i * px}
                  y={y + r * px}
                  width={px}
                  height={px}
                  fill={r < 2 ? color : r === 2 ? "#f1d9c2" : "var(--ink)"}
                />,
              ]
            : [],
        ),
      )}
    </g>
  );
}

function buildGraph(opts: {
  goal: Goal | null;
  members: string[];
  orchestratorId: string | null;
  agents: Map<string, Agent>;
  statuses: Record<string, AgentStatus>;
}): { nodes: GraphAgent[]; edges: GraphEdge[]; goalTitle: string } {
  const { goal, members, orchestratorId, agents, statuses } = opts;
  const steps = goal?.steps ?? [];
  const byIdx = new Map(steps.map((s) => [s.idx, s]));

  const ownerIds = [
    ...new Set(
      [
        orchestratorId,
        ...members,
        ...steps.map((s) => s.ownerId),
      ].filter((id): id is string => Boolean(id) && (members.includes(id) || id === orchestratorId)),
    ),
  ];

  const layerOf = new Map<string, number>();
  for (const id of ownerIds) layerOf.set(id, 0);
  for (const step of steps) {
    if (!step.ownerId) continue;
    const deps = (step.dependsOn ?? [])
      .map((i) => byIdx.get(i)?.ownerId)
      .filter((id): id is string => Boolean(id) && id !== step.ownerId);
    const layer = deps.length ? Math.max(0, ...deps.map((id) => (layerOf.get(id) ?? 0) + 1)) : 0;
    layerOf.set(step.ownerId, Math.max(layerOf.get(step.ownerId) ?? 0, layer));
  }

  const columns: string[][] = [];
  for (const id of ownerIds) {
    const col = layerOf.get(id) ?? 0;
    if (!columns[col]) columns[col] = [];
    if (!columns[col].includes(id)) columns[col].push(id);
  }
  const colCount = Math.max(columns.length, 1);

  const nodes: GraphAgent[] = [];
  columns.forEach((col, ci) => {
    const x = colCount === 1 ? 330 : 110 + (ci / Math.max(colCount - 1, 1)) * 450;
    col.forEach((id, ri) => {
      const agent = agents.get(id);
      const mine = steps.filter((s) => s.ownerId === id);
      const done = mine.filter((s) => s.status === "done").length;
      let status: GraphStatus = "pending";
      if (mine.some((s) => s.status === "blocked")) status = "blocked";
      else if (statuses[id] === "processing" || mine.some((s) => s.status === "active")) status = "active";
      else if (mine.length > 0 && mine.every((s) => s.status === "done" || s.status === "skipped")) status = "done";
      const n = col.length;
      const y = n === 1 ? 210 : 90 + (ri / Math.max(n - 1, 1)) * 220;
      nodes.push({
        id,
        name: (agent?.name ?? id).toUpperCase(),
        role: agent?.role ?? "Agent",
        status,
        progress: mine.length === 0 ? 0 : done / mine.length,
        task: mine.length ? ownedTask(mine) : "On the roster — no step yet",
        color: agent?.color ?? "#9aa3b8",
        x,
        y,
      });
    });
  });

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
    if (!step.ownerId) continue;
    const deps = step.dependsOn ?? [];
    if (deps.length === 0) {
      if (orchestratorId && step.ownerId !== orchestratorId) {
        addEdge(orchestratorId, step.ownerId, step.title, graphStatus(step.status));
      }
      continue;
    }
    for (const i of deps) {
      const src = byIdx.get(i);
      if (!src?.ownerId) continue;
      let st: GraphStatus = "pending";
      if (step.status === "blocked") st = "blocked";
      else if (src.status === "done") st = "done";
      else if (src.status === "active") st = "active";
      addEdge(src.ownerId, step.ownerId, src.title, st);
    }
  }

  const depended = new Set(steps.flatMap((s) => s.dependsOn ?? []));
  for (const step of steps) {
    if (!step.ownerId) continue;
    if (depended.has(step.idx)) continue;
    addEdge(step.ownerId, GOAL_ID, step.title, graphStatus(step.status));
  }

  return { nodes, edges, goalTitle: goal?.title ?? "No goal yet" };
}

export function HandoffGraph({
  goal,
  members,
  orchestratorId,
  agents,
  statuses,
}: {
  goal: Goal | null;
  members: string[];
  orchestratorId: string | null;
  agents: Map<string, Agent>;
  statuses: Record<string, AgentStatus>;
}) {
  const { nodes, edges, goalTitle } = useMemo(
    () => buildGraph({ goal, members, orchestratorId, agents, statuses }),
    [goal, members, orchestratorId, agents, statuses],
  );
  const byId = useMemo(() => {
    const m: Record<string, GraphAgent | { id: string; name: string; x: number; y: number }> = {
      [GOAL_ID]: { id: GOAL_ID, name: "GOAL", x: GOAL_X, y: GOAL_Y },
    };
    for (const n of nodes) m[n.id] = n;
    return m;
  }, [nodes]);

  const defaultSel =
    nodes.find((a) => a.status === "blocked")?.id ??
    nodes.find((a) => a.status === "active")?.id ??
    nodes[0]?.id ??
    null;
  const [sel, setSel] = useState<string | null>(null);
  const selected = sel && byId[sel] ? sel : defaultSel;

  const doneHandoffs = edges.filter((e) => e.status === "done").length;
  const pct = goal
    ? Math.round(
        (goal.steps.filter((s) => s.status === "done").length / Math.max(goal.steps.length, 1)) * 100,
      )
    : 0;
  const selectedAgent = selected && selected !== GOAL_ID ? (byId[selected] as GraphAgent | undefined) : undefined;
  const ins = edges.filter((h) => h.to === selected);
  const outs = edges.filter((h) => h.from === selected);

  return (
    <div className="hg">
      <div className="hg__goalbar">
        <div className="hg__g">
          <strong>{goalTitle}</strong>
          <small>
            {goal
              ? `${doneHandoffs} of ${edges.length} handoffs complete`
              : "Set a goal in chat — steps light up here as they pass between agents"}
          </small>
        </div>
        <div className="hg__bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="hg__pct">{pct}%</span>
      </div>

      <div className="hg__stage">
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="Agent handoff graph">
          {Array.from({ length: 13 }, (_, i) => (
            <line
              key={`v${i}`}
              x1={i * 80}
              y1={380}
              x2={480 + (i * 80 - 480) * 0.6}
              y2={420}
              stroke="var(--hairline)"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: 3 }, (_, j) => (
            <line
              key={`h${j}`}
              x1={0}
              y1={380 + j * 13}
              x2={VIEW_W}
              y2={380 + j * 13}
              stroke="var(--hairline)"
              strokeWidth={1}
            />
          ))}

          {edges.map((h, i) => {
            const a = byId[h.from];
            const b = byId[h.to];
            if (!a || !b) return null;
            const dx = (b.x - a.x) / 2;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <g key={`${h.from}-${h.to}-${i}`}>
                <path
                  className={`hg__edge hg__edge--${h.status}`}
                  d={`M${a.x + 62},${a.y} C${a.x + 62 + dx},${a.y} ${b.x - 62 - dx},${b.y} ${b.x - 62},${b.y}`}
                />
                <text className="hg__sub" x={mx} y={my - 6} textAnchor="middle">
                  {h.what.length > 28 ? `${h.what.slice(0, 26)}…` : h.what}
                </text>
              </g>
            );
          })}

          {nodes.map((a) => {
            const w = Math.max(70, a.name.length * 8 + 22);
            const on = selected === a.id;
            return (
              <g
                key={a.id}
                className={`hg__node${on ? " hg__node--sel" : ""}`}
                tabIndex={0}
                role="button"
                aria-pressed={on}
                onClick={() => setSel(a.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSel(a.id);
                  }
                }}
              >
                <rect className="hg__tag" x={a.x - w / 2} y={a.y - 46} width={w} height={24} />
                <text className="hg__tagtext" x={a.x} y={a.y - 30} textAnchor="middle">
                  {a.name}
                </text>
                <Sprite x={a.x} y={a.y - 12} color={a.color} />
                <rect x={a.x - 30} y={a.y + 22} width={60} height={5} fill="var(--hairline)" />
                <rect
                  x={a.x - 30}
                  y={a.y + 22}
                  width={60 * a.progress}
                  height={5}
                  fill={`var(--hg-${a.status})`}
                />
                <text className="hg__sub" x={a.x} y={a.y + 40} textAnchor="middle">
                  {a.role} · {Math.round(a.progress * 100)}%
                </text>
                <circle cx={a.x + w / 2} cy={a.y - 46} r={4} fill={`var(--hg-${a.status})`} />
              </g>
            );
          })}

          <g>
            <rect
              x={GOAL_X - 62}
              y={GOAL_Y - 40}
              width={124}
              height={80}
              fill="var(--accent)"
              opacity={0.15}
              stroke="var(--accent)"
              strokeWidth={2}
            />
            <text className="hg__tagtext" x={GOAL_X} y={GOAL_Y - 8} textAnchor="middle">
              GOAL
            </text>
            <text className="hg__sub" x={GOAL_X} y={GOAL_Y + 14} textAnchor="middle">
              {goal ? (goal.status === "active" ? "in play" : goal.status) : "—"}
            </text>
          </g>
        </svg>
      </div>

      <div className="hg__legend">
        <span className="hg__l hg__l--done">handed off</span>
        <span className="hg__l hg__l--active">in progress</span>
        <span className="hg__l hg__l--pending">waiting</span>
        <span className="hg__l hg__l--blocked">blocked</span>
      </div>

      <div className="hg__detail">
        <div>
          <h2>AGENT</h2>
          {selectedAgent ? (
            <>
              <p>
                <strong>{selectedAgent.name}</strong> — {selectedAgent.role}
              </p>
              <p>{selectedAgent.task}</p>
              <p>
                <span className={`hg__pill hg__s--${selectedAgent.status}`}>{LABEL[selectedAgent.status]}</span>{" "}
                {Math.round(selectedAgent.progress * 100)}%
              </p>
            </>
          ) : (
            <p>No agents in this room.</p>
          )}
        </div>
        <div>
          <h2>RECEIVES FROM</h2>
          <ul className="hg__hand">
            {ins.length === 0 ? (
              <li>Starts the chain</li>
            ) : (
              ins.map((h) => (
                <li key={`${h.from}-${h.what}`}>
                  <span className={`hg__s--${h.status}`}>●</span> {byId[h.from]?.name ?? h.from} — {h.what}{" "}
                  <span className="hg__dim">({LABEL[h.status]})</span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div>
          <h2>HANDS OFF TO</h2>
          <ul className="hg__hand">
            {outs.length === 0 ? (
              <li>Nothing yet</li>
            ) : (
              outs.map((h) => (
                <li key={`${h.to}-${h.what}`}>
                  <span className={`hg__s--${h.status}`}>●</span> {byId[h.to]?.name ?? h.to} — {h.what}{" "}
                  <span className="hg__dim">({LABEL[h.status]})</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
