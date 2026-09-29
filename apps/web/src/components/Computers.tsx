import type { Agent, AgentStatus, Room, RunState } from "../lib/types.ts";
import { ComputerScene } from "./ComputerScene.tsx";
import { Av } from "./bits.tsx";

/**
 * One shared machine for every crew — they all drive the same headless Chrome.
 * Double-click the screen to expand and navigate inside.
 */
export function Computers({
  rooms,
  agents,
  statuses,
  runs,
}: {
  rooms: Room[];
  agents: Map<string, Agent>;
  statuses: Record<string, AgentStatus>;
  runs: RunState[];
  activeRoomId?: string | null;
  onSelectRoom?: (id: string) => void;
}) {
  const allMembers = [...new Set(rooms.flatMap((room) => room.members))];
  const working = allMembers.filter((id) => statuses[id] === "processing").length;
  const liveRuns = runs.filter((r) => r.active).length;

  return (
    <div className="computers">
      <div className="computers__stage">
        <ComputerScene
          members={allMembers}
          agents={agents}
          statuses={statuses}
          roomName="Agora"
          size="full"
          live
        />
      </div>

      <div className="computers__crews" aria-label="Crews on this machine">
        <div className="computers__crews-head">
          <span>Shared desktop</span>
          <span className="computers__crews-stat">
            {rooms.length} crew{rooms.length === 1 ? "" : "s"}
            {working > 0 ? ` · ${working} writing` : " · idle"}
            {liveRuns > 0 ? ` · ${liveRuns} run${liveRuns === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        <ul className="computers__crew-list">
          {rooms.map((room) => {
            const roomWorking = room.members.filter((id) => statuses[id] === "processing").length;
            return (
              <li key={room.id} className="computers__crew">
                <span className="computers__crew-name"># {room.name}</span>
                <span className="computers__crew-avatars">
                  {room.members.map((id) => {
                    const agent = agents.get(id);
                    if (!agent) return null;
                    return (
                      <span
                        key={id}
                        className={statuses[id] === "processing" ? "computers__crew-av--live" : undefined}
                        title={`${agent.name}${statuses[id] === "processing" ? " · writing" : ""}`}
                      >
                        <Av agent={agent} size={22} />
                      </span>
                    );
                  })}
                </span>
                <span className="computers__crew-stat">
                  {room.members.length} agent{room.members.length === 1 ? "" : "s"}
                  {roomWorking > 0 ? ` · ${roomWorking} writing` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
