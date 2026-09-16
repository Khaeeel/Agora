import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { config, notifyIsLive } from "./config.ts";
import { agentModelsForDriver } from "./agent-models.ts";
import {
  agentMemory,
  answerChoice,
  createRoom,
  getMindStone,
  getStats,
  listGoals,
  listMessages,
  listRooms,
  removeRoomMember,
  setRoomMembers,
} from "./db.ts";
import {
  deleteAgentFile,
  loadAgents,
  renderAgentFile,
  watchAgents,
  writeAgentFile,
} from "./agents/registry.ts";
import { Orchestrator } from "./orchestrator.ts";
import type { Agent, AgentStatus, ClientCommand, ServerEvent } from "./types.ts";

export async function buildServer(): Promise<
  Awaited<ReturnType<typeof Fastify>> & { orchestrator: Orchestrator }
> {
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

  app.get("/api/state", async () => {
    const modelCatalog = agentModelsForDriver(config.driver);
    return {
      rooms: listRooms(),
      agents: [...agents.values()],
      notifyLive: notifyIsLive(),
      notifyJid: config.notifyJid || null,
      statuses: statuses(),
      driver: config.driver,
      agentModels: modelCatalog.models,
      effortEnabled: modelCatalog.effortEnabled,
      defaultModel: modelCatalog.defaultModel,
      defaultEffort: modelCatalog.defaultEffort,
    };
  });

  app.get<{ Params: { id: string } }>("/api/rooms/:id/messages", async (req) => ({
    messages: listMessages(req.params.id),
    run: orchestrator.getState(req.params.id),
    // Rides along with the transcript rather than sitting behind its own fetch:
    // the client needs both at the same moment, on room select.
    mindStone: getMindStone(req.params.id),
    // Same reasoning, and it must be server-side: the transcript above is capped
    // at 500 messages, so the panel cannot count this for itself.
    memory: agentMemory(req.params.id),
  }));

  app.get<{ Params: { id: string } }>("/api/rooms/:id/mind-stone", async (req) => ({
    stone: getMindStone(req.params.id),
  }));

  app.get<{ Params: { id: string } }>("/api/rooms/:id/goals", async (req) => ({
    goals: listGoals(req.params.id),
  }));

  app.get("/api/stats", async () => getStats());

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
    mcp?: string[];
    allow?: string[];
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
      mcp: Array.isArray(body.mcp) ? body.mcp : [],
      allow: Array.isArray(body.allow) ? body.allow : [],
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

  /**
   * Retire a forged agent. Hand-made agents are Dominic's files and stay
   * Dominic's to delete; this only cleans up what an orchestrator created.
   */
  app.delete<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const agent = agents.get(req.params.id);
    if (!agent) return reply.code(404).send({ error: "No such agent" });
    if (!agent.forgedBy) {
      return reply.code(400).send({ error: `${agent.name} was not forged; delete the file by hand.` });
    }
    for (const room of listRooms()) {
      if (room.orchestratorId === agent.id) {
        return reply.code(400).send({ error: `${agent.name} directs ${room.name}.` });
      }
      if (room.members.includes(agent.id)) {
        setRoomMembers(room.id, room.members.filter((m) => m !== agent.id));
      }
    }
    deleteAgentFile(agent.id);
    agents = loadAgents();
    broadcast({ type: "agents", agents: [...agents.values()] });
    broadcast({ type: "rooms", rooms: listRooms() });
    return { ok: true };
  });

  /** Replace a room's members. The orchestrator cannot be removed this way. */
  app.put<{ Params: { id: string }; Body: { members?: string[] } }>(
    "/api/rooms/:id/members",
    async (req, reply) => {
      const rooms = listRooms();
      const room = rooms.find((r) => r.id === req.params.id);
      if (!room) return reply.code(404).send({ error: "No such room" });
      const wanted = (req.body?.members ?? []).filter((m) => agents.has(m));
      if (!wanted.includes(room.orchestratorId)) wanted.unshift(room.orchestratorId);
      const updated = setRoomMembers(room.id, [...new Set(wanted)]);
      broadcast({ type: "rooms", rooms: listRooms() });
      return { room: updated };
    },
  );

  /**
   * Take one agent out of a room. Refused mid-run, since the loop may be about
   * to hand it a turn, and refused for the last member. Removing the agent that
   * directs the room hands it to the next member allowed to direct one. The
   * agent's messages stay in the transcript; only the roster changes.
   */
  app.delete<{ Params: { id: string; agentId: string } }>(
    "/api/rooms/:id/members/:agentId",
    async (req, reply) => {
      const room = listRooms().find((r) => r.id === req.params.id);
      if (!room) return reply.code(404).send({ error: "No such room" });
      const { agentId } = req.params;
      const name = agents.get(agentId)?.name ?? agentId;
      if (!room.members.includes(agentId)) {
        return reply.code(404).send({ error: `${name} is not in ${room.name}.` });
      }
      if (orchestrator.getState(room.id)?.active) {
        return reply.code(400).send({ error: `Stop the run in ${room.name} before removing ${name}.` });
      }
      const rest = room.members.filter((m) => m !== agentId);
      if (rest.length === 0) {
        return reply.code(400).send({ error: `${name} is the only agent in ${room.name}.` });
      }
      let director = room.orchestratorId;
      if (director === agentId) {
        const next = rest.find((m) => agents.get(m)?.orchestrator);
        if (!next) {
          return reply.code(400).send({
            error: `${name} directs ${room.name} and no other member can. Add an agent that can direct rooms first.`,
          });
        }
        director = next;
      }
      const updated = removeRoomMember(room.id, agentId, director);
      broadcast({ type: "rooms", rooms: listRooms() });
      return { room: updated };
    },
  );

  /**
   * The private thread with one agent: a hidden room named "dm:<id>" holding
   * only that agent. Created on first open, reused after. The UI keeps these
   * out of the crew list and sends into them as direct messages, so nothing
   * here plans, and nothing here reaches WhatsApp.
   */
  app.post<{ Params: { agentId: string } }>("/api/dm/:agentId", async (req, reply) => {
    const agent = agents.get(req.params.agentId);
    if (!agent) return reply.code(404).send({ error: "No such agent" });
    const name = `dm:${agent.id}`;
    const existing = listRooms().find((r) => r.name === name);
    if (existing) return { room: existing };
    const room = createRoom({ name, topic: `Private messages with ${agent.name}`, members: [agent.id], orchestratorId: agent.id });
    broadcast({ type: "rooms", rooms: listRooms() });
    return { room };
  });

  // ---- WebSocket ----------------------------------------------------------

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    const modelCatalog = agentModelsForDriver(config.driver);
    socket.send(
      JSON.stringify({
        type: "hello",
        rooms: listRooms(),
        agents: [...agents.values()] as Agent[],
        notifyLive: notifyIsLive(),
        driver: config.driver,
        agentModels: modelCatalog.models,
        effortEnabled: modelCatalog.effortEnabled,
        defaultModel: modelCatalog.defaultModel,
        defaultEffort: modelCatalog.defaultEffort,
      } satisfies ServerEvent),
    );
    socket.send(JSON.stringify({ type: "status", statuses: statuses() } satisfies ServerEvent));
    socket.send(
      JSON.stringify({ type: "runs", runs: orchestrator.listRuns() } satisfies ServerEvent),
    );

    socket.on("message", (raw: Buffer) => {
      let cmd: ClientCommand;
      try {
        cmd = JSON.parse(raw.toString()) as ClientCommand;
      } catch {
        return;
      }

      if (cmd.type === "broadcast") {
        if (!cmd.text?.trim()) return;
        // "@fury …" is a direct message to one agent: no planner, no goal.
        const dm = cmd.text.trim().match(/^@([a-z0-9][a-z0-9_-]*)\s+([\s\S]+)$/i);
        if (dm) {
          void orchestrator.direct(cmd.roomId, dm[1]!, dm[2]!.trim());
          return;
        }
        const dmRoom = listRooms().find((r) => r.id === cmd.roomId && r.name.startsWith("dm:"));
        if (dmRoom) {
          void orchestrator.direct(cmd.roomId, dmRoom.name.slice(3), cmd.text.trim());
          return;
        }
        void orchestrator.start(cmd.roomId, cmd.text.trim());
      } else if (cmd.type === "answer") {
        // Answering IS the unblocking instruction, so it goes in as a normal
        // human message — the planner already knows how to read the room's own
        // question above it. Nothing bespoke, and it reads correctly in the
        // transcript afterwards.
        const answered = answerChoice(cmd.messageId, cmd.label);
        if (!answered) {
          broadcast({
            type: "error",
            roomId: cmd.roomId,
            detail: "That decision was already made.",
          });
        } else {
          broadcast({ type: "message_update", message: answered });
          // An access button carries its grant; every other button is an answer.
          const picked = answered.choices?.find((c) => c.label === cmd.label);
          if (picked && "grant" in picked) {
            void orchestrator.decideAccess(cmd.roomId, picked.grant ?? null, cmd.label);
          } else {
            void orchestrator.start(cmd.roomId, cmd.label);
          }
        }
      } else if (cmd.type === "resume") {
        void orchestrator.start(cmd.roomId, "", cmd.goalId);
      } else if (cmd.type === "stop") {
        if (!orchestrator.stop(cmd.roomId)) {
          broadcast({ type: "error", roomId: cmd.roomId, detail: "Nothing running." });
        }
      }
    });

    socket.on("close", () => sockets.delete(socket));
  });

  // Exposed so boot-time recovery can resume goals the previous process was
  // still working on. Same object the WebSocket commands drive.
  return Object.assign(app, { orchestrator });
}
