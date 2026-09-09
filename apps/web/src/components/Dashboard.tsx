import { useEffect, useMemo, useState } from "react";
import type { Agent, RunState } from "../lib/types.ts";
import { AgentFleet } from "./AgentFleet.tsx";
import { Avatar } from "./bits.tsx";

interface Stats {
  rooms: Array<{
    id: string;
    name: string;
    members: string[];
    orchestratorId: string;
    messages: number;
  }>;
  perAgent: Array<{ authorId: string; messages: number }>;
  totalMessages: number;
  totalGoals: number;
  goalsDone: number;
  totalCostUsd: number;
  handoffs: number;
  recent: Array<{ authorId: string; roomId: string; createdAt: number; kind: string }>;
}

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function Dashboard({
  agents,
  runs,
  connected,
}: {
  agents: Map<string, Agent>;
  runs: RunState[];
  connected: boolean;
}) {
  const [stats, setStats] = useState<Stats | null>(null);

  // Poll rather than push: the numbers move on run boundaries, not per token,
  // and a socket event per message would be a lot of traffic for a counter.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch("/api/stats");
        const data = (await res.json()) as Stats;
        if (!cancelled) setStats(data);
      } catch {
        /* leave the last good numbers on screen */
      }
    };
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const activeRun = runs.find((r) => r.active) ?? null;
  const speakingId = activeRun?.speaking ?? null;
  const speaking = speakingId ? (agents.get(speakingId)?.name ?? null) : null;

  const rooms = stats?.rooms ?? [];
  const busiest = [...(stats?.perAgent ?? [])].slice(0, 6);

  const roster = useMemo(() => [...agents.values()], [agents]);
  const activeRooms = useMemo(
    () => new Set(runs.filter((r) => r.active).map((r) => r.roomId)),
    [runs],
  );
  const memories = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of stats?.perAgent ?? []) m.set(a.authorId, a.messages);
    return m;
  }, [stats]);

  return (
    <div className="dash">
      <section className="dash__hero">
        <div className="dash__readout">
          <div className="dash__state">
            {!connected
              ? "Disconnected"
              : activeRun
                ? `${speaking ?? "Someone"} is thinking`
                : "Idle"}
          </div>
          <div className="dash__memcount">
            {stats ? stats.totalMessages.toLocaleString() : "—"}
            <span className="dash__memlabel">memories held</span>
          </div>
          {stats !== null && stats.totalMessages === 0 && (
            <p className="dash__note">
              Nothing remembered yet. Set a goal in a room and the stones start
              filling — one mote of light per memory.
            </p>
          )}
        </div>

        <AgentFleet
          agents={roster}
          rooms={rooms}
          memories={memories}
          speaking={speakingId}
          activeRooms={activeRooms}
          connected={connected}
        />
      </section>

      <section className="dash__tiles">
        <Tile label="Rooms" value={rooms.length} />
        <Tile label="Agents" value={agents.size} />
        <Tile
          label="Running now"
          value={runs.filter((r) => r.active).length}
          accent={runs.some((r) => r.active)}
        />
        <Tile label="Goals" value={stats ? `${stats.goalsDone}/${stats.totalGoals}` : "—"} />
        <Tile label="Prompts handed over" value={stats?.handoffs ?? "—"} />
      </section>

      <section className="dash__cols">
        <div className="dash__panel">
          <h3 className="dash__h">Where the thinking happens</h3>
          {busiest.length === 0 ? (
            <p className="dash__empty">Nothing recorded yet.</p>
          ) : (
            <ul className="bars">
              {busiest.map((a) => {
                const agent = agents.get(a.authorId);
                const top = busiest[0]!.messages || 1;
                return (
                  <li className="bar" key={a.authorId}>
                    <Avatar agent={agent} size={22} />
                    <span className="bar__name">{agent?.name ?? a.authorId}</span>
                    <span className="bar__track">
                      <span
                        className="bar__fill"
                        style={{
                          width: `${(a.messages / top) * 100}%`,
                          background: agent?.color ?? "var(--muted)",
                        }}
                      />
                    </span>
                    <span className="bar__n">{a.messages}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="dash__panel">
          <h3 className="dash__h">Rooms</h3>
          {rooms.length === 0 ? (
            <p className="dash__empty">No rooms yet.</p>
          ) : (
            <ul className="roomstat">
              {rooms.map((r) => {
                const live = runs.find((x) => x.roomId === r.id && x.active);
                return (
                  <li key={r.id}>
                    <span className="roomstat__name">{r.name}</span>
                    <span className="roomstat__meta">
                      {r.members.length} agents · {r.messages} memories
                    </span>
                    {live && <span className="roomstat__live">running</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="dash__panel">
          <h3 className="dash__h">Latest activity</h3>
          {!stats || stats.recent.length === 0 ? (
            <p className="dash__empty">Quiet.</p>
          ) : (
            <ul className="recent">
              {stats.recent.slice(0, 12).map((m, i) => {
                const agent = agents.get(m.authorId);
                return (
                  <li key={i}>
                    <span
                      className="recent__dot"
                      style={{ background: agent?.color ?? "var(--muted)" }}
                    />
                    <span className="recent__who">
                      {agent?.name ?? (m.authorId === "human" ? "You" : m.authorId)}
                    </span>
                    <span className="recent__kind">{m.kind}</span>
                    <span className="recent__ago">{ago(m.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className={`tile${accent ? " tile--accent" : ""}`}>
      <div className="tile__value">{value}</div>
      <div className="tile__label">{label}</div>
    </div>
  );
}
