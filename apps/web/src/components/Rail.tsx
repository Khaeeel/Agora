import { useState } from "react";
import type { Agent, AgentStatus, Room, RunState } from "../lib/types.ts";
import { Av } from "./bits.tsx";

export type View = "dashboard" | "workflow" | "chatroom";

interface Props {
  rooms: Room[];
  agents: Agent[];
  statuses: Record<string, AgentStatus>;
  activeRoomId: string | null;
  connected: boolean;
  onSelectRoom: (id: string) => void;
  onNewRoom: () => void;
  onNewAgent: () => void;
  onEditAgent: (agent: Agent) => void;
  /** Open the private thread with one agent. */
  onOpenDm: (agent: Agent) => void;
  dmAgentId: string | null;
  onReconnect: () => void;
  view: View;
  onSelectView: (view: View) => void;
  /** Steps not yet done in the active goal — surfaced next to Workflow. */
  openSteps: number;
  goalRunning: boolean;
  /** Live runs across rooms. */
  runs: RunState[];
  agentsById: Map<string, Agent>;
  /** Rooms whose latest goal has a blocked step — the amber pin. */
  blockedRooms?: Set<string>;
}

const PHASE_SHORT: Record<string, string> = {
  planning: "planning",
  deciding: "deciding",
  waiting_slot: "waiting",
  generating: "writing",
  rate_limited: "rate-limited",
  compacting: "folding",
};

const Icon = {
  dashboard: (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  workflow: (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
    </svg>
  ),
  chatroom: (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.2A8 8 0 1 1 21 12z" />
    </svg>
  ),
};

export function Rail({
  rooms,
  agents,
  statuses,
  activeRoomId,
  connected,
  onSelectRoom,
  onNewRoom,
  onNewAgent,
  onEditAgent,
  onOpenDm,
  dmAgentId,
  onReconnect,
  view,
  onSelectView,
  openSteps,
  goalRunning,
  runs,
  agentsById,
  blockedRooms,
}: Props) {
  const [tab, setTab] = useState<"rooms" | "agents">(dmAgentId ? "agents" : "rooms");
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const shownRooms = rooms.filter((r) => !needle || r.name.toLowerCase().includes(needle));
  const shownAgents = agents.filter(
    (a) => !needle || a.name.toLowerCase().includes(needle) || a.role.toLowerCase().includes(needle),
  );
  const busy = agents.filter((a) => statuses[a.id] === "processing").length;
  const liveRuns = runs.filter((r) => r.active);

  return (
    <nav className="rail" aria-label="Rooms and agents">
      <div className="brand">
        <div className="mark">
          <svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2l2.4 6.2L21 10l-5.4 2.6L14 19l-2-4.6L7 17l2.2-5.4L4 9l6.1-.6z" /></svg>
        </div>
        <div>
          <h1>AGORA</h1>
          <p>Agent workspace</p>
        </div>
        <button
          className="newbtn"
          onClick={tab === "rooms" ? onNewRoom : onNewAgent}
          title={tab === "rooms" ? "New room" : "New agent"}
          aria-label={tab === "rooms" ? "New room" : "New agent"}
        >
          +
        </button>
      </div>

      <div className="cnav">
        <button className={view === "dashboard" ? "on" : ""} onClick={() => onSelectView("dashboard")}>
          {Icon.dashboard}Dashboard
        </button>
        <button className={view === "workflow" ? "on" : ""} onClick={() => onSelectView("workflow")}>
          {Icon.workflow}Workflow
          {openSteps > 0 && <span className={`count${goalRunning ? " live" : ""}`}>{openSteps}</span>}
        </button>
        <button className={view === "chatroom" ? "on" : ""} onClick={() => onSelectView("chatroom")}>
          {Icon.chatroom}Chatroom
        </button>
      </div>

      <div className="searchwrap">
        <input
          className="search"
          placeholder="Search rooms and agents"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search rooms and agents"
        />
      </div>
      <div className="ctabs" role="tablist">
        <button className={`ctab${tab === "rooms" ? " on" : ""}`} role="tab" aria-selected={tab === "rooms"} onClick={() => setTab("rooms")}>
          Rooms
        </button>
        <button className={`ctab${tab === "agents" ? " on" : ""}`} role="tab" aria-selected={tab === "agents"} onClick={() => setTab("agents")}>
          Agents
        </button>
      </div>

      <div className="rooms">
        {tab === "rooms" && <div className="grouplabel">Active crews</div>}
        {tab === "rooms" &&
          (shownRooms.length === 0 ? (
            <p className="rail__empty">No rooms yet. Press + to make one.</p>
          ) : (
            shownRooms.map((room) => {
              const run = liveRuns.find((r) => r.roomId === room.id);
              const speaker = run?.speaking ? agentsById.get(run.speaking)?.name : null;
              const snippet = run
                ? `${speaker ?? "run"} · ${PHASE_SHORT[run.phase ?? ""] ?? "live"} · t${run.turn}`
                : room.topic || room.members.map((id) => agentsById.get(id)?.name ?? id).join(", ");
              return (
                <button
                  key={room.id}
                  className={`room-item${room.id === activeRoomId ? " on" : ""}`}
                  onClick={() => onSelectRoom(room.id)}
                >
                  <div className="room-top">
                    <span className="hash">#</span>
                    <span className="room-name">{room.name}</span>
                    {blockedRooms?.has(room.id) && <span className="blockedpin" title="A step is blocked" />}
                    {run && <span className="pulse" title="Run active" />}
                    <span className="unread" title={`${room.members.length} agents`}>{room.members.length}</span>
                  </div>
                  <div className="room-bottom">
                    <span className="stack">
                      {room.members.slice(0, 4).map((id) => (
                        <Av key={id} agent={agentsById.get(id)} name={agentsById.get(id)?.name ?? id} size={19} />
                      ))}
                    </span>
                    <span className="snippet">{snippet}</span>
                  </div>
                </button>
              );
            })
          ))}

        {tab === "agents" &&
          (shownAgents.length === 0 ? (
            <p className="rail__empty">No agents match.</p>
          ) : (
            shownAgents.map((agent) => (
              <div className={`agent-item${dmAgentId === agent.id ? " on" : ""}`} key={agent.id}>
                <button className="agent-open" onClick={() => onOpenDm(agent)} title={`Message ${agent.name} privately`}>
                  <span className="mav">
                    <Av agent={agent} size={26} />
                    <span className={`sdot ${statuses[agent.id] === "processing" ? "working" : "idle"}`} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="aname" style={{ color: agent.color }}>{agent.name}</span>
                    <span className="astate">{agent.role}</span>
                  </span>
                </button>
                <button className="amsg" onClick={() => onEditAgent(agent)} title={`Edit ${agent.name}`} aria-label={`Edit ${agent.name}`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                </button>
              </div>
            ))
          ))}
      </div>

      <div className="controller">
        <div className="bolt">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6z" /></svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <b>System controller</b>
          {connected ? (
            <span>
              {agents.length} agents · {busy} working
              {liveRuns.length > 0 ? ` · ${liveRuns.length} run${liveRuns.length === 1 ? "" : "s"}` : ""}
            </span>
          ) : (
            <button className="retry" onClick={onReconnect}>Disconnected — retry now</button>
          )}
        </div>
      </div>
    </nav>
  );
}
