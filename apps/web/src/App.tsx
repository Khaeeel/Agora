import { useEffect, useMemo, useState } from "react";
import type { Agent } from "./lib/types.ts";
import { useAgora } from "./lib/store.ts";
import { Rail, type View } from "./components/Rail.tsx";
import { Workflow } from "./components/Workflow.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { RunBar } from "./components/RunBar.tsx";
import { Participants } from "./components/Participants.tsx";
import { Composer } from "./components/Composer.tsx";
import { AgentEditor } from "./components/AgentEditor.tsx";
import { NewRoom } from "./components/NewRoom.tsx";

type Theme = "light" | "dark";

function initialTheme(): Theme | null {
  try {
    const saved = localStorage.getItem("agora-theme");
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

/** null = closed, "new" = create, an Agent = edit that one. */
type AgentModal = null | "new" | Agent;

export function App() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [view, setView] = useState<View>("chatroom");
  const [agentModal, setAgentModal] = useState<AgentModal>(null);
  const [showRoom, setShowRoom] = useState(false);
  const [theme, setTheme] = useState<Theme | null>(initialTheme);

  const { state, broadcast, stop, refreshRooms } = useAgora(roomId);

  // Pick a room once the socket says what exists — and recover if the room we
  // were holding no longer does (it was deleted, or the database was reset),
  // which otherwise leaves the header stuck on "no room" beside a full sidebar.
  useEffect(() => {
    if (state.rooms.length === 0) return;
    const stillExists = roomId !== null && state.rooms.some((r) => r.id === roomId);
    if (!stillExists) setRoomId(state.rooms[0]!.id);
  }, [roomId, state.rooms]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme) {
      root.setAttribute("data-theme", theme);
      try {
        localStorage.setItem("agora-theme", theme);
      } catch {
        /* private mode — the OS preference still applies */
      }
    } else {
      root.removeAttribute("data-theme");
    }
  }, [theme]);

  const agentMap = useMemo(
    () => new Map(state.agents.map((a) => [a.id, a])),
    [state.agents],
  );
  const room = state.rooms.find((r) => r.id === roomId) ?? null;
  const busy = state.run?.active === true;

  const activeGoal =
    state.goals.find((g) => g.id === state.run?.goalId) ??
    state.goals.find((g) => g.status === "active") ??
    null;
  const openSteps =
    activeGoal?.steps.filter((s) => s.status !== "done" && s.status !== "skipped")
      .length ?? 0;

  return (
    <div className="shell">
      <Rail
        rooms={state.rooms}
        agents={state.agents}
        statuses={state.statuses}
        activeRoomId={roomId}
        connected={state.connected}
        onSelectRoom={setRoomId}
        onNewRoom={() => setShowRoom(true)}
        onNewAgent={() => setAgentModal("new")}
        onEditAgent={(a) => setAgentModal(a)}
        view={view}
        onSelectView={setView}
        openSteps={openSteps}
        goalRunning={busy}
        onToggleTheme={() =>
          setTheme((t) =>
            t === "dark" ? "light" : t === "light" ? null : "dark",
          )
        }
      />

      <main className="main">
        <header className="topbar">
          <span className="topbar__hash" aria-hidden="true">
            #
          </span>
          <span>
            <span className="topbar__name">
              {view === "workflow" ? "Workflow" : (room?.name ?? "No room selected")}
            </span>
            <br />
            <span className="topbar__sub">
              {view === "workflow"
                ? room
                  ? `Goals set in ${room.name}, and how far each one got`
                  : "Pick a room to see its goals"
                : room
                  ? room.members.map((id) => agentMap.get(id)?.name ?? id).join(", ")
                  : "Create a room to get started"}
            </span>
          </span>
          <span className="topbar__right">
            <button className="ghostbtn" onClick={() => setAgentModal("new")}>
              New agent
            </button>
          </span>
        </header>

        {!state.notifyLive && (
          <p className="banner">
            WhatsApp notifications are not live — updates are logged, not sent.
            Set AGORA_NOTIFY_JID and AGORA_NOTIFY_DRY_RUN=false to enable.
          </p>
        )}

        {state.run && state.run.active && (
          <RunBar run={state.run} agents={agentMap} onStop={stop} />
        )}

        {view === "workflow" ? (
          <Workflow
            goals={state.goals}
            agents={agentMap}
            activeGoalId={state.run?.goalId ?? null}
            roomName={room?.name ?? "the"}
          />
        ) : (
          <>
            <Transcript
              messages={state.messages}
              live={state.live}
              agents={agentMap}
            />
            <Composer
              roomName={room?.name ?? "room"}
              disabled={!room || !state.connected}
              busy={busy}
              onSend={broadcast}
            />
          </>
        )}
      </main>

      <Participants
        room={room}
        agents={agentMap}
        statuses={state.statuses}
        onNewRoom={() => setShowRoom(true)}
        onEditAgent={(a) => setAgentModal(a)}
      />

      {agentModal && (
        <AgentEditor
          {...(agentModal === "new" ? {} : { agent: agentModal })}
          onClose={() => setAgentModal(null)}
          onSaved={() => void refreshRooms()}
        />
      )}

      {showRoom && (
        <NewRoom
          agents={state.agents}
          onClose={() => setShowRoom(false)}
          onCreated={(id) => {
            void refreshRooms();
            setRoomId(id);
          }}
        />
      )}
    </div>
  );
}
