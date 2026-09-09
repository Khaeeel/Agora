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
  mindStone,
  compacting,
}: {
  room: Room | null;
  agents: Map<string, Agent>;
  statuses: Record<string, AgentStatus>;
  memory: Record<string, AgentMemory>;
  onNewRoom: () => void;
  onEditAgent: (agent: Agent) => void;
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
