import type { Agent, AgentMemory, AgentStatus, MindStone, Room } from "../lib/types.ts";
import { MindStonePanel } from "./MindStone.tsx";
import { GymScene } from "./GymScene.tsx";
import { StatusLegend } from "./bits.tsx";

export function Participants({
  room,
  agents,
  statuses,
  memory,
  onNewRoom,
  onEditAgent,
  onMessage,
  mindStone,
  compacting,
}: {
  room: Room | null;
  agents: Map<string, Agent>;
  statuses: Record<string, AgentStatus>;
  memory: Record<string, AgentMemory>;
  onNewRoom: () => void;
  onEditAgent: (agent: Agent) => void;
  /** Start a direct message to one agent — fills the composer with "@id ". */
  onMessage: (agent: Agent) => void;
  mindStone: MindStone | null;
  compacting: boolean;
}) {
  const members = room?.members ?? [];

  // How many are actually mid-turn. The header used to count members, which is
  // a number that never changes while you watch it — this one does.
  const lifting = members.filter((id) => statuses[id] === "processing").length;

  return (
    <aside className="participants" aria-label="Participants">
      <div className="participants__head">
        <div className="participants__title">Gym Floor</div>
        <div className="participants__count">
          {members.length} {members.length === 1 ? "agent" : "agents"}
          {lifting > 0 && <span className="participants__lifting"> · {lifting} lifting</span>}
        </div>
      </div>

      <GymScene
        members={members}
        agents={agents}
        statuses={statuses}
        memory={memory}
        roomName={room?.name ?? ""}
        compact
      />

      {room && members.length > 0 && (
        <div className="dmlist" aria-label="Message an agent">
          <div className="participants__title" style={{ marginTop: 12 }}>Message an agent</div>
          {members.map((id) => {
            const a = agents.get(id);
            if (!a) return null;
            const lifting = statuses[id] === "processing";
            return (
              <div
                key={id}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <strong>{a.name}</strong>
                  <span className="chip" style={{ marginLeft: 6 }}>{a.role}</span>
                </span>
                <button
                  className="chip"
                  style={{ cursor: "pointer" }}
                  onClick={() => onMessage(a)}
                  title={lifting ? `${a.name} is mid-turn; the message sends once the room is free` : `Message ${a.name} directly — no planning, only ${a.name} answers`}
                >
                  Message
                </button>
                <button className="chip" style={{ cursor: "pointer" }} onClick={() => onEditAgent(a)} title={`Edit ${a.name}`}>
                  Edit
                </button>
              </div>
            );
          })}
        </div>
      )}

      {room && (
        <MindStonePanel
          stone={mindStone}
          roomName={room.name}
          compacting={compacting}
        />
      )}

      <StatusLegend />

      <div className="participants__foot">
        <button className="primarybtn" onClick={onNewRoom}>
          New Room
        </button>
      </div>
    </aside>
  );
}
