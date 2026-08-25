import { useState } from "react";
import type { Agent, Goal, Step, StepStatus } from "../lib/types.ts";
import { Avatar } from "./bits.tsx";

const STEP_LABEL: Record<StepStatus, string> = {
  pending: "Not started",
  active: "In progress",
  done: "Done",
  blocked: "Blocked",
  skipped: "Never reached",
};

/* Serpentine layout: steps run left-to-right, then wrap and run back, so a
   plan reads as one continuous path rather than a stack of rows. */
const PER_ROW = 3;
const CELL_W = 236;
const CELL_H = 172;
const NODE = 62;

function nodeCentre(i: number): { x: number; y: number; row: number; col: number } {
  const row = Math.floor(i / PER_ROW);
  const raw = i % PER_ROW;
  const col = row % 2 === 0 ? raw : PER_ROW - 1 - raw;
  return { x: col * CELL_W + CELL_W / 2, y: row * CELL_H + NODE / 2 + 6, row, col };
}

function glyph(status: StepStatus): string {
  if (status === "done") return "✓";
  if (status === "blocked") return "!";
  if (status === "active") return "◆";
  return "";
}

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function StepGraph({ steps, agents }: { steps: Step[]; agents: Map<string, Agent> }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const rows = Math.ceil(steps.length / PER_ROW);
  const width = PER_ROW * CELL_W;
  const height = rows * CELL_H;
  const points = steps.map((_, i) => nodeCentre(i));

  return (
    <div className="graph__scroll">
      <div className="graph" style={{ width, height }}>
        <svg className="graph__wires" width={width} height={height} aria-hidden="true">
          {points.slice(0, -1).map((p, i) => {
            const q = points[i + 1]!;
            const reached =
              steps[i + 1]!.status !== "pending" && steps[i + 1]!.status !== "skipped";
            // Same row: straight across. Different row: drop down and over.
            const d =
              p.row === q.row
                ? `M ${p.x} ${p.y} L ${q.x} ${q.y}`
                : `M ${p.x} ${p.y} L ${p.x} ${p.y + CELL_H / 2} L ${q.x} ${p.y + CELL_H / 2} L ${q.x} ${q.y}`;
            return (
              <path
                key={i}
                d={d}
                className={`wire${reached ? " wire--travelled" : ""}`}
                fill="none"
              />
            );
          })}
        </svg>

        {steps.map((step, i) => {
          const p = points[i]!;
          const owner = step.ownerId ? agents.get(step.ownerId) : undefined;
          const open = openIdx === i;
          return (
            <div key={step.id}>
              <button
                className={`gnode gnode--${step.status}`}
                style={{ left: p.x - NODE / 2, top: p.y - NODE / 2, width: NODE, height: NODE }}
                onClick={() => setOpenIdx(open ? null : i)}
                aria-expanded={open}
                title={`${step.title} — ${STEP_LABEL[step.status]}`}
              >
                <span className="gnode__glyph" aria-hidden="true">
                  {glyph(step.status)}
                </span>
                <span className="gnode__num">{String(i + 1).padStart(2, "0")}</span>
              </button>

              <div
                className="gcard"
                style={{
                  left: p.col * CELL_W + 10,
                  top: p.y + NODE / 2 + 10,
                  width: CELL_W - 20,
                }}
              >
                <div className={`gcard__title gcard__title--${step.status}`}>
                  {step.title}
                </div>
                <div className="gcard__meta">
                  {owner && (
                    <span className="gcard__owner">
                      <Avatar agent={owner} size={16} />
                      {owner.name}
                    </span>
                  )}
                  <span className={`gcard__status gcard__status--${step.status}`}>
                    {STEP_LABEL[step.status]}
                  </span>
                </div>
                {step.note && (
                  <div className={`gcard__note${open ? "" : " gcard__note--clamp"}`}>
                    {step.note}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Handoff({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="handoff">
      <div className="handoff__head">
        <span className="handoff__label">Your prompt — paste into Claude CLI</span>
        <button
          className="handoff__copy"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              },
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="handoff__body">{text}</pre>
    </div>
  );
}

function GoalCard({
  goal,
  agents,
  live,
}: {
  goal: Goal;
  agents: Map<string, Agent>;
  live: boolean;
}) {
  const total = goal.steps.length;
  const done = goal.steps.filter((s) => s.status === "done").length;
  const blocked = goal.steps.filter((s) => s.status === "blocked").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <article className={`goal${live ? " goal--live" : ""}`}>
      <header className="goal__head">
        <div style={{ minWidth: 0 }}>
          <h2 className="goal__title">{goal.title}</h2>
          <p className="goal__meta">
            <span className={`goal__badge goal__badge--${goal.status}`}>
              {goal.status === "active"
                ? "Running"
                : goal.status === "done"
                  ? "Completed"
                  : "Ended incomplete"}
            </span>
            <span>
              {done} of {total} done
            </span>
            {blocked > 0 && <span className="goal__blocked">{blocked} blocked</span>}
            <span>{when(goal.createdAt)}</span>
            {goal.costUsd > 0 && <span>${goal.costUsd.toFixed(4)}</span>}
          </p>
        </div>
        <div className="goal__pct">{pct}%</div>
      </header>

      <StepGraph steps={goal.steps} agents={agents} />

      {goal.verify && (
        <div className="verify">
          <div className="verify__label">See it yourself first</div>
          <pre className="verify__body">{goal.verify}</pre>
        </div>
      )}

      {goal.handoff && <Handoff text={goal.handoff} />}
    </article>
  );
}

export function Workflow({
  goals,
  agents,
  activeGoalId,
  roomName,
}: {
  goals: Goal[];
  agents: Map<string, Agent>;
  activeGoalId: string | null;
  roomName: string;
}) {
  if (goals.length === 0) {
    return (
      <div className="workflow">
        <div className="empty">
          <h2 className="empty__title">No goals yet</h2>
          <p className="empty__body">
            Set a goal in the {roomName} chatroom. Scofield breaks it into steps
            before any work starts, they light up here as the room makes progress,
            and the run ends with the prompt for you to run.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="workflow">
      {goals.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          agents={agents}
          live={goal.id === activeGoalId}
        />
      ))}
    </div>
  );
}
