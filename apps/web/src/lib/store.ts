import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Agent,
  AgentMemory,
  AgentStatus,
  Goal,
  Message,
  MindStone,
  Room,
  RunState,
  ServerEvent,
} from "./types.ts";

export interface Live {
  agentId: string;
  text: string;
  directedBy: string | null;
}

export interface AgoraState {
  connected: boolean;
  rooms: Room[];
  agents: Agent[];
  statuses: Record<string, AgentStatus>;
  messages: Message[];
  /** Newest first. The active one, if any, is the run's current plan. */
  goals: Goal[];
  run: RunState | null;
  /** The selected room's compacted memory. null until it has been compacted once. */
  mindStone: MindStone | null;
  /** Per-agent lifetime volume in the selected room — what sizes the gym figures. */
  memory: Record<string, AgentMemory>;
  /** Live runs across every room — for the activity board. */
  runs: RunState[];
  live: Live | null;
  notifyLive: boolean;
  /** claude | cursor | hybrid — drives the Create Agent model picker. */
  driver: string;
  agentModels: Array<{ id: string; label: string }>;
  effortEnabled: boolean;
  defaultModel: string;
  defaultEffort: string;
  error: string | null;
  /** Transient rate-limit flash for the current room. */
  rateLimit: string | null;
}

export function useAgora(roomId: string | null) {
  const [state, setState] = useState<AgoraState>({
    connected: false,
    rooms: [],
    agents: [],
    statuses: {},
    messages: [],
    goals: [],
    run: null,
    mindStone: null,
    memory: {},
    runs: [],
    live: null,
    notifyLive: false,
    driver: "cursor",
    agentModels: [
      { id: "auto", label: "auto (Cursor routes)" },
      { id: "composer-2.5", label: "composer-2.5" },
      { id: "claude-sonnet-5-medium", label: "claude-sonnet-5-medium" },
      { id: "claude-opus-5-high", label: "claude-opus-5-high" },
    ],
    effortEnabled: false,
    defaultModel: "auto",
    defaultEffort: "n/a",
    error: null,
    rateLimit: null,
  });

  const socketRef = useRef<WebSocket | null>(null);
  // Read inside the socket handler without making it a dependency.
  const roomRef = useRef<string | null>(roomId);
  roomRef.current = roomId;

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = (): void => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${proto}//${location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        setState((s) => ({ ...s, connected: true, error: null }));
        // Resync from the server rather than trusting whatever we held while
        // disconnected — the run may have finished, or died with the process.
        const room = roomRef.current;
        if (room) {
          void (async () => {
            try {
              // Goals are resynced here too, not just messages. They were not,
              // and that is what made the Workflow view lie: a run killed while
              // the socket was down left the client holding a goal still marked
              // active, so its card read "Running" against a server that had
              // already closed it out. Stop was then correctly disabled, which
              // reads as a broken button rather than as nothing left to stop.
              const [msgRes, goalRes] = await Promise.all([
                fetch(`/api/rooms/${room}/messages`),
                fetch(`/api/rooms/${room}/goals`),
              ]);
              const data = (await msgRes.json()) as {
                messages: Message[];
                run: RunState | null;
                mindStone: MindStone | null;
                memory: Record<string, AgentMemory>;
              };
              const goalData = (await goalRes.json()) as { goals: Goal[] };
              setState((s) => ({
                ...s,
                messages: data.messages,
                goals: goalData.goals,
                run: data.run,
                mindStone: data.mindStone,
                memory: data.memory ?? {},
              }));
            } catch {
              /* the reconnect loop will try again */
            }
          })();
        }
      };

      socket.onclose = () => {
        // A dropped socket means we can no longer observe the run — NOT that it
        // is still going. Leaving `active` true made the run bar count for hours
        // against a run the server had already lost. Assume nothing.
        setState((s) => ({
          ...s,
          connected: false,
          live: null,
          run: s.run?.active
            ? {
                ...s.run,
                active: false,
                speaking: null,
                phase: null,
                phaseDetail: null,
                turnStartedAt: null,
                stopReason: "disconnected",
              }
            : s.run,
          runs: [],
        }));
        if (!closed) retry = setTimeout(connect, 1500);
      };

      socket.onmessage = (raw) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(String(raw.data)) as ServerEvent;
        } catch {
          return;
        }
        const current = roomRef.current;

        setState((s) => {
          switch (event.type) {
            case "hello":
              return {
                ...s,
                rooms: event.rooms,
                agents: event.agents,
                notifyLive: event.notifyLive,
                driver: event.driver ?? s.driver,
                agentModels: event.agentModels ?? s.agentModels,
                effortEnabled: event.effortEnabled ?? s.effortEnabled,
                defaultModel: event.defaultModel ?? s.defaultModel,
                defaultEffort: event.defaultEffort ?? s.defaultEffort,
              };
            case "agents":
              return { ...s, agents: event.agents };
            case "rooms":
              return { ...s, rooms: event.rooms };
            case "status":
              return { ...s, statuses: event.statuses };
            case "runs":
              return { ...s, runs: event.runs };
            case "message": {
              if (event.message.roomId !== current) return s;
              // Grow the figure in place rather than refetching: the server's
              // number is the baseline from room-select, and every message after
              // it is one we are holding right here. Only `agent` messages count,
              // matching what agentMemory() counts on the server — otherwise a
              // notice would fatten someone who never wrote it.
              const a = event.message.authorId;
              const grow =
                event.message.kind === "agent" && a !== "human"
                  ? {
                      ...s.memory,
                      [a]: {
                        messages: (s.memory[a]?.messages ?? 0) + 1,
                        chars: (s.memory[a]?.chars ?? 0) + event.message.text.length,
                      },
                    }
                  : s.memory;
              return {
                ...s,
                messages: [...s.messages, event.message],
                memory: grow,
                // The persisted message replaces whatever was streaming.
                live:
                  s.live && s.live.agentId === event.message.authorId ? null : s.live,
              };
            }
            case "turn_start":
              if (event.roomId !== current) return s;
              return {
                ...s,
                live: { agentId: event.agentId, text: "", directedBy: event.directedBy },
                statuses: { ...s.statuses, [event.agentId]: "processing" },
              };
            case "delta":
              if (event.roomId !== current || !s.live) return s;
              return { ...s, live: { ...s.live, text: s.live.text + event.text } };
            case "turn_end":
              if (event.roomId !== current) return s;
              return {
                ...s,
                statuses: { ...s.statuses, [event.agentId]: "active" },
              };
            case "run":
              if (event.state.roomId !== current) return s;
              return {
                ...s,
                run: event.state,
                live: event.state.active ? s.live : null,
                rateLimit:
                  event.state.phase === "rate_limited"
                    ? (event.state.phaseDetail ?? "Rate limited")
                    : s.rateLimit,
              };
            case "mind_stone":
              if (event.roomId !== current) return s;
              return { ...s, mindStone: event.stone };
            case "message_update":
              if (event.message.roomId !== current) return s;
              return {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === event.message.id ? event.message : m,
                ),
              };
            case "goal": {
              if (event.goal.roomId !== current) return s;
              const rest = s.goals.filter((g) => g.id !== event.goal.id);
              return { ...s, goals: [event.goal, ...rest] };
            }
            case "rate_limit":
              if (event.roomId !== current) return s;
              return {
                ...s,
                rateLimit: event.detail.slice(0, 240),
                run: s.run
                  ? {
                      ...s.run,
                      phase: "rate_limited",
                      phaseDetail: event.detail.slice(0, 200),
                    }
                  : s.run,
              };
            case "error":
              if (event.roomId != null && event.roomId !== current) return s;
              return { ...s, error: event.detail };
            default:
              return s;
          }
        });
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
    };
  }, []);

  // Load history whenever the selected room changes.
  useEffect(() => {
    if (!roomId) {
      setState((s) => ({
        ...s,
        messages: [],
        goals: [],
        run: null,
        mindStone: null,
        memory: {},
        live: null,
        error: null,
        rateLimit: null,
      }));
      return;
    }
    let cancelled = false;
    void (async () => {
      const [msgRes, goalRes] = await Promise.all([
        fetch(`/api/rooms/${roomId}/messages`),
        fetch(`/api/rooms/${roomId}/goals`),
      ]);
      const data = (await msgRes.json()) as {
        messages: Message[];
        run: RunState | null;
        mindStone: MindStone | null;
        memory: Record<string, AgentMemory>;
      };
      const goalData = (await goalRes.json()) as { goals: Goal[] };
      if (cancelled) return;
      setState((s) => ({
        ...s,
        messages: data.messages,
        goals: goalData.goals,
        run: data.run,
        mindStone: data.mindStone,
        memory: data.memory ?? {},
        live: null,
        error: null,
        rateLimit: null,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const send = useCallback((payload: unknown): void => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }, []);

  const broadcast = useCallback(
    (text: string): void => {
      if (roomId) send({ type: "broadcast", roomId, text });
    },
    [roomId, send],
  );

  const stop = useCallback((): void => {
    if (roomId) send({ type: "stop", roomId });
  }, [roomId, send]);

  const answer = useCallback(
    (messageId: string, label: string): void => {
      if (roomId) send({ type: "answer", roomId, messageId, label });
    },
    [roomId, send],
  );

  const resume = useCallback(
    (goalId: string): void => {
      if (roomId) send({ type: "resume", roomId, goalId });
    },
    [roomId, send],
  );

  /** Force an immediate reconnect instead of waiting out the retry timer. */
  const reconnect = useCallback((): void => {
    const socket = socketRef.current;
    // Closing triggers the existing onclose handler, which schedules a retry.
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
  }, []);

  const clearError = useCallback((): void => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  const clearRateLimit = useCallback((): void => {
    setState((s) => ({ ...s, rateLimit: null }));
  }, []);

  /** The private thread with one agent — created on first open. Returns its room id. */
  const openDm = useCallback(async (agentId: string): Promise<string | null> => {
    const res = await fetch(`/api/dm/${encodeURIComponent(agentId)}`, { method: "POST" });
    if (!res.ok) return null;
    const data = (await res.json()) as { room: Room };
    setState((s) => (s.rooms.some((r) => r.id === data.room.id) ? s : { ...s, rooms: [...s.rooms, data.room] }));
    return data.room.id;
  }, []);

  const refreshRooms = useCallback(async (): Promise<void> => {
    const res = await fetch("/api/state");
    const data = (await res.json()) as {
      rooms: Room[];
      agents: Agent[];
      driver?: string;
      agentModels?: Array<{ id: string; label: string }>;
      effortEnabled?: boolean;
      defaultModel?: string;
      defaultEffort?: string;
    };
    setState((s) => ({
      ...s,
      rooms: data.rooms,
      agents: data.agents,
      driver: data.driver ?? s.driver,
      agentModels: data.agentModels ?? s.agentModels,
      effortEnabled: data.effortEnabled ?? s.effortEnabled,
      defaultModel: data.defaultModel ?? s.defaultModel,
      defaultEffort: data.defaultEffort ?? s.defaultEffort,
    }));
  }, []);

  /**
   * Take one agent out of a room. The server decides whether that is allowed —
   * a refusal (mid-run, last member, no one left to direct) lands in the error
   * banner rather than failing silently.
   */
  const removeMember = useCallback(async (targetRoomId: string, agentId: string): Promise<boolean> => {
    try {
      const res = await fetch(
        `/api/rooms/${encodeURIComponent(targetRoomId)}/members/${encodeURIComponent(agentId)}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => ({}))) as { room?: Room; error?: string };
      if (!res.ok || !data.room) {
        setState((s) => ({ ...s, error: data.error ?? `Could not remove ${agentId} (HTTP ${res.status}).` }));
        return false;
      }
      const updated = data.room;
      setState((s) => ({ ...s, rooms: s.rooms.map((r) => (r.id === updated.id ? updated : r)) }));
      return true;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, error: `Could not remove ${agentId}: ${detail}` }));
      return false;
    }
  }, []);

  return {
    state,
    openDm,
    removeMember,
    broadcast,
    stop,
    resume,
    answer,
    refreshRooms,
    reconnect,
    clearError,
    clearRateLimit,
  };
}
