import { useEffect, useState } from "react";
import type { Agent, RunState } from "../lib/types.ts";

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
  const pct = Math.min(100, (run.turn / Math.max(1, run.maxTurns)) * 100);
  const speaker = run.speaking ? agents.get(run.speaking)?.name : null;

  return (
    <div className="runbar" role="status">
      <span className="runbar__stat">
        turn {run.turn}/{run.maxTurns}
      </span>
      <span className="runbar__track">
        <span className="runbar__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="runbar__stat">
        {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
        {String(elapsed % 60).padStart(2, "0")}
      </span>
      <span className="runbar__stat">${run.costUsd.toFixed(4)}</span>
      {speaker && <span className="runbar__stat">{speaker} is writing…</span>}
      <button className="runbar__stop" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}
