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

/** Disc glyph: tick when done, bang when blocked, else the step number. */
function glyph(status: StepStatus, index: number): string {
  if (status === "done") return "✓";
  if (status === "blocked") return "!";
  return String(index + 1);
}

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Which node is "You are here" — the live/active step, else the first block,
 * else the next pending after the last done (paused mid-goal).
 */
function currentIndex(steps: Step[]): number {
  const active = steps.findIndex((s) => s.status === "active");
  if (active >= 0) return active;
  const blocked = steps.findIndex((s) => s.status === "blocked");
  if (blocked >= 0) return blocked;
  let lastDone = -1;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]?.status === "done") lastDone = i;
  }
  if (lastDone >= 0 && lastDone < steps.length - 1) return lastDone + 1;
  if (lastDone === steps.length - 1) return lastDone;
  return 0;
}

function phaseClass(step: Step, i: number, cur: number): string {
  if (step.status === "done") return "done";
  if (step.status === "blocked") return "blocked";
  if (step.status === "skipped") return "pending";
  if (i === cur) return "current";
  if (i < cur) return "done";
  return "pending";
}

/**
 * Steps as a phase timeline (design from phase-timeline.html): axis + fill,
 * numbered nodes, "You are here" on the current phase, name / date under each.
 */
function StepGraph({
  steps,
  agents,
  live,
}: {
  steps: Step[];
  agents: Map<string, Agent>;
  live: boolean;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const cur = currentIndex(steps);
  const fillPct =
    steps.length <= 1 ? (steps[0]?.status === "done" ? 100 : 0) : (cur / (steps.length - 1)) * 100;

  return (
    <div className="tlcard">
      <div
        className="tl"
        style={{ gridTemplateColumns: `repeat(${Math.max(steps.length, 1)}, 1fr)` }}
      >
        <div className="tl__axis" aria-hidden="true">
          <div className="tl__fill" style={{ width: `${fillPct}%` }} />
        </div>
        {steps.map((step, i) => {
          const owner = step.ownerId ? agents.get(step.ownerId) : undefined;
          const open = openIdx === i;
          const st = phaseClass(step, i, cur);
          const here = st === "current" || (st === "blocked" && i === cur);
          return (
            <div className={`phase phase--${st}${here && live ? " phase--live" : ""}`} key={step.id}>
              <div className="phase__here">{st === "blocked" ? "Blocked here" : "You are here"}</div>
              <button
                type="button"
                className="phase__node"
                onClick={() => setOpenIdx(open ? null : i)}
                aria-expanded={open}
                title={STEP_LABEL[step.status]}
              >
                {glyph(step.status, i)}
              </button>
              <button
                type="button"
                className="phase__name"
                onClick={() => setOpenIdx(open ? null : i)}
              >
                {step.title}
              </button>
              <div className="phase__date">{when(step.updatedAt)}</div>
              {owner && (
                <div className="phase__owner">
                  <Avatar agent={owner} size={14} />
                  {owner.name}
                </div>
              )}
              <div className="phase__bar" aria-hidden="true">
                <i className={step.status === "done" || (here && step.status === "active") ? "on" : ""} />
              </div>
              <div className="phase__cnt">{STEP_LABEL[step.status]}</div>
              {step.note && open && <div className="phase__note">{step.note}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Goal progress dial — one tick per step, coloured by that step's status.
 */
function GoalDial({
  steps,
  pct,
  live,
}: {
  steps: Step[];
  pct: number;
  live: boolean;
}) {
  const seg = 100 / Math.max(steps.length, 1);
  const dash = seg * (steps.length > 12 ? 0.8 : 0.66);

  return (
    <div className="dial">
      <svg className="dial__svg" viewBox="0 0 64 64" aria-hidden="true">
        <g transform="rotate(-90 32 32)">
          {steps.map((step, i) => (
            <circle
              key={step.id}
              className={`dial__tick dial__tick--${step.status}`}
              cx="32"
              cy="32"
              r="27"
              fill="none"
              pathLength="100"
              strokeDasharray={`${dash} ${100 - dash}`}
              strokeDashoffset={-(i * seg)}
            />
          ))}
        </g>
        {live && (
          <g className="dial__sat">
            <circle cx="32" cy="5" r="1.9" />
          </g>
        )}
      </svg>
      <span className="dial__pct">{pct}%</span>
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
  running,
  busy,
  onStop,
  onResume,
}: {
  goal: Goal;
  agents: Map<string, Agent>;
  live: boolean;
  running: boolean;
  busy: boolean;
  onStop: () => void;
  onResume: (goalId: string) => void;
}) {
  const total = goal.steps.length;
  const done = goal.steps.filter((s) => s.status === "done").length;
  const blocked = goal.steps.filter((s) => s.status === "blocked").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const unfinished = total > 0 && done < total;
  const cur = currentIndex(goal.steps);
  const phaseN = total === 0 ? 0 : cur + 1;

  return (
    <article className={`goal${live ? " goal--live" : ""}`}>
      <header className="goal__head">
        <div style={{ minWidth: 0 }}>
          <h2 className="goal__title">{goal.title}</h2>
          <p className="goal__meta">
            {total > 0 && (
              <span className="goal__phase">
                Phase <strong>{phaseN}</strong> of {total}
              </span>
            )}
            <span className={`goal__badge goal__badge--${goal.status}`}>
              {goal.status === "active"
                ? "Running"
                : goal.status === "done"
                  ? "Completed"
                  : "Ended incomplete"}
            </span>
            {live && running && <span className="tagpill">Holds the room</span>}
            <span>
              {done} of {total} done
            </span>
            {blocked > 0 && <span className="goal__blocked">{blocked} blocked</span>}
            <span>started {when(goal.createdAt)}</span>
          </p>
        </div>
        <div className="goal__right">
          <GoalDial steps={goal.steps} pct={pct} live={live && running} />
          {live && running ? (
            <button
              className="goal__stop"
              onClick={onStop}
              title="Stop this run. Finished steps keep the status they reached."
            >
              Stop
            </button>
          ) : (
            <button
              className="goal__resume"
              onClick={() => onResume(goal.id)}
              disabled={busy || !unfinished}
              title={
                busy
                  ? "Another run holds this room. Wait for it, or stop it first."
                  : unfinished
                    ? "Carry on with this goal. Steps it never reached go back to not started; finished ones stay finished."
                    : "Every step is done — there is nothing left to pick up."
              }
            >
              Resume
            </button>
          )}
        </div>
      </header>

      {total > 0 ? (
        <StepGraph steps={goal.steps} agents={agents} live={live && running} />
      ) : null}

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
  running,
  onStop,
  onResume,
}: {
  goals: Goal[];
  agents: Map<string, Agent>;
  activeGoalId: string | null;
  roomName: string;
  running: boolean;
  onStop: () => void;
  onResume: (goalId: string) => void;
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
      <div className="steplegend">
        <span className="lg lg--done">
          <i />
          Done
        </span>
        <span className="lg lg--active">
          <i />
          You are here
        </span>
        <span className="lg lg--pending">
          <i />
          Not started
        </span>
        <span className="lg lg--blocked">
          <i />
          Blocked
        </span>
        <span className="lg lg--skipped">
          <i />
          Never reached
        </span>
      </div>
      {goals.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          agents={agents}
          live={goal.id === activeGoalId}
          running={running}
          busy={running}
          onStop={onStop}
          onResume={onResume}
        />
      ))}
    </div>
  );
}
