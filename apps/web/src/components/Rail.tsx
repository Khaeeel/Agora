import { useState } from "react";
import type { Agent, AgentStatus, Room } from "../lib/types.ts";
import { Avatar, StatusDot } from "./bits.tsx";

export type View = "workflow" | "chatroom";

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
  onToggleTheme: () => void;
  view: View;
  onSelectView: (view: View) => void;
  /** Steps not yet done in the active goal — surfaced next to Workflow. */
  openSteps: number;
  goalRunning: boolean;
}

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
  onToggleTheme,
  view,
  onSelectView,
  openSteps,
  goalRunning,
}: Props) {
  const [tab, setTab] = useState<"chats" | "agents">("chats");
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const shownRooms = rooms.filter(
    (r) => !needle || r.name.toLowerCase().includes(needle),
  );
  const shownAgents = agents.filter(
    (a) =>
      !needle ||
      a.name.toLowerCase().includes(needle) ||
      a.role.toLowerCase().includes(needle),
  );

  const byId = new Map(agents.map((a) => [a.id, a]));
  const busy = agents.filter((a) => statuses[a.id] === "processing").length;

  return (
    <nav className="rail" aria-label="Rooms and agents">
      <div className="rail__head">
        <span className="rail__mark" aria-hidden="true">
          ✦
        </span>
        <span>
          <span className="rail__title">Agora</span>
          <br />
          <span className="rail__sub">Agent Workspace</span>
        </span>
        <button
          className="rail__new"
          onClick={tab === "chats" ? onNewRoom : onNewAgent}
          title={tab === "chats" ? "New room" : "New agent"}
          aria-label={tab === "chats" ? "New room" : "New agent"}
        >
          +
        </button>
      </div>

      <div className="nav">
        <button
          className="nav__item"
          aria-current={view === "workflow"}
          onClick={() => onSelectView("workflow")}
        >
          <span className="nav__icon" aria-hidden="true">
            ◷
          </span>
          Workflow
          {openSteps > 0 && (
            <span className={`nav__count${goalRunning ? " nav__count--live" : ""}`}>
              {openSteps}
            </span>
          )}
        </button>
        <button
          className="nav__item"
          aria-current={view === "chatroom"}
          onClick={() => onSelectView("chatroom")}
        >
          <span className="nav__icon" aria-hidden="true">
            ▣
          </span>
          Chatroom
        </button>
      </div>

      <input
        className="rail__search"
        placeholder="Search agents & rooms"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search agents and rooms"
      />

      <div className="tabs" role="tablist">
        <button
          className="tab"
          role="tab"
          aria-selected={tab === "chats"}
          onClick={() => setTab("chats")}
        >
          Chats
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={tab === "agents"}
          onClick={() => setTab("agents")}
        >
          Agents
        </button>
      </div>

      <div className="rail__list">
        {tab === "chats" &&
          (shownRooms.length === 0 ? (
            <p className="rail__empty">No rooms yet. Press + to make one.</p>
          ) : (
            shownRooms.map((room) => (
              <button
                key={room.id}
                className="roomitem"
                aria-current={room.id === activeRoomId}
                onClick={() => onSelectRoom(room.id)}
              >
                <span className="roomitem__hash" aria-hidden="true">
                  #
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="roomitem__name">{room.name}</span>
                  <br />
                  <span className="roomitem__last">
                    {room.members
                      .map((id) => byId.get(id)?.name ?? id)
                      .join(", ")}
                  </span>
                </span>
                <span className="roomitem__meta">{room.members.length}</span>
              </button>
            ))
          ))}

        {tab === "agents" &&
          (shownAgents.length === 0 ? (
            <p className="rail__empty">No agents match.</p>
          ) : (
            shownAgents.map((agent) => (
              <button
                className="agentitem"
                key={agent.id}
                onClick={() => onEditAgent(agent)}
                title={`Edit ${agent.name}`}
              >
                <Avatar agent={agent} size={30} />
                <span style={{ minWidth: 0 }}>
                  <span className="agentitem__name">{agent.name}</span>
                  <br />
                  <span className="agentitem__role">{agent.role}</span>
                </span>
                <StatusDot status={statuses[agent.id] ?? "idle"} />
              </button>
            ))
          ))}
      </div>

      <div className="rail__foot">
        <span className="rail__mark" style={{ width: 28, height: 28, fontSize: 13 }}>
          ⚡
        </span>
        <span>
          <span className="rail__foot-label">System Controller</span>
          <br />
          <span className="rail__foot-sub">
            {connected
              ? `${agents.length} agents · ${busy} working`
              : "reconnecting…"}
          </span>
        </span>
        <button className="iconbtn" onClick={onToggleTheme} title="Toggle theme">
          ◐
        </button>
      </div>
    </nav>
  );
}
