import { useEffect, useMemo, useState } from "react";
import type { Agent } from "./lib/types.ts";
import { useAgora } from "./lib/store.ts";
import { Rail, type View } from "./components/Rail.tsx";
import { Dashboard } from "./components/Dashboard.tsx";
import { Workflow } from "./components/Workflow.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { RunBar } from "./components/RunBar.tsx";
import { PlanStrip } from "./components/PlanStrip.tsx";
import { Participants } from "./components/Participants.tsx";
import { Composer } from "./components/Composer.tsx";
import { AgentEditor } from "./components/AgentEditor.tsx";
import { NewRoom } from "./components/NewRoom.tsx";

/** null = closed, "new" = create, an Agent = edit that one. */
type AgentModal = null | "new" | Agent;

export function App() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [view, setView] = useState<View>("chatroom");
  const [agentModal, setAgentModal] = useState<AgentModal>(null);
  const [showRoom, setShowRoom] = useState(false);
  /** What a "Message" button dropped into the composer, with a nonce so the same agent twice still fires. */
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);

  const {
    state,
    broadcast,
    stop,
    resume,
    answer,
    refreshRooms,
    reconnect,
    clearError,
    clearRateLimit,
  } = useAgora(roomId);

  // Pick a room once the socket says what exists — and recover if the room we
  // were holding no longer does (it was deleted, or the database was reset),
  // which otherwise leaves the header stuck on "no room" beside a full sidebar.
  useEffect(() => {
    if (state.rooms.length === 0) return;
    const stillExists = roomId !== null && state.rooms.some((r) => r.id === roomId);
    if (!stillExists) setRoomId(state.rooms[0]!.id);
  }, [roomId, state.rooms]);

  // Rate-limit flashes clear themselves so they don't stick forever.
  useEffect(() => {
    if (!state.rateLimit) return;
    const t = setTimeout(() => clearRateLimit(), 8000);
    return () => clearTimeout(t);
  }, [state.rateLimit, clearRateLimit]);

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
  // The amber pin on a room: its latest goal has a blocked step. Only the
  // selected room's goals are loaded, so the pin is exact for it and absent
  // for the others until you open them.
  const blockedRooms = useMemo(() => {
    const s = new Set<string>();
    const latest = state.goals[0];
    if (roomId && latest && latest.steps.some((st) => st.status === "blocked")) s.add(roomId);
    return s;
  }, [roomId, state.goals]);

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
        onReconnect={reconnect}
        view={view}
        onSelectView={setView}
        openSteps={openSteps}
        goalRunning={busy}
        runs={state.runs}
        agentsById={agentMap}
        blockedRooms={blockedRooms}
      />

      <main className="main">
        <header className="rhead">
          <h2>
            <span className="hash">#</span>
            <span>
              {view === "dashboard" ? "Dashboard" : view === "workflow" ? "Workflow" : (room?.name ?? "No room selected")}
            </span>
          </h2>
          <div className="topic">
            {view === "dashboard"
              ? "Everything the team holds in memory, across every room"
              : view === "workflow"
                ? room
                  ? `Goals set in ${room.name}, and how far each one got`
                  : "Pick a room to see its goals"
                : room
                  ? room.topic || room.members.map((id) => agentMap.get(id)?.name ?? id).join(", ")
                  : "Create a room to get started"}
          </div>
          <button className="headbtn" onClick={() => setAgentModal("new")}>Add agent</button>
        </header>

        {!state.notifyLive && (
          <p className="banner">
            WhatsApp notifications are not live — updates are logged, not sent.
            Set AGORA_NOTIFY_JID and AGORA_NOTIFY_DRY_RUN=false to enable.
          </p>
        )}

        {state.error && (
          <p className="banner banner--error" role="alert">
            <span style={{ flex: 1 }}>{state.error}</span>
            <button className="banner__dismiss" onClick={clearError} aria-label="Dismiss">
              Dismiss
            </button>
          </p>
        )}

        {state.rateLimit && (
          <p className="banner banner--warn" role="status">
            Rate limited — {state.rateLimit}
          </p>
        )}

        {state.run && state.run.active && (
          <RunBar run={state.run} agents={agentMap} onStop={stop} />
        )}

        {view === "chatroom" && activeGoal && activeGoal.status === "active" && (
          <PlanStrip
            goal={activeGoal}
            agents={agentMap}
            onOpenWorkflow={() => setView("workflow")}
          />
        )}

        {view === "dashboard" ? (
          <Dashboard
            agents={agentMap}
            runs={state.runs}
            connected={state.connected}
          />
        ) : view === "workflow" ? (
          <Workflow
            goals={state.goals}
            agents={agentMap}
            activeGoalId={state.run?.goalId ?? null}
            roomName={room?.name ?? "the"}
            running={busy}
            onStop={stop}
            onResume={resume}
          />
        ) : (
          <>
            <Transcript
              messages={state.messages}
              live={state.live}
              agents={agentMap}
              onAnswer={answer}
              busy={busy}
            />
            <Composer
              roomName={room?.name ?? "room"}
              hasRoom={room !== null}
              connected={state.connected}
              busy={busy}
              onSend={broadcast}
              prefill={prefill}
            />
          </>
        )}
      </main>

      <Participants
        room={room}
        agents={agentMap}
        statuses={state.statuses}
        memory={state.memory}
        onNewRoom={() => setShowRoom(true)}
        onEditAgent={(a) => setAgentModal(a)}
        onMessage={(a) => setPrefill({ text: `@${a.id} `, nonce: Date.now() })}
        mindStone={state.mindStone}
        compacting={state.run?.phase === "compacting"}
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
