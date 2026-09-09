import type { Agent, Goal, StepStatus } from "../lib/types.ts";
import { Avatar } from "./bits.tsx";

const MARK: Record<StepStatus, string> = {
  pending: "○",
  active: "◆",
  done: "✓",
  blocked: "!",
  skipped: "–",
};

/**
 * Compact live plan under the run bar — so you can watch progress without
 * leaving the chatroom for the Workflow tab.
 */
export function PlanStrip({
  goal,
  agents,
  onOpenWorkflow,
}: {
  goal: Goal;
  agents: Map<string, Agent>;
  onOpenWorkflow: () => void;
}) {
  const done = goal.steps.filter((s) => s.status === "done").length;
  const active = goal.steps.find((s) => s.status === "active") ?? null;
  const blocked = goal.steps.find((s) => s.status === "blocked") ?? null;

  return (
    <div className="planstrip" role="status">
      <button className="planstrip__head" onClick={onOpenWorkflow} title="Open Workflow">
        <span className="planstrip__title">{goal.title}</span>
        <span className="planstrip__count">
          {done}/{goal.steps.length}
        </span>
      </button>

      <ol className="planstrip__steps">
        {goal.steps.map((step) => {
          const owner = step.ownerId ? agents.get(step.ownerId) : undefined;
          return (
            <li
              key={step.id}
              className={`planstrip__step planstrip__step--${step.status}`}
              title={
                step.note
                  ? `${step.title} — ${step.note}`
                  : `${step.title}${owner ? ` · ${owner.name}` : ""}`
              }
            >
              <span className="planstrip__mark" aria-hidden="true">
                {MARK[step.status]}
              </span>
              <span className="planstrip__label">
                <span className="planstrip__num">{step.idx + 1}</span>
                {step.title}
              </span>
              {owner && <Avatar agent={owner} size={16} />}
            </li>
          );
        })}
      </ol>

      {(active || blocked) && (
        <p className="planstrip__focus">
          {blocked ? (
            <>
              <span className="planstrip__focus-tag planstrip__focus-tag--blocked">Blocked</span>
              {blocked.title}
              {blocked.note ? ` — ${blocked.note}` : ""}
            </>
          ) : active ? (
            <>
              <span className="planstrip__focus-tag">Now</span>
              {active.title}
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
