# Phases 2–12

What landed after the Phase 0 inventory and the Phase 1 state machine.
Each phase below names the code, the check, and what it still does not do.

## Phase 2 — one extraction

`Semaphore` moved from `orchestrator.ts` to `apps/server/src/semaphore.ts`.
The orchestrator still owns the run loop. The cap is the same: one shared
limit, release is idempotent, a second acquire waits.

Not done: splitting planner, dispatcher, and review into their own files.
That is a larger move than this phase's "one low-risk module" rule allows.

## Phase 4 — drivers

`drivers/spawn.ts` starts the CLI in its own process group on Linux and
sends SIGTERM to that group on abort, so grandchildren die with the turn.
`drivers/outcome.ts` classifies spawn failure, non-zero exit, cancel,
timeout, and a missing result. Both CLI drivers attach that object to
`final`. `drivers/mock.ts` is the driver tests use. No OAuth session is
required for `src/harness.test.ts`.

Stdout and stderr stay separate: deltas come from stdout, and stderr is
only copied onto the failure object.

## Phase 5 — grants

`grants.ts` is the rule set:

- Prompt text returns no tools.
- A directory must sit inside an allow root.
- Agent edits are at most one folder deep and cannot climb with `..`.
- A grant change produces an audit record of added and removed entries.

`resolveGrant` uses `directoryAllowed` for the root check. The agent-edit
tool still enforces the same depth on the real filesystem.

Limitation: Cursor's own CLI config is still global. This module does not
grow a per-agent Cursor permission file.

## Phase 3 — events

`parseClientCommand` drops malformed WebSocket frames. `checkSequence`
names duplicates, rewinds, and gaps. Message order in the database is still
`messages.seq` plus the unique index. There is no second event bus.

## Phase 7 — recovery

Policy, in `recovery.ts`: resume a goal only if it was `active` when the
process came up and it still has an unfinished step. `index.ts` records
those ids before `reconcileOrphanedGoals` marks them stopped. Goals that
were already stopped are left alone.

This replaces the old intersection, which asked for goals that were already
stopped and therefore never resumed a crash.

## Phase 8 — caps

`evaluateCaps` in `policy.ts` is the shared check for turn budget, review
clock, review-round ceiling, and dollar cap. A cap at 80% logs
`cap_approaching`. A cap that has fired logs `cap_fired`. The loop still
stops the run the same way it did: cost seals `paused`, the round ceiling
seals `turn_cap`. A zero dollar cap stays off.

## Phase 6 — mind stone

`applyMindStoneUpdate` refuses an empty write when the stone already has
text, and it returns the previous text when a real write replaces it.
`saveMindStone` uses that and logs `mind_stone_conflict`. The stone is still
one document per room, not a list of typed facts.

## Phase 9 — WhatsApp

`relay.ts` classifies a broadcast as a new run, a status ask, a cancel, or
a context note. Cancel calls `stop`. Status does not start a run. An
optional `idempotencyKey` is ignored for ten minutes after the first copy.
`AGORA_RELAY_SENDERS`, when set, is the allowlist; when empty, the local
socket stays trusted, which is the previous behavior. `agora-ask.mjs` sends
`sender: "zenith"` and a key of room id plus the ask text.

A failed notify still returns a result object and does not throw into the
run. That part was already true.

## Phase 10 — diagnostics

`GET /api/rooms/:id/diagnostics` returns counts, the live stop reason, and
the last five lines with secrets redacted. The redaction covers `sk-` keys,
JWTs, and `password` / `token` / `api_key` assignments. It does not try to
explain why a run failed.

## Phase 11 — tests

`pnpm --filter @agora/server test` runs `lifecycle.test.ts` and
`harness.test.ts`. Typecheck remains `pnpm --filter @agora/server typecheck`
and `pnpm --filter @agora/web typecheck`. There is still no lint script.

Not covered by an automated test: a real Cursor login, a real WhatsApp
send, or a killed-process boot against `data/agora.db`.

## Phase 12 — replay, and what was left

`GET /api/rooms/:id/replay` returns the stored transcript in `seq` order
with `live: false` and `executesTools: false`. It never calls a driver.

The plan says to pick advanced features from real need, not to build all of
them. Experiment mode, approval gates, performance scores, and structured
artifacts are not built.
