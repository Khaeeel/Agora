import { useEffect, useState } from "react";
import type { Agent, RunPhase, RunState } from "../lib/types.ts";

const PHASE_LABEL: Record<RunPhase, string> = {
  planning: "Planning",
  deciding: "Deciding",
  waiting_slot: "Waiting for slot",
  generating: "Generating",
  rate_limited: "Rate limited",
  compacting: "Saving to mind stone",
};

function fmtClock(totalSec: number): string {
  const s = Math.max(0, totalSec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fmtShort(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function RunBar({
  run,
  agents,
  onStop,
}: {
  run: RunState;
  agents: Map<string, Agent>;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!run.active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run.active]);

  const elapsed = Math.max(0, Math.round((now - run.startedAt) / 1000));
  const budgetSec = Math.max(1, Math.round((run.timeoutMs || 1) / 1000));
  const remaining = Math.max(0, budgetSec - elapsed);
  const turnPct = Math.min(100, (run.turn / Math.max(1, run.maxTurns)) * 100);
  const timePct = Math.min(100, (elapsed / budgetSec) * 100);
  const speaker = run.speaking ? agents.get(run.speaking)?.name : null;
  const phase = run.phase;
  const turnElapsed =
    run.turnStartedAt != null ? Math.max(0, now - run.turnStartedAt) : null;

  return (
    <div
      className={`runbar${phase === "rate_limited" || phase === "waiting_slot" ? " runbar--warn" : ""}`}
      role="status"
    >
      <span className="runbar__stat">
        turn {run.turn}/{run.maxTurns}
      </span>
      <span className="runbar__tracks" title="Turn progress · wall-clock budget">
        <span className="runbar__track">
          <span className="runbar__fill" style={{ width: `${turnPct}%` }} />
        </span>
        <span className="runbar__track runbar__track--time">
          <span className="runbar__fill runbar__fill--time" style={{ width: `${timePct}%` }} />
        </span>
      </span>
      <span className="runbar__stat" title="Elapsed / remaining wall-clock budget">
        {fmtClock(elapsed)}
        <span className="runbar__sep">/</span>
        {fmtClock(remaining)} left
      </span>
      {phase && (
        <span
          className={`runbar__phase runbar__phase--${phase}`}
          title={run.phaseDetail ?? PHASE_LABEL[phase]}
        >
          {PHASE_LABEL[phase]}
          {run.phaseDetail ? ` · ${run.phaseDetail}` : ""}
        </span>
      )}
      {run.driver && (
        <span
          className={`runbar__drv runbar__drv--${run.driver === "cursor-cli" ? "cursor" : "claude"}`}
          title={`Turns are running on ${run.driver}`}
        >
          on {run.driver === "cursor-cli" ? "Cursor" : "Claude"}
        </span>
      )}
      {speaker && !phase && (
        <span className="runbar__stat">{speaker} is writing…</span>
      )}
      {speaker && phase && phase !== "waiting_slot" && phase !== "rate_limited" && (
        <span className="runbar__stat">
          {speaker}
          {turnElapsed != null ? ` · ${fmtShort(turnElapsed)}` : ""}
        </span>
      )}
      {run.lastTurnMs != null && (
        <span className="runbar__stat runbar__stat--muted" title="Last finished turn">
          last {fmtShort(run.lastTurnMs)}
        </span>
      )}
      <button className="runbar__stop" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}
