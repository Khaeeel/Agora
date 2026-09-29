# Run state machine

Phase 1. The loop still branches on the existing `stopReason` strings. What
changed is that those strings are written in one function, classified, and
refused when the transition is illegal.

## Where it lives

| Piece | File |
|---|---|
| Statuses, kinds, transition rules | `apps/server/src/lifecycle.ts` |
| Tests | `apps/server/src/lifecycle.test.ts` |
| The only writers | `Orchestrator.setPhase`, `Orchestrator.seal` |

`setPhase` moves a live run. `seal` ends one. Nothing else assigns
`stopReason`.

## Statuses

Live, in the order a room actually uses them:

| Status | What it is |
|---|---|
| `queued` | Inbox item while this room already has a run. Not stored on `RunState`. Logged as `run_queued`. |
| `planning` | First turn of `start`, unless it is a resume |
| `deciding` | Orchestrator picking the next agent. Also the phase a resumed goal starts in |
| `waiting_slot` | Concurrency semaphore |
| `generating` | A specialist, or a direct `@agent` turn |
| `rate_limited` | Driver reported a limit |
| `reviewing` | Progress review. Replaces the old use of `deciding` for that turn |
| `compacting` | Mind-stone fold. Usually after the run object is already gone, so it often never lands on `RunState` |

Any live status may move to any other live status. That matches the loop,
which already jumps.

Terminal, and the legacy string kept on `RunState.stopReason`:

| Status | Kind | `stopReason` | Meaning |
|---|---|---|---|
| `completed` | `completed` | `done` | The run ended cleanly |
| `cancelled` | `user_cancelled` | `stopped` | Dominic pressed Stop |
| `timed_out` | `timeout` | `timeout` | Wall-clock cap |
| `paused` | `cap` (`cost`) | `paused` | Dollar cap. Not a failure |
| `capped` | `cap` (`rounds`) | `turn_cap` | Review-round ceiling. Not a failure |
| `blocked` | `model_blocked` | `blocked` | The review said the room cannot continue |
| `awaiting_access` | `awaiting_access` | `awaiting_access` | Waiting on an Allow button |
| `failed` | `driver_failure` | `orchestrator_error` | Decision turn returned no usable object |
| `failed` | `unhandled` | `error` | Thrown error that nobody else had already sealed |

`RunState.terminal` holds that record, including an optional `detail`.
`RunState.status` is the status column. `RunState.phase` stays the live
phase the run bar renders, and is cleared when the run goes inactive.

## Rules

1. The first terminal reason wins. A second `seal` logs `duplicate: true` and
   does not overwrite.
2. Stop is idempotent. The second Stop aborts again and, if the run is
   already `cancelled`, leaves it `cancelled`. If a timeout already sealed
   the run, Stop does not relabel it.
3. `seal("done")` after `failed` is rejected. The `finally` block only seals
   `done` when `terminal` is still null, so a thrown error cannot fall
   through to completed.
4. A finished run cannot move back to a live phase. `setPhase` logs the
   refusal and leaves the state alone.
5. Goal rows are unchanged: `closeGoal` still stores `done` only when
   `stopReason === "done"`, and `stopped` otherwise. Auto-resume still keys
   off the same strings.

## Logs

```text
{"event":"run_transition","room":"…","ok":true,"from":"planning","to":"deciding"}
{"event":"run_terminal","room":"…","ok":true,"duplicate":false,"from":"reviewing","to":"completed","stopReason":"done","kind":"completed"}
{"event":"run_queued","room":"…","waiting":1,"kind":"start"}
```

A refused transition has `"ok": false` and a `reason`.

## What this phase did not change

- No new stop strings. Resume, notify, and the transcript lines still read
  `done`, `stopped`, `timeout`, `paused`, `blocked`, `turn_cap`.
- Boot recovery is still the Phase 0 behavior. This module does not run
  until a process calls `start`.
- Cancellation still uses the run `AbortController`, which is what kills the
  CLI child. `seal` does not itself kill a process.
- The run bar gained a Reviewing label because `reviewing` is now a real
  phase. Nothing else in the layout changed.

## Checks

`pnpm --filter @agora/server test` runs `src/lifecycle.test.ts`.
`pnpm --filter @agora/server typecheck` and `pnpm --filter @agora/web typecheck`
cover the new fields.
