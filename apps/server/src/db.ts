import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";
import type { Goal, GoalStatus, Message, MessageKind, Room, Step, StepStatus } from "./types.ts";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS rooms (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    topic           TEXT NOT NULL DEFAULT '',
    members         TEXT NOT NULL DEFAULT '[]',
    orchestrator_id TEXT NOT NULL,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    room_id     TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    kind        TEXT NOT NULL,
    text        TEXT NOT NULL,
    directed_by TEXT,
    created_at  INTEGER NOT NULL,
    cost_usd    REAL,
    delivered   INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room
    ON messages (room_id, created_at);

  CREATE TABLE IF NOT EXISTS goals (
    id         TEXT PRIMARY KEY,
    room_id    TEXT NOT NULL,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    ended_at   INTEGER,
    cost_usd   REAL NOT NULL DEFAULT 0,
    -- The prompt Dominic pastes into Claude CLI. Agents never make the change;
    -- this block is the deliverable at the end of a goal.
    handoff    TEXT,
    -- Manual steps so he can see the bug himself rather than take it on trust.
    verify     TEXT
  );

  CREATE TABLE IF NOT EXISTS steps (
    id         TEXT PRIMARY KEY,
    goal_id    TEXT NOT NULL,
    idx        INTEGER NOT NULL,
    title      TEXT NOT NULL,
    owner_id   TEXT,
    status     TEXT NOT NULL,
    note       TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_goals_room ON goals (room_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_steps_goal ON steps (goal_id, idx);
`);

function rowToRoom(r: Record<string, unknown>): Room {
  return {
    id: String(r["id"]),
    name: String(r["name"]),
    topic: String(r["topic"] ?? ""),
    members: JSON.parse(String(r["members"] ?? "[]")) as string[],
    orchestratorId: String(r["orchestrator_id"]),
    createdAt: Number(r["created_at"]),
  };
}

function rowToMessage(r: Record<string, unknown>): Message {
  const delivered = r["delivered"];
  return {
    id: String(r["id"]),
    roomId: String(r["room_id"]),
    authorId: String(r["author_id"]),
    kind: String(r["kind"]) as MessageKind,
    text: String(r["text"]),
    directedBy: r["directed_by"] == null ? null : String(r["directed_by"]),
    createdAt: Number(r["created_at"]),
    costUsd: r["cost_usd"] == null ? null : Number(r["cost_usd"]),
    delivered: delivered == null ? null : Number(delivered) === 1,
  };
}

export function listRooms(): Room[] {
  const rows = db.prepare(`SELECT * FROM rooms ORDER BY created_at ASC`).all();
  return rows.map((r) => rowToRoom(r as Record<string, unknown>));
}

export function getRoom(id: string): Room | null {
  const row = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id);
  return row ? rowToRoom(row as Record<string, unknown>) : null;
}

export function createRoom(input: {
  name: string;
  topic?: string;
  members: string[];
  orchestratorId: string;
}): Room {
  const room: Room = {
    id: randomUUID(),
    name: input.name,
    topic: input.topic ?? "",
    members: input.members,
    orchestratorId: input.orchestratorId,
    createdAt: Date.now(),
  };
  db.prepare(
    `INSERT INTO rooms (id, name, topic, members, orchestrator_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    room.id,
    room.name,
    room.topic,
    JSON.stringify(room.members),
    room.orchestratorId,
    room.createdAt,
  );
  return room;
}

export function listMessages(roomId: string, limit = 500): Message[] {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM messages WHERE room_id = ?
         ORDER BY created_at DESC LIMIT ?
       ) ORDER BY created_at ASC`,
    )
    .all(roomId, limit);
  return rows.map((r) => rowToMessage(r as Record<string, unknown>));
}

// ── goals and steps ────────────────────────────────────────────────────────

function rowToStep(r: Record<string, unknown>): Step {
  return {
    id: String(r["id"]),
    goalId: String(r["goal_id"]),
    idx: Number(r["idx"]),
    title: String(r["title"]),
    ownerId: r["owner_id"] == null ? null : String(r["owner_id"]),
    status: String(r["status"]) as StepStatus,
    note: r["note"] == null ? null : String(r["note"]),
    updatedAt: Number(r["updated_at"]),
  };
}

function rowToGoal(r: Record<string, unknown>): Goal {
  const id = String(r["id"]);
  return {
    id,
    roomId: String(r["room_id"]),
    title: String(r["title"]),
    status: String(r["status"]) as GoalStatus,
    createdAt: Number(r["created_at"]),
    endedAt: r["ended_at"] == null ? null : Number(r["ended_at"]),
    costUsd: Number(r["cost_usd"] ?? 0),
    handoff: r["handoff"] == null ? null : String(r["handoff"]),
    verify: r["verify"] == null ? null : String(r["verify"]),
    steps: listSteps(id),
  };
}

/**
 * Close out goals left `active` by a process that died mid-run.
 *
 * Runs live in memory, so a restart loses them — but the row on disk still says
 * "active", and the UI would show it Running forever. Called once at boot.
 * Returns how many were reconciled.
 */
export function reconcileOrphanedGoals(): number {
  const rows = db.prepare(`SELECT id FROM goals WHERE status = 'active'`).all();
  for (const r of rows) {
    const id = String((r as Record<string, unknown>)["id"]);
    db.prepare(
      `UPDATE steps SET status = 'skipped', updated_at = ?
       WHERE goal_id = ? AND status IN ('pending','active')`,
    ).run(Date.now(), id);
    db.prepare(`UPDATE goals SET status = 'stopped', ended_at = ? WHERE id = ?`).run(
      Date.now(),
      id,
    );
  }
  return rows.length;
}

/** Store the paste-ready prompt, and the steps for seeing the bug by hand. */
export function setGoalHandoff(
  goalId: string,
  handoff: string | null,
  verify?: string | null,
): Goal | null {
  if (handoff != null) {
    db.prepare(`UPDATE goals SET handoff = ? WHERE id = ?`).run(handoff, goalId);
  }
  if (verify != null) {
    db.prepare(`UPDATE goals SET verify = ? WHERE id = ?`).run(verify, goalId);
  }
  return getGoal(goalId);
}

export function listSteps(goalId: string): Step[] {
  const rows = db.prepare(`SELECT * FROM steps WHERE goal_id = ? ORDER BY idx ASC`).all(goalId);
  return rows.map((r) => rowToStep(r as Record<string, unknown>));
}

export function listGoals(roomId: string, limit = 25): Goal[] {
  const rows = db
    .prepare(`SELECT * FROM goals WHERE room_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(roomId, limit);
  return rows.map((r) => rowToGoal(r as Record<string, unknown>));
}

export function getGoal(id: string): Goal | null {
  const row = db.prepare(`SELECT * FROM goals WHERE id = ?`).get(id);
  return row ? rowToGoal(row as Record<string, unknown>) : null;
}

export function createGoal(input: {
  roomId: string;
  title: string;
  steps: Array<{ title: string; ownerId: string | null }>;
}): Goal {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO goals (id, room_id, title, status, created_at, ended_at, cost_usd)
     VALUES (?, ?, ?, 'active', ?, NULL, 0)`,
  ).run(id, input.roomId, input.title, now);

  const insert = db.prepare(
    `INSERT INTO steps (id, goal_id, idx, title, owner_id, status, note, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?)`,
  );
  input.steps.forEach((s, i) => {
    insert.run(randomUUID(), id, i, s.title, s.ownerId, now);
  });

  return getGoal(id)!;
}

export function updateStep(
  goalId: string,
  idx: number,
  status: StepStatus,
  note?: string | null,
): Step | null {
  db.prepare(
    `UPDATE steps SET status = ?, note = COALESCE(?, note), updated_at = ?
     WHERE goal_id = ? AND idx = ?`,
  ).run(status, note ?? null, Date.now(), goalId, idx);
  const row = db.prepare(`SELECT * FROM steps WHERE goal_id = ? AND idx = ?`).get(goalId, idx);
  return row ? rowToStep(row as Record<string, unknown>) : null;
}

/**
 * Close a goal, deriving its real status from the steps rather than trusting the
 * run's stop reason.
 *
 * The orchestrator saying "done" only means it stopped assigning work — it does
 * NOT mean the plan was carried out. A goal that ends with blocked or unreached
 * steps is `stopped`, not `done`. Reporting otherwise is a false green, which is
 * the exact failure the house rules exist to prevent.
 */
export function closeGoal(
  goalId: string,
  requested: GoalStatus,
  costUsd: number,
): Goal | null {
  const now = Date.now();

  // A step being worked on when the orchestrator declared completion counts as
  // finished; everything still untouched was never reached.
  if (requested === "done") {
    db.prepare(
      `UPDATE steps SET status = 'done', updated_at = ?
       WHERE goal_id = ? AND status = 'active'`,
    ).run(now, goalId);
  }
  db.prepare(
    `UPDATE steps SET status = 'skipped', updated_at = ?
     WHERE goal_id = ? AND status IN ('pending','active')`,
  ).run(now, goalId);

  const steps = listSteps(goalId);
  const achieved = steps.length > 0 && steps.every((s) => s.status === "done");
  const status: GoalStatus = achieved ? "done" : "stopped";

  db.prepare(`UPDATE goals SET status = ?, ended_at = ?, cost_usd = ? WHERE id = ?`).run(
    status,
    now,
    costUsd,
    goalId,
  );
  return getGoal(goalId);
}

export function addMessage(input: {
  roomId: string;
  authorId: string;
  kind: MessageKind;
  text: string;
  directedBy?: string | null;
  costUsd?: number | null;
  delivered?: boolean | null;
}): Message {
  const msg: Message = {
    id: randomUUID(),
    roomId: input.roomId,
    authorId: input.authorId,
    kind: input.kind,
    text: input.text,
    directedBy: input.directedBy ?? null,
    createdAt: Date.now(),
    costUsd: input.costUsd ?? null,
    delivered: input.delivered ?? null,
  };
  db.prepare(
    `INSERT INTO messages
       (id, room_id, author_id, kind, text, directed_by, created_at, cost_usd, delivered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.roomId,
    msg.authorId,
    msg.kind,
    msg.text,
    msg.directedBy,
    msg.createdAt,
    msg.costUsd,
    msg.delivered === null ? null : msg.delivered ? 1 : 0,
  );
  return msg;
}
