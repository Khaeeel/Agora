import { Fragment, useEffect, useRef, useState } from "react";
import type { Agent, AgentMemory, AgentStatus, MindStone, Room } from "../lib/types.ts";
import { MindStonePanel } from "./MindStone.tsx";
import { GymScene } from "./GymScene.tsx";
import { Av } from "./bits.tsx";

/**
 * Why an agent cannot leave this room right now, or null when it can — plus
 * who takes over when it is the one directing. Mirrors the server's checks so
 * the menu says why before you click; the server still decides.
 */
function removalBlock(
  agent: Agent,
  room: Room,
  agents: Map<string, Agent>,
  busy: boolean,
): { reason: string | null; successor: Agent | null } {
  if (busy) return { reason: "Stop the run first", successor: null };
  if (room.members.length <= 1) return { reason: "Only agent in this room", successor: null };
  if (agent.id !== room.orchestratorId) return { reason: null, successor: null };
  const successor =
    room.members
      .map((m) => agents.get(m))
      .find((m): m is Agent => m !== undefined && m.id !== agent.id && m.orchestrator) ?? null;
  return successor
    ? { reason: null, successor }
    : { reason: "No one else here can direct the room", successor: null };
}

export function Participants({
  room,
  agents,
  statuses,
  memory,
  busy,
  onNewRoom,
  onEditAgent,
  onMessage,
  onRemove,
  mindStone,
  compacting,
}: {
  room: Room | null;
  agents: Map<string, Agent>;
  statuses: Record<string, AgentStatus>;
  memory: Record<string, AgentMemory>;
  /** A run is going in this room — nobody leaves mid-run. */
  busy: boolean;
  onNewRoom: () => void;
  onEditAgent: (agent: Agent) => void;
  /** Start a direct message to one agent — fills the composer with "@id ". */
  onMessage: (agent: Agent) => void;
  /** Take an agent out of this room. Resolves false when the server refused. */
  onRemove: (agent: Agent) => Promise<boolean>;
  mindStone: MindStone | null;
  compacting: boolean;
}) {
  const members = room?.members ?? [];

  // How many are actually mid-turn. The header used to count members, which is
  // a number that never changes while you watch it — this one does.
  const lifting = members.filter((id) => statuses[id] === "processing").length;

  // The row whose actions are open. One at a time, and it lives under the row
  // rather than floating, so the scrolling list can never clip it.
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpenId(null);
    setConfirming(false);
  }, [room?.id]);

  // Opening the panel, or stepping to the confirm, puts focus on the first
  // thing you can press — Cancel, on the confirm, so Enter is never a removal.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [openId, confirming]);

  const close = (): void => {
    setOpenId(null);
    setConfirming(false);
  };
  const closeAndReturn = (id: string): void => {
    close();
    document.querySelector<HTMLButtonElement>(`[data-more="${CSS.escape(id)}"]`)?.focus();
  };
  const toggle = (id: string): void => {
    setConfirming(false);
    setOpenId((cur) => (cur === id ? null : id));
  };
  const remove = async (a: Agent): Promise<void> => {
    setRemoving(true);
    try {
      await onRemove(a);
    } finally {
      setRemoving(false);
      close();
    }
  };

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
            const open = openId === id;
            const block = open ? removalBlock(a, room, agents, busy) : null;
            return (
              <Fragment key={id}>
                <div className="arow">
                  <button className="mav" onClick={() => onEditAgent(a)} title={`Edit ${a.name}`}>
                    <Av agent={a} size={28} />
                    <span className={`sdot ${working ? "working" : "idle"}`} />
                  </button>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="aname" style={{ color: a.color }}>{a.name}</span>
                    <span className="astate">
                      {a.role}
                      {id === room.orchestratorId && " · leads"} · {working ? "writing" : "idle"}
                    </span>
                  </span>
                  <span className="aacts">
                    <button className="amsg" onClick={() => onMessage(a)} title={`Message ${a.name} directly — no planning, only ${a.name} answers`}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.2A8 8 0 1 1 21 12z" /></svg>
                    </button>
                    <button
                      className="amsg"
                      data-more={id}
                      aria-expanded={open}
                      aria-controls={`amenu-${id}`}
                      aria-label={`More for ${a.name}`}
                      title={`More for ${a.name}`}
                      onClick={() => toggle(id)}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
                    </button>
                  </span>
                </div>

                {open && block && (
                  <div
                    className="amenu"
                    id={`amenu-${id}`}
                    ref={panelRef}
                    role="group"
                    aria-label={`${a.name} in ${room.name}`}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") closeAndReturn(id);
                    }}
                  >
                    {confirming ? (
                      <>
                        <p className="amenu__ask">
                          Remove <b>{a.name}</b> from {room.name}?
                          {block.successor && (
                            <> <b>{block.successor.name}</b> will direct the room.</>
                          )}{" "}
                          Its messages stay in the transcript.
                        </p>
                        <div className="amenu__acts">
                          <button className="amenu__btn" onClick={() => setConfirming(false)} disabled={removing}>
                            Cancel
                          </button>
                          <button className="amenu__btn amenu__btn--danger" onClick={() => void remove(a)} disabled={removing}>
                            {removing ? "Removing…" : "Remove"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <button
                          className="amenu__item"
                          onClick={() => {
                            close();
                            onEditAgent(a);
                          }}
                        >
                          Edit agent
                        </button>
                        <hr className="amenu__rule" />
                        <button
                          className="amenu__item amenu__item--danger"
                          disabled={block.reason !== null}
                          onClick={() => setConfirming(true)}
                        >
                          Remove from room
                          {block.reason && <span className="amenu__why">{block.reason}</span>}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </Fragment>
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
