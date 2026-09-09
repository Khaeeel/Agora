import type { Agent, AgentMemory, AgentStatus, MindStone, Room } from "../lib/types.ts";
import { MindStonePanel } from "./MindStone.tsx";
import { GymScene } from "./GymScene.tsx";
import { Av } from "./bits.tsx";

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
        <div className="participants__title">Gym floor</div>
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
        <div className="agents" aria-label="Agents in this room">
          {members.map((id) => {
            const a = agents.get(id);
            if (!a) return null;
            const working = statuses[id] === "processing";
            return (
              <div className="arow" key={id}>
                <button className="mav" onClick={() => onEditAgent(a)} title={`Edit ${a.name}`}>
                  <Av agent={a} size={28} />
                  <span className={`sdot ${working ? "working" : "idle"}`} />
                </button>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="aname" style={{ color: a.color }}>{a.name}</span>
                  <span className="astate">{a.role} · {working ? "writing" : "idle"}</span>
                </span>
                <button className="amsg" onClick={() => onMessage(a)} title={`Message ${a.name} directly — no planning, only ${a.name} answers`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.2A8 8 0 1 1 21 12z" /></svg>
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

      <button className="newroom" onClick={onNewRoom}>New room</button>
    </aside>
  );
}
