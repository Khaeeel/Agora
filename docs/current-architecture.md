# Current architecture

Inventory of Agora as it exists. Written in Phase 0 of the improvement plan.
No production behavior was changed to produce this document.

## What this process is

Agora is a local multi-agent harness. The browser is the control plane. The
Fastify server owns the run loop. Each agent turn is one CLI child
(`cursor-agent` by default, `claude` when `AGORA_DRIVER` says so). Shared
memory is the room transcript plus one mind stone per room, both in SQLite
(`data/agora.db`).

```
browser (Vite :5183) ──WS/REST──► Fastify (:8787)
                                    ├─ Orchestrator (one file, apps/server/src/orchestrator.ts)
                                    ├─ Agent registry (agents/<room>/<id>.md + file watcher)
                                    ├─ Cursor / Claude CLI drivers
                                    └─ openclaw message send ──► WhatsApp
WhatsApp ── scripts/agora-ask.mjs ──┘   (inbound relay, a separate process)
```

## Module owners

| Responsibility | Owner | File |
|---|---|---|
| Process boot, seed room, orphan reconcile, boot resume | entry | `apps/server/src/index.ts` |
| HTTP + WebSocket | server | `apps/server/src/server.ts` |
| Plan, dispatch, review, caps, stop | orchestrator | `apps/server/src/orchestrator.ts` |
| Agent markdown load / write / forge / watch | registry | `apps/server/src/agents/registry.ts` |
| L0 protocol text, marker parse, length normalize | protocol | `apps/server/src/protocol.ts` |
| Cursor CLI child | driver | `apps/server/src/drivers/cursor-cli.ts` |
| Claude CLI child | driver | `apps/server/src/drivers/claude-cli.ts` |
| Driver contract | types | `apps/server/src/drivers/types.ts` |
| Rooms, messages, goals, steps, mind stone, reads | persistence | `apps/server/src/db.ts` |
| WhatsApp outbound | notify | `apps/server/src/notify.ts` |
| Agent file edits from the model | tool | `apps/server/src/tools/agent-edit.ts` |
| Env and hard caps | config | `apps/server/src/config.ts` |
| Shared TypeScript shapes | types | `apps/server/src/types.ts` |
| Model catalog shown in the form | models | `apps/server/src/agent-models.ts` |
| Inbound WhatsApp → broadcast | relay | `scripts/agora-ask.mjs` |
| Port watchdog | ops | `scripts/agora-watchdog.sh` |

The orchestrator is one class (`Orchestrator`) of roughly four thousand lines.
It is the coordinator and also holds the business logic. Phase 2 is the
extraction; this phase only names the boundaries.

## Orchestrator responsibilities (still inside one class)

| Boundary | Methods (current) |
|---|---|
| Run controller | `start`, `stop`, `isRunning`, `getState`, `listRuns`, `direct` |
| Inbox while a run is live | `enqueue`, `drainInbox`, `aside`, `postStatus` |
| Planner | `start` planning branch, `PLAN_SCHEMA` |
| Goal and step manager | `readySteps`, calls into `db.ts` (`createGoal`, `updateStep`, `closeGoal`, `reopenGoal`) |
| Dispatcher | `dispatchTo`, `resolveNext`, `pickResponder` |
| Agent execution | `runTurn`, `enforceLength` |
| Parallel wave / discussion | `runDiscussion` |
| Review | `reviewProgress`, `PROGRESS_SCHEMA` |
| Policy and caps | checks inside the `start` loop (turns, rounds, clock, cost, spawns) |
| Cancellation | `AbortController` per run, nested per turn |
| Event emission | `post`, `publishRun`, `setPhase`, `emit` |
| Memory | `compactMindStone`, `MIND_STONE_SCHEMA` |
| Grants at runtime | `resolveGrant`, `decideAccess`, `applyAccess`, `revokeTemp`, `forge` |
| Recovery | none inside the class; boot resume lives in `index.ts` |

## Where agent processes are spawned

Only the two drivers call `spawn`:

- `CursorCliDriver.run` → `spawn(config.cursorBin, …)` in `drivers/cursor-cli.ts`
- `ClaudeCliDriver.run` → `spawn(config.claudeBin, …)` in `drivers/claude-cli.ts`

`Orchestrator.runTurn` is the only production caller. It picks the driver
with `driverFor(phase)`:

- `AGORA_DRIVER=cursor` (default): every phase uses Cursor.
- `AGORA_DRIVER=claude`: every phase uses Claude.
- `AGORA_DRIVER=hybrid`: `generating` uses Cursor; planning, deciding, and
  compacting use Claude.

Smoke scripts (`src/smoke/driver.ts`, `cursor.ts`, `cursor-plan.ts`,
`cursor-structured.ts`) spawn the same drivers outside a room. They are not
on the request path.

`notify.ts` spawns `openclaw` via `execFile`, not an agent. `gitCommitFile`
in the orchestrator spawns `git` the same way. Those are not agent turns.

## Where agent processes are terminated

Neither driver calls `child.kill` itself. Both pass `signal: req.signal` to
`spawn`, so Node kills the child when that `AbortSignal` aborts.

Two signals exist:

1. **Run abort.** `Orchestrator.stop` sets `stopReason = "stopped"` and calls
   `run.abort.abort()`. The wall-clock timer in `start` does the same with
   `stopReason = "timeout"`.
2. **Turn abort.** `runTurn` creates a nested `AbortController`. It aborts
   when the run aborts, or when `AGORA_TURN_TIMEOUT_MS` fires. A turn timeout
   fails that turn (`timed_out`) and the loop continues. A run abort breaks
   the loop.

There is no process-group kill and no scan for orphaned grandchildren. If
`cursor-agent` or `claude` leaves its own children behind after the signal,
this process does not reap them.

## Database tables

No foreign keys. Relationships are by id columns only. Details and the
restart behavior are in `docs/run-lifecycle.md`. The event contract is in
`docs/event-map.md`.

| Table | Key | Holds |
|---|---|---|
| `rooms` | `id` | name, topic, members JSON, orchestrator id |
| `messages` | `id`, unique `(room_id, seq)` | transcript, markers, cost, driver, prompt sha |
| `goals` | `id` | title, `active\|done\|stopped`, handoff, verify, tailor JSON |
| `steps` | `id` | goal id, idx, owner, status, note, `depends_on` JSON |
| `mind_stones` | `room_id` | one compacted memory per room |
| `agent_reads` | `(room_id, agent_id)` | last seq that agent spoke |

## Prompt stack

Unchanged from the README. L0 is `protocolText()` in code
(`PROTOCOL_VERSION = 6`). L1 is agent frontmatter. L2 is
`agents/<room>/_room.md`. L3 is the agent body. L4 is optional skills. L5 is
the mind stone plus the transcript window.

## What this phase did not touch

Production TypeScript was not refactored. The only new files are these
`docs/` notes and the baseline report.
