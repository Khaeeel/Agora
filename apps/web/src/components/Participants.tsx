import type { Agent, AgentStatus, Room } from "../lib/types.ts";
import { Avatar, StatusLegend, StatusPill } from "./bits.tsx";

export function Participants({
  room,
  agents,
  statuses,
  onNewRoom,
  onEditAgent,
}: {
  room: Room | null;
  agents: Map<string, Agent>;
  statuses: Record<string, AgentStatus>;
  onNewRoom: () => void;
  onEditAgent: (agent: Agent) => void;
}) {
  const members = room?.members ?? [];

  return (
    <aside className="participants" aria-label="Participants">
      <div className="participants__head">
        <div className="participants__title">Participants</div>
        <div className="participants__count">
          {members.length} {members.length === 1 ? "agent" : "agents"} in this room
        </div>
      </div>

      <div className="participants__list">
        {members.map((id) => {
          const agent = agents.get(id);
          const isOrchestrator = room?.orchestratorId === id;
          return (
            <button
              className="participant participant--button"
              key={id}
              onClick={() => agent && onEditAgent(agent)}
              disabled={!agent}
              title={agent ? `Edit ${agent.name}` : undefined}
            >
              <Avatar agent={agent} />
              <span style={{ minWidth: 0 }}>
                <span className="participant__name">{agent?.name ?? id}</span>
                {isOrchestrator && (
                  <span className="chip" style={{ marginLeft: 6 }}>
                    directs
                  </span>
                )}
                <br />
                <span className="participant__role">{agent?.role ?? "unknown"}</span>
              </span>
              <StatusPill status={statuses[id] ?? "idle"} />
            </button>
          );
        })}
      </div>

      <StatusLegend />

      <div className="participants__foot">
        <button className="primarybtn" onClick={onNewRoom}>
          New Room
        </button>
      </div>
    </aside>
  );
}
