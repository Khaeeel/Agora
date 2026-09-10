import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";
import type {
  Goal,
  GoalStatus,
  Message,
  MessageKind,
  Choice,
  MindStone,
  Room,
  SpeechAct,
  Step,
  StepStatus,
} from "./types.ts";

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
    delivered   INTEGER,
    -- JSON array of {label, detail} when this message asks Dominic to choose.
    choices     TEXT,
    -- The label he picked. Null while the question is still open.
    answered_with TEXT
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

  -- The mind stone: one compacted memory per room.
  --
  -- Agents only ever see the last AGORA_TRANSCRIPT_WINDOW messages, so without
  -- this everything older is simply gone — a room re-learns the same facts and
  -- re-asks questions it already answered. This holds the durable residue:
  -- what was decided, what is true, what is blocked, what was rejected.
  --
  -- covered_to is the created_at of the newest message folded in, so a
  -- compaction only ever has to read what arrived since the last one.
  CREATE TABLE IF NOT EXISTS mind_stones (
    room_id     TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    covered_to  INTEGER NOT NULL,
    messages    INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    revisions   INTEGER NOT NULL DEFAULT 1
  );
`);

// Older databases predate these columns — add them in place rather than wipe
// data. `choices` holds the options attached to a question the room is asking
// Dominic; `answered_with` records which one he picked, so the buttons stop
// being clickable the moment the decision is made and stay legible afterwards
// as a record of what he chose.
{
  const cols = db
    .prepare(`PRAGMA table_info(messages)`)
    .all() as Array<{ name: string }>;
  const has = (n: string): boolean => cols.some((c) => c.name === n);
  if (!has("duration_ms")) db.exec(`ALTER TABLE messages ADD COLUMN duration_ms INTEGER`);
  if (!has("choices")) db.exec(`ALTER TABLE messages ADD COLUMN choices TEXT`);
  if (!has("answered_with")) db.exec(`ALTER TABLE messages ADD COLUMN answered_with TEXT`);

  // Per-room position. Backfilled in created_at order so existing rooms get the
  // same numbering they would have had all along, and `id` breaks ties because
  // two messages can genuinely share a millisecond.
  if (!has("seq")) {
    db.exec(`ALTER TABLE messages ADD COLUMN seq INTEGER`);
    db.exec(`
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY room_id ORDER BY created_at ASC, id ASC
        ) AS n
        FROM messages
      )
      UPDATE messages
         SET seq = (SELECT n FROM numbered WHERE numbered.id = messages.id)
       WHERE seq IS NULL
    `);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_room_seq
      ON messages (room_id, seq)
  `);

  // Which version of the L0 protocol produced this turn. Rows written before
  // the protocol existed stay NULL rather than claiming version 1 — they were
  // produced under the old prose and should not be read as conforming.
  if (!has("protocol_version")) {
    db.exec(`ALTER TABLE messages ADD COLUMN protocol_version INTEGER`);
  }

  // The three parsed markers.
  //
  // `act` is NOT called `kind`: this table's `kind` already means
  // human/agent/notice/notify/handoff/event, and overloading it would make two
  // unrelated axes share one column. `act` is the speech act — claim, question,
  // result or pass.
  //
  // All three stay NULL when a message did not carry the marker, which is what
  // makes the miss rate measurable instead of guessed at.
  if (!has("act")) db.exec(`ALTER TABLE messages ADD COLUMN act TEXT`);
  if (!has("refs")) db.exec(`ALTER TABLE messages ADD COLUMN refs TEXT`);
  if (!has("next_id")) db.exec(`ALTER TABLE messages ADD COLUMN next_id TEXT`);

  // Which exact system prompt produced this turn — see Message.promptSha.
  if (!has("prompt_sha")) db.exec(`ALTER TABLE messages ADD COLUMN prompt_sha TEXT`);

  // Which CLI produced the turn — see Message.driver. Dominic runs Cursor when the
  // Claude pool is spent and wants to see, per message, which one answered.
  if (!has("driver")) db.exec(`ALTER TABLE messages ADD COLUMN driver TEXT`);
}

// Per-goal tailoring of the agents working it — see Goal.tailor.
{
  const cols = db.prepare(`PRAGMA table_info(goals)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "tailor")) db.exec(`ALTER TABLE goals ADD COLUMN tailor TEXT`);
}

// Step dependencies — see Step.dependsOn. NULL on rows from before this column
// existed, which rowToStep reads as "after the previous step": exactly the
// one-at-a-time order those goals were planned under.
{
  const cols = db.prepare(`PRAGMA table_info(steps)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "depends_on")) db.exec(`ALTER TABLE steps ADD COLUMN depends_on TEXT`);
}

/**
 * Where each agent last spoke in each room.
 *
 * This is what splits a transcript into "you have seen this" and "this is new
 * since your turn". Kept per agent rather than per room because agents in the
 * same room speak at different times, and a shared marker would show one agent
 * messages it has already answered while hiding messages from another.
 *
 * An agent with no row here has never spoken: everything is new to it, which is
 * the correct reading for its first turn.
 */
{
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_reads (
      room_id         TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      last_spoken_seq INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (room_id, agent_id)
    )
  `);

  // Backfill from history while the table is still empty.
  //
  // Emptiness is the test, not whether the table was just created: the table
  // can exist from an earlier boot and still hold nothing, and a "did it exist"
  // guard would then skip this forever.
  //
  // Without the backfill every agent starts at seq 0, which reads as "you have
  // never spoken here" — so the first turn after this migration would present
  // the room's whole history as NEW. Trunks has 2,445 messages. An agent's own
  // last message already IS the marker; taking it from the transcript makes the
  // split correct from the first turn rather than after one wasted one.
  const empty = (db.prepare(`SELECT COUNT(*) AS n FROM agent_reads`).get() as { n: number }).n === 0;
  if (empty) {
    db.prepare(
      `INSERT INTO agent_reads (room_id, agent_id, last_spoken_seq, updated_at)
       SELECT room_id, author_id, MAX(seq), ?
         FROM messages
        WHERE kind = 'agent' AND author_id <> 'human'
        GROUP BY room_id, author_id`,
    ).run(Date.now());
  }
}

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
    seq: Number(r["seq"] ?? 0),
    authorId: String(r["author_id"]),
    kind: String(r["kind"]) as MessageKind,
    text: String(r["text"]),
    directedBy: r["directed_by"] == null ? null : String(r["directed_by"]),
    createdAt: Number(r["created_at"]),
    costUsd: r["cost_usd"] == null ? null : Number(r["cost_usd"]),
    durationMs: r["duration_ms"] == null ? null : Number(r["duration_ms"]),
    delivered: delivered == null ? null : Number(delivered) === 1,
    choices: r["choices"] == null ? null : (JSON.parse(String(r["choices"])) as Choice[]),
    answeredWith: r["answered_with"] == null ? null : String(r["answered_with"]),
    protocolVersion:
      r["protocol_version"] == null ? null : Number(r["protocol_version"]),
    act: r["act"] == null ? null : (String(r["act"]) as SpeechAct),
    refs: r["refs"] == null ? [] : (JSON.parse(String(r["refs"])) as number[]),
    nextId: r["next_id"] == null ? null : String(r["next_id"]),
    promptSha: r["prompt_sha"] == null ? null : String(r["prompt_sha"]),
    driver: r["driver"] == null ? null : String(r["driver"]),
  };
}

/**
 * Record which option Dominic picked.
 *
 * Returns null when the question is already answered, so a double-click — or
 * two browser tabs open on the same room — cannot start two runs from one
 * decision.
 */
export function answerChoice(messageId: string, label: string): Message | null {
  const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as
    | Record<string, unknown>
    | undefined;
  if (!row || row["choices"] == null || row["answered_with"] != null) return null;
  db.prepare(`UPDATE messages SET answered_with = ? WHERE id = ?`).run(label, messageId);
  const after = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId);
  return after ? rowToMessage(after as Record<string, unknown>) : null;
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

/** Replace a room's member list. The orchestrator must stay in it; callers check. */
export function setRoomMembers(roomId: string, members: string[]): Room | null {
  db.prepare(`UPDATE rooms SET members = ? WHERE id = ?`).run(JSON.stringify(members), roomId);
  return getRoom(roomId);
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

/** How much an agent has actually said in a room, over the room's whole life. */
export interface AgentMemory {
  messages: number;
  chars: number;
}

/**
 * Per-agent lifetime volume for one room — what the gym uses to size a figure.
 *
 * This has to come from the server. `listMessages` caps at 500, and Trunks is
 * already past 2,400: counting client-side from the loaded transcript would make
 * an agent SHRINK as the room grew past the window, which is backwards from what
 * the panel is meant to show.
 *
 * Only `kind = 'agent'` counts. Notices, notify receipts and the human's own
 * messages are not the agent's own output, and folding them in would credit
 * every agent for traffic none of them wrote.
 */
export function agentMemory(roomId: string): Record<string, AgentMemory> {
  const rows = db
    .prepare(
      `SELECT author_id, COUNT(*) AS messages, SUM(LENGTH(text)) AS chars
         FROM messages
        WHERE room_id = ? AND kind = 'agent' AND author_id <> 'human'
        GROUP BY author_id`,
    )
    .all(roomId) as Array<{ author_id: string; messages: number; chars: number | null }>;

  const out: Record<string, AgentMemory> = {};
  for (const r of rows) {
    out[r.author_id] = { messages: r.messages, chars: r.chars ?? 0 };
  }
  return out;
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
    dependsOn:
      r["depends_on"] == null
        ? Number(r["idx"]) > 0
          ? [Number(r["idx"]) - 1]
          : []
        : (JSON.parse(String(r["depends_on"])) as number[]),
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
    tailor: r["tailor"] == null ? null : (JSON.parse(String(r["tailor"])) as Goal["tailor"]),
    steps: listSteps(id),
  };
}

/** Attach (or clear) the per-agent tailoring for a goal. */
export function setGoalTailor(goalId: string, tailor: Goal["tailor"]): Goal | null {
  db.prepare(`UPDATE goals SET tailor = ? WHERE id = ?`).run(
    tailor && Object.keys(tailor).length ? JSON.stringify(tailor) : null,
    goalId,
  );
  return getGoal(goalId);
}

/**
 * Close out goals left `active` by a process that died mid-run.
 *
 * Runs live in memory, so a restart loses them — but the row on disk still says
 * "active", and the UI would show it Running forever. Called once at boot.
 * Returns how many were reconciled.
 */
/**
 * Everything the dashboard needs, in one pass.
 *
 * The brain visual puts one neuron per stored message, so this has to stay a
 * COUNT and a small sample — shipping every message across the wire to draw
 * dots would grow without bound and stall the page the day the transcript gets
 * long. `recent` is capped and exists only to seed the shape of the cloud.
 */
export interface Stats {
  rooms: Array<{
    id: string;
    name: string;
    members: string[];
    orchestratorId: string;
    messages: number;
  }>;
  /** Memory units per agent — what the neuron colours are weighted by. */
  perAgent: Array<{ authorId: string; messages: number }>;
  totalMessages: number;
  totalGoals: number;
  goalsDone: number;
  totalCostUsd: number;
  handoffs: number;
  /** Newest-first, capped. Author + room only; no bodies. */
  recent: Array<{ authorId: string; roomId: string; createdAt: number; kind: string }>;
}

export function getStats(recentLimit = 400): Stats {
  const rooms = listRooms().map((r) => {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM messages WHERE room_id = ?`)
      .get(r.id) as { n: number };
    return {
      id: r.id,
      name: r.name,
      members: r.members,
      orchestratorId: r.orchestratorId,
      messages: Number(row.n),
    };
  });

  const perAgent = (
    db
      .prepare(
        `SELECT author_id, COUNT(*) AS n FROM messages
         WHERE kind = 'agent' GROUP BY author_id ORDER BY n DESC`,
      )
      .all() as Array<{ author_id: string; n: number }>
  ).map((r) => ({ authorId: String(r.author_id), messages: Number(r.n) }));

  const one = (sql: string): number => {
    const r = db.prepare(sql).get() as { n: number | null };
    return Number(r?.n ?? 0);
  };

  const recent = (
    db
      .prepare(
        `SELECT author_id, room_id, created_at, kind FROM messages
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(recentLimit) as Array<{
      author_id: string;
      room_id: string;
      created_at: number;
      kind: string;
    }>
  ).map((r) => ({
    authorId: String(r.author_id),
    roomId: String(r.room_id),
    createdAt: Number(r.created_at),
    kind: String(r.kind),
  }));

  return {
    rooms,
    perAgent,
    totalMessages: one(`SELECT COUNT(*) AS n FROM messages`),
    totalGoals: one(`SELECT COUNT(*) AS n FROM goals`),
    goalsDone: one(`SELECT COUNT(*) AS n FROM goals WHERE status = 'done'`),
    totalCostUsd: one(`SELECT COALESCE(SUM(cost_usd), 0) AS n FROM goals`),
    handoffs: one(`SELECT COUNT(*) AS n FROM messages WHERE kind = 'handoff'`),
    recent,
  };
}

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

// ── mind stone ─────────────────────────────────────────────────────────────

export function getMindStone(roomId: string): MindStone | null {
  const r = db.prepare(`SELECT * FROM mind_stones WHERE room_id = ?`).get(roomId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    roomId: String(r["room_id"]),
    content: String(r["content"]),
    coveredTo: Number(r["covered_to"]),
    messages: Number(r["messages"]),
    updatedAt: Number(r["updated_at"]),
    revisions: Number(r["revisions"]),
  };
}

/** Messages a compaction has not folded in yet. */
export function unfoldedMessages(roomId: string): Message[] {
  const since = getMindStone(roomId)?.coveredTo ?? 0;
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE room_id = ? AND created_at > ? AND kind IN ('human','agent','handoff','notify')
       ORDER BY created_at ASC`,
    )
    .all(roomId, since);
  return rows.map((r) => rowToMessage(r as Record<string, unknown>));
}

export function saveMindStone(
  roomId: string,
  content: string,
  coveredTo: number,
  foldedIn: number,
): MindStone {
  const prev = getMindStone(roomId);
  db.prepare(
    `INSERT INTO mind_stones (room_id, content, covered_to, messages, updated_at, revisions)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET
       content = excluded.content,
       covered_to = excluded.covered_to,
       messages = excluded.messages,
       updated_at = excluded.updated_at,
       revisions = mind_stones.revisions + 1`,
  ).run(
    roomId,
    content,
    coveredTo,
    (prev?.messages ?? 0) + foldedIn,
    Date.now(),
    prev ? prev.revisions + 1 : 1,
  );
  return getMindStone(roomId)!;
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
  steps: Array<{ title: string; ownerId: string | null; dependsOn?: number[] }>;
}): Goal {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO goals (id, room_id, title, status, created_at, ended_at, cost_usd)
     VALUES (?, ?, ?, 'active', ?, NULL, 0)`,
  ).run(id, input.roomId, input.title, now);

  const insert = db.prepare(
    `INSERT INTO steps (id, goal_id, idx, title, owner_id, status, note, updated_at, depends_on)
     VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
  );
  input.steps.forEach((s, i) => {
    // Only earlier, distinct indices count; a step cannot wait on itself or
    // on something planned after it.
    const deps = [...new Set((s.dependsOn ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d < i))];
    insert.run(randomUUID(), id, i, s.title, s.ownerId, now, JSON.stringify(deps));
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
  // Only steps nobody ever started become "never reached". An ACTIVE step was
  // demonstrably reached — somebody was working on it when the run stopped —
  // and calling that skipped is a false red: it erased a completed measurement
  // from the board when a resumed run was stopped mid-step, which then got
  // reported upward as "abandoned at 0/3". It stays active; the goal's own
  // status already says the run did not finish.
  db.prepare(
    `UPDATE steps SET status = 'skipped', updated_at = ?
     WHERE goal_id = ? AND status = 'pending'`,
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

/**
 * Reopen a goal that ended short so the room can carry on with it.
 *
 * Steps marked `skipped` go back to `pending`: "never reached" is a statement
 * about a run that stopped, not about the step, and a resumed goal has to be
 * able to reach them. `done` and `blocked` are left exactly as they are —
 * resuming must never quietly un-finish real work, and a blocker the room hit
 * once is still the blocker until somebody clears it.
 */
/**
 * Goals that were closed by boot-time reconciliation and still have work in
 * them.
 *
 * `reconcileOrphanedGoals` runs before the server listens, so a goal killed by
 * a restart never reaches the orchestrator's `finally` block and never gets its
 * automatic retry. From the room's side that is indistinguishable from the work
 * silently stopping — which is exactly what it looked like.
 */
export function goalsAbandonedWithin(ms: number): Goal[] {
  const rows = db
    .prepare(
      `SELECT id FROM goals
       WHERE status = 'stopped' AND ended_at IS NOT NULL AND ended_at >= ?
       ORDER BY ended_at DESC`,
    )
    .all(Date.now() - ms) as Array<{ id: string }>;
  return rows
    .map((r) => getGoal(String(r.id)))
    .filter((g): g is Goal => g !== null && g.steps.some((st) => st.status !== "done"));
}

export function reopenGoal(goalId: string): Goal | null {
  const goal = getGoal(goalId);
  if (!goal) return null;
  const now = Date.now();
  db.prepare(
    `UPDATE steps SET status = 'pending', updated_at = ?
     WHERE goal_id = ? AND status = 'skipped'`,
  ).run(now, goalId);
  db.prepare(`UPDATE goals SET status = 'active', ended_at = NULL WHERE id = ?`).run(goalId);
  return getGoal(goalId);
}

export function addMessage(input: {
  roomId: string;
  authorId: string;
  kind: MessageKind;
  text: string;
  directedBy?: string | null;
  costUsd?: number | null;
  durationMs?: number | null;
  delivered?: boolean | null;
  choices?: Choice[] | null;
  /** Parsed markers, when the caller has them. See `parseMarkers()`. */
  act?: SpeechAct | null;
  refs?: number[];
  nextId?: string | null;
  promptSha?: string | null;
  driver?: string | null;
}): Message {
  // The server is the only writer (every path that starts work goes through the
  // WebSocket), so reading the high-water mark and inserting after it cannot
  // interleave with another writer. The unique index on (room_id, seq) is the
  // backstop if that ever stops being true.
  const top = db
    .prepare(`SELECT COALESCE(MAX(seq), 0) AS n FROM messages WHERE room_id = ?`)
    .get(input.roomId) as { n: number };

  const msg: Message = {
    id: randomUUID(),
    roomId: input.roomId,
    seq: Number(top.n) + 1,
    authorId: input.authorId,
    kind: input.kind,
    text: input.text,
    directedBy: input.directedBy ?? null,
    createdAt: Date.now(),
    costUsd: input.costUsd ?? null,
    durationMs: input.durationMs ?? null,
    delivered: input.delivered ?? null,
    choices: input.choices ?? null,
    answeredWith: null,
    protocolVersion: PROTOCOL_VERSION,
    act: input.act ?? null,
    refs: input.refs ?? [],
    nextId: input.nextId ?? null,
    promptSha: input.promptSha ?? null,
    driver: input.driver ?? null,
  };
  db.prepare(
    `INSERT INTO messages
       (id, room_id, seq, author_id, kind, text, directed_by, created_at, cost_usd, duration_ms, delivered, choices, protocol_version, act, refs, next_id, prompt_sha, driver)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.roomId,
    msg.seq,
    msg.authorId,
    msg.kind,
    msg.text,
    msg.directedBy,
    msg.createdAt,
    msg.costUsd,
    msg.durationMs,
    msg.delivered === null ? null : msg.delivered ? 1 : 0,
    msg.choices == null ? null : JSON.stringify(msg.choices),
    msg.protocolVersion,
    msg.act,
    msg.refs.length ? JSON.stringify(msg.refs) : null,
    msg.nextId,
    msg.promptSha,
    msg.driver,
  );
  return msg;
}

/**
 * The seq of an agent's own last message in a room, or 0 if it has never
 * spoken. Everything above this is what arrived since its turn.
 */
export function getLastSpokenSeq(roomId: string, agentId: string): number {
  const row = db
    .prepare(`SELECT last_spoken_seq AS n FROM agent_reads WHERE room_id = ? AND agent_id = ?`)
    .get(roomId, agentId) as { n: number } | undefined;
  return row ? Number(row.n) : 0;
}

/**
 * Move an agent's marker forward. Never backward: a replayed or out-of-order
 * write must not re-show an agent messages it has already answered, which would
 * put it in a loop replying to the same thread.
 */
export function setLastSpokenSeq(roomId: string, agentId: string, seq: number): void {
  db.prepare(
    `INSERT INTO agent_reads (room_id, agent_id, last_spoken_seq, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (room_id, agent_id) DO UPDATE SET
       last_spoken_seq = MAX(last_spoken_seq, excluded.last_spoken_seq),
       updated_at      = excluded.updated_at`,
  ).run(roomId, agentId, seq, Date.now());
}

/** Every agent's marker in a room — for the roster view and for diagnostics. */
export function listLastSpokenSeqs(roomId: string): Map<string, number> {
  const rows = db
    .prepare(`SELECT agent_id, last_spoken_seq FROM agent_reads WHERE room_id = ?`)
    .all(roomId) as Array<{ agent_id: string; last_spoken_seq: number }>;
  return new Map(rows.map((r) => [String(r.agent_id), Number(r.last_spoken_seq)]));
}
