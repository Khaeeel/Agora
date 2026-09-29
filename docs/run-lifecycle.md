# Run lifecycle

How a run starts, what state it holds, and how it ends.

Phase 1 added the state machine in `docs/run-state-machine.md`. The sections
below are still the path through `start`. `stopReason` strings are the same;
they are now written only by `Orchestrator.seal`.

## Entry points

| Entry | Calls | Effect |
|---|---|---|
| WebSocket `broadcast` | `start(roomId, text)` | New human message, then a run |
| WebSocket `broadcast` starting with `@id` | `direct(roomId, id, text)` | One turn, no planner, no goal |
| WebSocket on a `dm:` room | `direct` | Same, target is the room name after `dm:` |
| WebSocket `answer` | `decideAccess` or `start(roomId, label)` | Button tap unblocks |
| WebSocket `resume` | `start(roomId, "", goalId)` | Reopens that goal, skips planning |
| WebSocket `stop` | `stop(roomId)` | Aborts the in-memory run |
| `scripts/agora-ask.mjs` | WebSocket `broadcast` | WhatsApp text becomes a human message |
| Boot in `index.ts` | `start(roomId, "", goal.id)` | Intended resume of a crash; see limitations |
| Auto-resume inside `start`'s `finally` | `start(roomId, "", goalId)` after 1.5s | Continues an unfinished board |

There is no `pause()` method. The string `"paused"` is a stop reason (cost
cap), not a resumable suspended run. `"awaiting_access"` is the other
voluntary wait: the run ends and sits until Dominic taps Allow.

`start` refuses to open a second run in a room that already has one. A new
human line during a run is posted immediately, then classified:

- status ask → `postStatus` (no model)
- question → `aside` (one side turn, does not touch the live phase)
- work, or an explicit resume → queued and drained when the run releases

## Live state

`RunState` in `types.ts` is in memory only (`Orchestrator.runs`, keyed by
room id). It is not a row.

| Field | Meaning |
|---|---|
| `active` | `true` from `runs.set` until `finally` |
| `phase` | `planning`, `deciding`, `waiting_slot`, `generating`, `rate_limited`, `compacting`, or `null` |
| `turn` | Specialist turns taken. Planning is turn 0 |
| `maxTurns` | Starts at `AGORA_MAX_TURNS` (12). A review that says continue extends it |
| `stopReason` | `null` while running; set before exit. See below |
| `goalId` | Set after a plan, or immediately on resume |
| `speaking` | Agent id of the turn in flight |
| `costUsd` | Sum of turn costs this run |
| `timeoutMs` | Copy of `AGORA_RUN_TIMEOUT_MS` at start |
| `driver` | `cursor-cli` or `claude-cli` for the turn in flight |

Goal status is separate and is what survives a restart:

- Goal: `active` | `done` | `stopped`
- Step: `pending` | `active` | `done` | `blocked` | `skipped`

## One run, from `start` to `finally`

1. If the room is already running, classify and return (see above).
2. Load room, roster, orchestrator. Missing room or orchestrator emits
   `error` and returns. No run object exists yet.
3. Optional blanket grant: a phrase matching `BLANKET` can grant the access
   the last unfinished goal asked for and resume that goal.
4. `resumeGoalId` calls `reopenGoal` (skipped steps go back to `pending`;
   `done` and `blocked` stay). Otherwise the human text is posted.
5. Create `AbortController` + `RunState`, store it, publish `run` / `runs`.
   Phase is `planning`, or `deciding` when resuming.
6. Arm the wall-clock timer (`AGORA_RUN_TIMEOUT_MS`, default 90 min). On
   fire: `stopReason = "timeout"`, abort.
7. If not resuming, one structured planning turn (`PLAN_SCHEMA`). A plan
   creates the goal and steps. An answer-only plan posts the reply and sets
   `stopReason = "done"` without a goal.
8. Loop while the run is not aborted:
   - Cost at or over `AGORA_GOAL_COST_CAP_USD` (default $5, `0` disables) →
     `paused`. Does not auto-resume.
   - Turn count or review clock (`AGORA_REVIEW_EVERY_MS`, default 10 min) →
     `reviewProgress`. Verdict `continue` extends `maxTurns`. `done` / `blocked`
     leave the loop. Round count at `AGORA_MAX_ROUNDS` (6) forces a stop
     (`turn_cap` when the review itself does not set a reason).
   - Otherwise one decision turn (`DECISION_SCHEMA`), then optional forge,
     notify, handoff, discussion (2–4 speakers), or `dispatchTo` for `next`.
   - `next` null triggers a final review before close.
   - Turn outcome `timed_out` continues the loop. `aborted` breaks it.
9. `catch`: if `stopReason` is still empty, set `error`. An abort is a stop,
   not a posted crash. Any other throw posts `Run failed: …` and emits `error`.
10. `finally` always runs:
    - `active = false`, phase cleared.
    - `stopReason` defaults to `done` if nobody set one.
    - `closeGoal`: only `stopReason === "done"` asks to close as `done`.
      `closeGoal` still derives the stored status from the steps, so a board
      with open steps can end `stopped` even when the reason string is `done`.
    - WhatsApp report, except for `blocked`, `awaiting_access`, and `paused`.
    - Run removed from the map. Mind-stone compaction starts after release
      and cannot fail the run.
    - Drain the inbox. If the inbox is empty and the goal is not `done` and
      the reason is not `stopped`, `awaiting_access`, or `paused`, auto-resume
      up to `AGORA_MAX_AUTO_RESUMES` (3).

## Stop reasons actually written

These are strings, not a union. Call sites:

| Reason | Who sets it | Auto-resume |
|---|---|---|
| `done` | planner answer-only, review `done`, `next` null with no goal, `direct` success, `finally` default | Only if `closeGoal` left the goal not `done` |
| `stopped` | `stop()` (user Stop) | Never |
| `timeout` | wall-clock timer | Yes, if the board is unfinished |
| `paused` | goal cost cap | Never |
| `awaiting_access` | access buttons posted | Never |
| `blocked` | review verdict `blocked` | Yes, until the resume cap |
| `turn_cap` | review-round ceiling | Yes, if the board is unfinished |
| `orchestrator_error` | decision turn threw | Yes, if the board is unfinished |
| `error` | `direct` failure, or `start`'s catch when nothing else was set | Yes, if the board is unfinished |

`direct` does not create a goal. Its `finally` publishes the run and deletes
it. Stop reasons there are `done` or `error`.

## Cancellation

`stop(roomId)` is idempotent in the only sense that matters: a second call
returns `false` and the socket emits `Nothing running.` The first call aborts
the controller. `runTurn` aborts its nested controller. `spawn` receives that
signal, so the CLI child is killed with the default Node signal behavior.
The `finally` block still closes the goal and may notify.

A turn timeout aborts only the turn. The run stays active.

## Boot and crash

`index.ts` does this before `listen`:

1. `goalsAbandonedWithin(15 min)` — goals already `stopped` in that window.
2. `reconcileOrphanedGoals` — every goal still `active` becomes `stopped`,
   and its `pending` / `active` steps become `skipped`.
3. After listen, resume goals that are in both the pre-reconcile 15-minute
   set and a fresh 60-second `goalsAbandonedWithin` query.

Goals that were `active` at the moment of the crash are not in step 1, so
step 3 does not resume them. They sit `stopped` with skipped steps until
someone presses Resume or the room is told to continue. That mismatch with
the comment in `index.ts` is recorded in `docs/known-limitations.md`.

## Hard limits and where they are enforced

All defaults live in `config.ts`. Enforcement is in the orchestrator unless
noted.

| Cap | Default | Enforced in |
|---|---|---|
| `AGORA_MAX_TURNS` | 12 | Review trigger; extended on `continue` |
| `AGORA_MAX_ROUNDS` | 6 | Review loop ceiling → `turn_cap` |
| `AGORA_MAX_AUTO_RESUMES` | 3 | `finally` auto-resume |
| `AGORA_REVIEW_EVERY_MS` | 10 min | Review trigger |
| `AGORA_RUN_TIMEOUT_MS` | 90 min | `setTimeout` in `start` → `timeout` |
| `AGORA_TURN_TIMEOUT_MS` | 5 min | `setTimeout` in `runTurn` |
| `AGORA_MAX_CONCURRENCY` | 2 | `Semaphore` around `driver.run` |
| `AGORA_GOAL_COST_CAP_USD` | 5 | Loop check → `paused` |
| `AGORA_TRANSCRIPT_WINDOW` | 40 messages | Prompt construction |
| `AGORA_MIND_STONE_EVERY` | 25 messages | Compaction skip threshold |
| `AGORA_MAX_SPAWNS_PER_GOAL` | 3 | `forge` |
| `AGORA_MAX_FORGED_PER_ROOM` | 12 | `forge` |
| `AGORA_NOTIFY_MIN_INTERVAL_S` | 60 | `notify.ts` rate map |
| `AGORA_LENGTH_GUARD` | on | `enforceLength` rewrite, not a hard truncate |
| One run per room | always | `runs` map |
| Reply word budget | 45 / 80, hard 900 chars | `protocol.ts` `REPLY_LIMITS` |
