import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { config, notifyIsLive } from "./config.ts";
import { createRoom, listGoals, listMessages, listRooms } from "./db.ts";
import { loadAgents, renderAgentFile, watchAgents, writeAgentFile } from "./agents/registry.ts";
import { Orchestrator } from "./orchestrator.ts";
import type { Agent, AgentStatus, ClientCommand, ServerEvent } from "./types.ts";

export async function buildServer() {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  let agents = loadAgents();
  const sockets = new Set<{ send(data: string): void }>();

  const broadcast: (event: ServerEvent) => void = (event) => {
    const payload = JSON.stringify(event);
    for (const s of sockets) {
      try {
        s.send(payload);
      } catch {
        sockets.delete(s);
      }
    }
  };

  const orchestrator = new Orchestrator(broadcast, () => agents);

  const stopWatching = watchAgents((next) => {
    agents = next;
    console.log(`[agents] reloaded (${agents.size})`);
    broadcast({ type: "agents", agents: [...agents.values()] });
  });
  app.addHook("onClose", async () => stopWatching());

  /** Live status per agent: whoever is speaking is "processing". */
  function statuses(): Record<string, AgentStatus> {
    const speaking = new Set<string>();
    for (const room of listRooms()) {
      const state = orchestrator.getState(room.id);
      if (state?.speaking) speaking.add(state.speaking);
    }
    const out: Record<string, AgentStatus> = {};
    for (const a of agents.values()) {
      out[a.id] = speaking.has(a.id) ? "processing" : "active";
    }
    return out;
  }

  // ---- REST ---------------------------------------------------------------

  app.get("/api/state", async () => ({
    rooms: listRooms(),
    agents: [...agents.values()],
    notifyLive: notifyIsLive(),
    notifyJid: config.notifyJid || null,
    statuses: statuses(),
  }));

  app.get<{ Params: { id: string } }>("/api/rooms/:id/messages", async (req) => ({
    messages: listMessages(req.params.id),
    run: orchestrator.getState(req.params.id),
  }));

  app.get<{ Params: { id: string } }>("/api/rooms/:id/goals", async (req) => ({
    goals: listGoals(req.params.id),
  }));

  app.post<{
    Body: { name?: string; topic?: string; members?: string[]; orchestratorId?: string };
  }>("/api/rooms", async (req, reply) => {
    const { name, topic, members, orchestratorId } = req.body ?? {};
    if (!name?.trim()) return reply.code(400).send({ error: "name is required" });
    const chosen = (members ?? []).filter((m) => agents.has(m));
    if (chosen.length === 0) {
      return reply.code(400).send({ error: "pick at least one agent" });
    }
    const orch =
      orchestratorId && chosen.includes(orchestratorId)
        ? orchestratorId
        : (chosen.find((id) => agents.get(id)?.orchestrator) ?? chosen[0]!);

    const room = createRoom({
      name: name.trim(),
      topic: topic?.trim() ?? "",
      members: chosen,
      orchestratorId: orch,
    });
    broadcast({ type: "rooms", rooms: listRooms() });
    return { room };
  });

  type AgentBody = {
    name?: string;
    role?: string;
    description?: string;
    instructions?: string;
    personality?: string;
    color?: string;
    model?: string;
    effort?: string;
    orchestrator?: boolean;
    tools?: string[];
    addDirs?: string[];
  };

  function normalize(body: AgentBody) {
    return {
      name: (body.name ?? "").trim(),
      role: (body.role ?? "Agent").trim(),
      description: body.description ?? "",
      instructions: body.instructions ?? "",
      personality: body.personality ?? "",
      color: body.color ?? "#7A6A5D",
      model: body.model ?? config.model,
      effort: body.effort ?? config.effort,
      orchestrator: body.orchestrator === true,
      tools: Array.isArray(body.tools) ? body.tools : [],
      addDirs: Array.isArray(body.addDirs) ? body.addDirs : [],
    };
  }

  /** Live preview of the .md the form will write. */
  app.post<{ Body: AgentBody }>("/api/agents/preview", async (req) => ({
    markdown: renderAgentFile(normalize(req.body ?? {})),
  }));

  app.post<{ Body: AgentBody }>("/api/agents", async (req, reply) => {
    const input = normalize(req.body ?? {});
    if (!input.name) return reply.code(400).send({ error: "name is required" });
    try {
      const id = writeAgentFile(input);
      agents = loadAgents(); // watcher will also fire; this makes it synchronous
      broadcast({ type: "agents", agents: [...agents.values()] });
      return { id, agent: agents.get(id) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const agent = agents.get(req.params.id);
    if (!agent) return reply.code(404).send({ error: "No such agent" });
    return { agent };
  });

  /** Edit an existing agent. The id (and therefore the file) never moves. */
  app.put<{ Params: { id: string }; Body: AgentBody }>(
    "/api/agents/:id",
    async (req, reply) => {
      const existing = agents.get(req.params.id);
      if (!existing) return reply.code(404).send({ error: "No such agent" });

      const input = normalize(req.body ?? {});
      if (!input.name) return reply.code(400).send({ error: "name is required" });

      const roomsUsingIt = listRooms().filter((r) => r.members.includes(existing.id));
      if (
        existing.orchestrator &&
        !input.orchestrator &&
        roomsUsingIt.some((r) => r.orchestratorId === existing.id)
      ) {
        return reply.code(400).send({
          error: `${existing.name} currently directs a room. Put another agent in charge there before removing its orchestrator role.`,
        });
      }

      try {
        writeAgentFile(input, existing.id);
        agents = loadAgents();
        broadcast({ type: "agents", agents: [...agents.values()] });
        return { id: existing.id, agent: agents.get(existing.id) };
      } catch (err) {
        return reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ---- WebSocket ----------------------------------------------------------

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(
      JSON.stringify({
        type: "hello",
        rooms: listRooms(),
        agents: [...agents.values()] as Agent[],
        notifyLive: notifyIsLive(),
      } satisfies ServerEvent),
    );
    socket.send(JSON.stringify({ type: "status", statuses: statuses() } satisfies ServerEvent));

    socket.on("message", (raw: Buffer) => {
      let cmd: ClientCommand;
      try {
        cmd = JSON.parse(raw.toString()) as ClientCommand;
      } catch {
        return;
      }

      if (cmd.type === "broadcast") {
        if (!cmd.text?.trim()) return;
        void orchestrator.start(cmd.roomId, cmd.text.trim());
      } else if (cmd.type === "stop") {
        if (!orchestrator.stop(cmd.roomId)) {
          broadcast({ type: "error", roomId: cmd.roomId, detail: "Nothing running." });
        }
      }
    });

    socket.on("close", () => sockets.delete(socket));
  });

  return app;
}
