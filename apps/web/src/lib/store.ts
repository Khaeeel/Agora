import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Agent,
  AgentStatus,
  Goal,
  Message,
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
  live: Live | null;
  notifyLive: boolean;
  error: string | null;
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
    live: null,
    notifyLive: false,
    error: null,
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
              const res = await fetch(`/api/rooms/${room}/messages`);
              const data = (await res.json()) as { messages: Message[]; run: RunState | null };
              setState((s) => ({ ...s, messages: data.messages, run: data.run }));
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
            ? { ...s.run, active: false, speaking: null, stopReason: "disconnected" }
            : s.run,
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
              };
            case "agents":
              return { ...s, agents: event.agents };
            case "rooms":
              return { ...s, rooms: event.rooms };
            case "status":
              return { ...s, statuses: event.statuses };
            case "message":
              if (event.message.roomId !== current) return s;
              return {
                ...s,
                messages: [...s.messages, event.message],
                // The persisted message replaces whatever was streaming.
                live:
                  s.live && s.live.agentId === event.message.authorId ? null : s.live,
              };
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
              };
            case "goal": {
              if (event.goal.roomId !== current) return s;
              const rest = s.goals.filter((g) => g.id !== event.goal.id);
              return { ...s, goals: [event.goal, ...rest] };
            }
            case "error":
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
      setState((s) => ({ ...s, messages: [], goals: [], run: null, live: null }));
      return;
    }
    let cancelled = false;
    void (async () => {
      const [msgRes, goalRes] = await Promise.all([
        fetch(`/api/rooms/${roomId}/messages`),
        fetch(`/api/rooms/${roomId}/goals`),
      ]);
      const data = (await msgRes.json()) as { messages: Message[]; run: RunState | null };
      const goalData = (await goalRes.json()) as { goals: Goal[] };
      if (cancelled) return;
      setState((s) => ({
        ...s,
        messages: data.messages,
        goals: goalData.goals,
        run: data.run,
        live: null,
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

  const refreshRooms = useCallback(async (): Promise<void> => {
    const res = await fetch("/api/state");
    const data = (await res.json()) as { rooms: Room[]; agents: Agent[] };
    setState((s) => ({ ...s, rooms: data.rooms, agents: data.agents }));
  }, []);

  return { state, broadcast, stop, refreshRooms };
}
