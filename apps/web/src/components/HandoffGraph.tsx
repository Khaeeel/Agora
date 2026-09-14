import { useId, useMemo, useState } from "react";
import type { Agent, AgentStatus, Goal } from "../lib/types.ts";
import { buildHandoffLayout, GOAL_ID, LABEL, roleLine, tagWidth } from "./handoffLayout.ts";

/** 5×7 pixel figure from the handoff-graph mock. */
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
                  fill={r < 2 ? color : r === 2 ? "#f1d9c2" : "var(--hg-ink)"}
                />,
              ]
            : [],
        ),
      )}
    </g>
  );
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
  const layout = useMemo(
    () => buildHandoffLayout({ goal, members, orchestratorId, agents, statuses }),
    [goal, members, orchestratorId, agents, statuses],
  );
  const { nodes, idle, edges, width, height, floorY, goalTitle } = layout;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const nameOf = useMemo(() => {
    const m = new Map<string, string>([[GOAL_ID, "GOAL"]]);
    for (const n of nodes) m.set(n.id, n.name);
    return m;
  }, [nodes]);

  const defaultSel =
    nodes.find((a) => a.status === "blocked")?.id ??
    nodes.find((a) => a.status === "active")?.id ??
    nodes[0]?.id ??
    null;
  const [sel, setSel] = useState<string | null>(null);
  const selected = sel && nameOf.has(sel) ? sel : defaultSel;

  const doneHandoffs = edges.filter((e) => e.status === "done").length;
  const pct = goal
    ? Math.round((goal.steps.filter((s) => s.status === "done").length / Math.max(goal.steps.length, 1)) * 100)
    : 0;
  const selectedAgent = nodes.find((n) => n.id === selected);
  const ins = edges.filter((h) => h.to === selected);
  const outs = edges.filter((h) => h.from === selected);

  return (
    <div className="hg">
      <div className="hg__head">
        <span className="hg__title">HANDOFF GRAPH</span>
        <span className="hg__count">
          {nodes.length + idle.length} {nodes.length + idle.length === 1 ? "AGENT" : "AGENTS"}
        </span>
      </div>

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
        <svg
          viewBox={`0 0 ${width} ${height}`}
          // shrink to 90% before scrolling sideways; smaller than that, text stops being readable
          style={{ minWidth: Math.round(width * 0.9) }}
          role="img"
          aria-label="Agent handoff graph"
        >
          <defs>
            {(["done", "active", "pending", "blocked"] as const).map((s) => (
              <marker
                key={s}
                id={`${uid}-arrow-${s}`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" className={`hg__arrow hg__arrow--${s}`} />
              </marker>
            ))}
          </defs>

          {Array.from({ length: Math.ceil(width / 80) + 1 }, (_, i) => (
            <line
              key={`v${i}`}
              className="hg__floor"
              x1={i * 80}
              y1={floorY}
              x2={width / 2 + (i * 80 - width / 2) * 0.6}
              y2={height}
            />
          ))}
          {Array.from({ length: 3 }, (_, j) => (
            <line key={`h${j}`} className="hg__floor" x1={0} y1={floorY + j * 13} x2={width} y2={floorY + j * 13} />
          ))}

          {edges.map((h, i) => (
            <g key={`${h.from}-${h.to}-${i}`}>
              <path
                className={`hg__edge hg__edge--${h.status} hg__edge--${h.kind}`}
                d={h.d}
                markerEnd={`url(#${uid}-arrow-${h.status})`}
              />
              <path className="hg__hit" d={h.d}>
                <title>{`${nameOf.get(h.from) ?? h.from} → ${nameOf.get(h.to) ?? h.to}: ${h.what} (${LABEL[h.status]})`}</title>
              </path>
              {h.label && (
                <text className="hg__sub hg__elabel" x={h.lx} y={h.ly} textAnchor="middle">
                  {h.label}
                </text>
              )}
            </g>
          ))}

          {nodes.map((a) => {
            const w = tagWidth(a.name);
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
                <title>{`${a.name} — ${a.role}: ${a.task}`}</title>
                <rect className="hg__tag" x={a.x - w / 2} y={a.y - 46} width={w} height={24} />
                <text className="hg__tagtext" x={a.x} y={a.y - 30} textAnchor="middle">
                  {a.name}
                </text>
                <Sprite x={a.x} y={a.y - 12} color={a.color} />
                <rect className="hg__track" x={a.x - 30} y={a.y + 22} width={60} height={5} />
                <rect x={a.x - 30} y={a.y + 22} width={60 * a.progress} height={5} fill={`var(--hg-${a.status})`} />
                <text className="hg__sub" x={a.x} y={a.y + 40} textAnchor="middle">
                  {roleLine(a.role, a.progress)}
                </text>
                <circle cx={a.x + w / 2} cy={a.y - 46} r={4} fill={`var(--hg-${a.status})`} />
              </g>
            );
          })}

          <g>
            <rect className="hg__goal" x={layout.goal.x - 62} y={layout.goal.y - 40} width={124} height={80} />
            <text className="hg__tagtext" x={layout.goal.x} y={layout.goal.y - 8} textAnchor="middle">
              GOAL
            </text>
            <text className="hg__sub" x={layout.goal.x} y={layout.goal.y + 14} textAnchor="middle">
              {goal ? (goal.status === "active" ? "in play" : goal.status) : "—"}
            </text>
          </g>
        </svg>
      </div>

      {idle.length > 0 && (
        <div className="hg__bench">
          <span className="hg__benchlabel">NOT IN THIS GOAL</span>
          {idle.map((a) => (
            <span key={a.id} className="hg__chip" title={a.role}>
              {a.name}
            </span>
          ))}
        </div>
      )}

      <div className="hg__legend">
        <span className="hg__l hg__l--done">handed off</span>
        <span className="hg__l hg__l--active">in progress</span>
        <span className="hg__l hg__l--pending">waiting</span>
        <span className="hg__l hg__l--blocked">blocked</span>
        <span className="hg__l hg__l--loop">loop: handed back</span>
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
                  <span className={`hg__s--${h.status}`}>●</span> {nameOf.get(h.from) ?? h.from} — {h.what}{" "}
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
                  <span className={`hg__s--${h.status}`}>●</span> {nameOf.get(h.to) ?? h.to} — {h.what}{" "}
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
