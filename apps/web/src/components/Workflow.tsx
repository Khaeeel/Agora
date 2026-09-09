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

/**
 * What sits inside the disc.
 *
 * The reference puts the step number in every disc and swaps it for a tick
 * once the step is done, which is why there is no separate number badge on
 * the rim any more — the number was being drawn twice.
 *
 * Blocked keeps an exclamation rather than its number. In the reference,
 * blocked and queued are both dashed rings and only the colour separates
 * them; this file's own rule is that state survives greyscale, so blocked
 * needs a mark of its own.
 */
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
 * Steps as one left-to-right flow.
 *
 * This was a serpentine grid on fixed 172px cells, which broke the moment a
 * real plan arrived: research step titles run well over a hundred characters,
 * overflowed their cell, and landed on top of the next row's nodes. A single
 * row cannot collide vertically no matter how long the text gets — cards grow
 * downward into empty space and the container scrolls sideways instead.
 */
function StepGraph({
  steps,
  agents,
  live,
}: {
  steps: Step[];
  agents: Map<string, Agent>;
  /** A process is running this goal right now. */
  live: boolean;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div className="flow__scroll">
      <ol className="flow">
        {steps.map((step, i) => {
          const owner = step.ownerId ? agents.get(step.ownerId) : undefined;
          const open = openIdx === i;
          // The connector into this step is solid only if the run got here.
          const reached = step.status !== "pending" && step.status !== "skipped";
          // The connector belongs to the step it feeds, so lighting up the
          // active step's own line is the same thing as lighting the line
          // travelling into it from the step before.
          const flowing = live && step.status === "active" && i > 0;
          return (
            <li className="flowstep" key={step.id}>
              {/* A static arrowhead tells you the order; a travelling pulse
                  tells you work is moving right now. Only the connector into
                  the step being worked on animates — so when a run stalls the
                  board goes still, and you can see that from the doorway
                  without reading a number. */}
              {i > 0 && (
                <span
                  className={
                    "link" + (flowing ? " link--live" : reached ? " link--done" : "")
                  }
                  aria-hidden="true"
                >
                  <span className="link__line" />
                  <span className="link__head" />
                  {flowing && <span className="link__pulse" />}
                  {/* The caption describes the EDGE, not the step it feeds.
                      "passed" — the reference's word — reads as a verdict once
                      the step on the far end is blocked, and a board can show
                      four blocked steps in a row. "Handed off" is both
                      unambiguous and the vocabulary this codebase already
                      uses for one step giving way to the next. */}
                  {(flowing || reached) && (
                    <span className="link__cap">
                      {flowing ? "live" : "handed off"}
                    </span>
                  )}
                </span>
              )}

              <button
                className={`gnode gnode--${step.status}${open ? " gnode--sel" : ""}${
                  flowing || (live && step.status === "active") ? " gnode--live" : ""
                }`}
                onClick={() => setOpenIdx(open ? null : i)}
                aria-expanded={open}
                title={STEP_LABEL[step.status]}
              >
                <span className="gnode__glyph" aria-hidden="true">
                  {glyph(step.status, i)}
                </span>
              </button>

              <div className="gcard">
                <div className={`gcard__title gcard__title--${step.status}`}>
                  {step.title}
                </div>
                {/* The reference names the operation under each node — the
                    ComfyUI class doing the work. The equivalent here is the
                    agent that owns the step, which is the same question:
                    what, specifically, is running this. */}
                {owner && (
                  <div className="gcard__owner">
                    <Avatar agent={owner} size={14} />
                    {owner.name}
                  </div>
                )}
                <div className={`gcard__status gcard__status--${step.status}`}>
                  {STEP_LABEL[step.status]}
                </div>
                {step.note && (
                  <button
                    className="gcard__note"
                    onClick={() => setOpenIdx(open ? null : i)}
                    aria-expanded={open}
                    title={open ? "Collapse" : "Show the full note"}
                  >
                    {/* The clamp lives on a span, not the button. -webkit-box
                        on a button element is unreliable — the ellipsis drew
                        but the remaining lines still rendered underneath and
                        spilled out of the goal card. */}
                    <span className={open ? "" : "gcard__note-clamp"}>{step.note}</span>
                    <span className="gcard__note-more">{open ? "less" : "more"}</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * The goal percentage as a dial: one tick per step, each tick carrying its
 * own step's status colour.
 *
 * This is the one running-state in the reference deck that claims to answer
 * "how far along?", and it is only allowed to make that claim where the data
 * genuinely exists. It does here — `done of total` is counted from the board,
 * not estimated — where it does NOT exist on an individual step, which is why
 * the step nodes get the ki charge instead.
 *
 * The ring says more than the number can: 60% because three steps finished
 * reads differently from 60% with a blocked step sitting in the middle, and
 * "60%" alone cannot tell you which one you are looking at.
 *
 * pathLength="100" normalises the circumference, so every dash figure below
 * is a percentage and none of it has to change if the radius does.
 */
function GoalDial({
  steps,
  pct,
  live,
}: {
  steps: Step[];
  pct: number;
  /** A process is in flight — only then does the satellite orbit. */
  live: boolean;
}) {
  const seg = 100 / Math.max(steps.length, 1);
  // A gap between ticks, so the ring reads as a count of steps rather than as
  // one continuous arc. Below about five steps the gap can be generous; past
  // a dozen the ticks are thin enough that it has to shrink or they vanish.
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
  /** A process is actually in flight — not merely "this was the run's goal". */
  running: boolean;
  /** Some run holds this room, so nothing else may start. */
  busy: boolean;
  onStop: () => void;
  onResume: (goalId: string) => void;
}) {
  const total = goal.steps.length;
  const done = goal.steps.filter((s) => s.status === "done").length;
  const blocked = goal.steps.filter((s) => s.status === "blocked").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const unfinished = total > 0 && done < total;

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
            {live && running && <span className="tagpill">Holds the room</span>}
            <span>
              {done} of {total} done
            </span>
            {blocked > 0 && <span className="goal__blocked">{blocked} blocked</span>}
            <span>{when(goal.createdAt)}</span>
          </p>
        </div>
        <div className="goal__right">
          <GoalDial steps={goal.steps} pct={pct} live={live && running} />
          {/* One control per card, and which one it is says what the card can
              do. A live run can be stopped; a goal that stopped short can be
              picked back up. Retyping the prompt is the thing this replaces —
              that plans a SECOND goal describing the same work, which is how
              the same job ends up on the board twice. */}
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

      <StepGraph steps={goal.steps} agents={agents} live={live && running} />

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
      {/* Five states share one ring shape, and three of them are separated by
          colour and border alone. The reference carries a legend for exactly
          this reason; with a fifth state to place, Agora needs it more. */}
      <div className="steplegend">
        <span className="lg lg--done">
          <i />
          Done
        </span>
        <span className="lg lg--active">
          <i />
          In progress
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
