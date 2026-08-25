import type { Agent, AgentStatus } from "../lib/types.ts";

export function Avatar({
  agent,
  size = 32,
}: {
  agent: Agent | undefined;
  size?: number;
}) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: agent?.color ?? "var(--muted)",
        fontSize: Math.round(size * 0.42),
      }}
      aria-hidden="true"
    >
      {(agent?.name ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  active: "Active",
  processing: "Processing",
  idle: "Idle",
  offline: "Offline",
};

export function StatusDot({ status }: { status: AgentStatus }) {
  return <span className={`dot dot--${status}`} role="presentation" />;
}

export function StatusPill({ status }: { status: AgentStatus }) {
  return (
    <span className="participant__state">
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatusLegend() {
  return (
    <div className="legend" aria-label="Status legend">
      {(Object.keys(STATUS_LABEL) as AgentStatus[]).map((s) => (
        <span className="legend__item" key={s}>
          <StatusDot status={s} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
