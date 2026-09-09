import { useState } from "react";
import type { Agent, AgentStatus, Room, RunState } from "../lib/types.ts";
import { Avatar, StatusDot } from "./bits.tsx";

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
  onReconnect: () => void;
  view: View;
  onSelectView: (view: View) => void;
  /** Steps not yet done in the active goal — surfaced next to Workflow. */
  openSteps: number;
  goalRunning: boolean;
  /** Live runs across rooms. */
  runs: RunState[];
  agentsById: Map<string, Agent>;
}

const PHASE_SHORT: Record<string, string> = {
  planning: "planning",
  deciding: "deciding",
  waiting_slot: "waiting",
  generating: "writing",
  rate_limited: "rate-limited",
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
  onReconnect,
  view,
  onSelectView,
  openSteps,
  goalRunning,
  runs,
  agentsById,
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
  const liveRuns = runs.filter((r) => r.active);
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;

  return (
    <nav className="rail" aria-label="Rooms and agents">
      <div className="rail__head">
        <span className="rail__mark" aria-hidden="true">
          ✦
        </span>
        <span>
          <span className="rail__title">
            Ago<i>ra</i>
          </span>
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
          aria-current={view === "dashboard"}
          onClick={() => onSelectView("dashboard")}
        >
          <span className="nav__icon" aria-hidden="true">
            ◉
          </span>
          Dashboard
        </button>
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
            shownRooms.map((room) => {
              const roomRun = liveRuns.find((r) => r.roomId === room.id);
              const speaker = roomRun?.speaking
                ? agentsById.get(roomRun.speaking)?.name
                : null;
              return (
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
                      {roomRun
                        ? `${speaker ?? "run"} · ${PHASE_SHORT[roomRun.phase ?? ""] ?? "live"} · t${roomRun.turn}`
                        : room.members
                            .map((id) => byId.get(id)?.name ?? id)
                            .join(", ")}
                    </span>
                  </span>
                  <span className="roomitem__meta">
                    {roomRun ? (
                      <span className="roomitem__live" title="Run active" />
                    ) : (
                      room.members.length
                    )}
                  </span>
                </button>
              );
            })
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

      {liveRuns.length > 0 && (
        <div className="activity" aria-label="Live runs">
          <div className="activity__label">Live</div>
          {liveRuns.map((r) => {
            const speaker = r.speaking ? agentsById.get(r.speaking)?.name : null;
            return (
              <button
                key={r.roomId}
                className="activity__row"
                onClick={() => onSelectRoom(r.roomId)}
                title={`${roomName(r.roomId)} — turn ${r.turn}/${r.maxTurns}`}
              >
                <span className="activity__room">{roomName(r.roomId)}</span>
                <span className="activity__meta">
                  {speaker ?? "—"} · turn {r.turn}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="rail__foot">
        <span className="rail__mark" style={{ width: 28, height: 28, fontSize: 13 }}>
          ⚡
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="rail__foot-label">System Controller</span>
          <br />
          {connected ? (
            <span className="rail__foot-sub">
              {agents.length} agents · {busy} working
              {liveRuns.length > 0
                ? ` · ${liveRuns.length} run${liveRuns.length === 1 ? "" : "s"}`
                : ""}
            </span>
          ) : (
            <button className="rail__retry" onClick={onReconnect}>
              Disconnected — retry now
            </button>
          )}
        </span>
      </div>
    </nav>
  );
}
