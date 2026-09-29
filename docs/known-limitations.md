# Known limitations

Current behavior and gaps, recorded before any refactor. These are
observations from the code as of Phase 0, not a fix list that was implemented.

## Tests that exist, and coverage that does not

There is no unit-test runner and no `*.test.ts` / `*.spec.ts` file.

What exists instead:

| Script | What it does | Safe for a baseline? |
|---|---|---|
| `pnpm --filter @agora/server typecheck` | `tsc --noEmit` | Yes. Ran clean in this phase. |
| `pnpm --filter @agora/web typecheck` | `tsc --noEmit` | Yes. Ran clean in this phase. |
| `pnpm smoke:driver` | Spawns real `claude -p` | No. Needs a Claude OAuth session. |
| `pnpm smoke:loop` | Real orchestrator run against the live DB | No. Spends a driver turn and writes a room. |
| `src/smoke/cursor.ts`, `cursor-plan.ts`, `cursor-structured.ts` | Real `cursor-agent` | No. Not wired as package scripts except by hand. |
| `scripts/harness-eval.mjs` | Scores historical transcripts | Read-only of git and the DB, but not a pass/fail suite for the harness code. |
| `scripts/e2e-ws.mjs` | WebSocket smoke | Needs a live server. Not run in this phase. |

Missing, relative to the later phases of the plan: protocol parsing tests,
transition tests, cap tests, permission tests, mock driver, restart tests,
relay tests. None of those modules exist yet.

## Run state is not durable

`RunState`, the abort controller, the inbox, auto-resume counts, spawn
counts, and the concurrency semaphore all die with the process. After a
restart the UI can show no live run while a goal row still says the work
mattered. Boot tries to paper over that; see the next item.

## Boot resume does not see the goals the crash interrupted

`index.ts` comments say it captures in-flight goals before reconciliation
rewrites them. The call is `goalsAbandonedWithin`, which selects
`status = 'stopped'` only. Goals that are still `active` when the process
dies are not in that set.

`reconcileOrphanedGoals` then marks every `active` goal `stopped` and its
`pending` / `active` steps `skipped`. The post-listen resume keeps only ids
that were in the pre-reconcile stopped set and are also stopped within the
last 60 seconds. A goal that was `active` at the crash fails that
intersection. It stays stopped until a person presses Resume.

Auto-resume inside a live `finally` is a different path and does work for
`timeout`, `blocked`, `turn_cap`, `error`, and `orchestrator_error` when the
board still has open steps. It does not run for a process that never reached
`finally`.

## Goal rows still collapse every ending

Phase 1 types the in-memory run (`docs/run-state-machine.md`). The goal row
is still only `active`, `done`, or `stopped`. A timeout, a user cancel, a
cost pause, and a driver failure all persist as `stopped` unless the board
was fully `done`. `stopReason` on the live run is now classified, and it is
gone when the process exits.

## Completion can still disagree with the board for one log line

`finally` defaults an empty `stopReason` to `done`, then `closeGoal` may
store `stopped` because steps remain. The transcript line uses the reason
string (`run finished`) even when the goal row is `stopped`. Auto-resume
then keys off the goal row, which is why work can continue after a "finished"
line. The two layers are intentionally different; they are easy to misread.

## Driver gaps

- Cursor has no `--system-prompt` and no `--json-schema`. System text is
  prepended. Structured turns are scraped from prose.
- Cursor permissions come from one global CLI config, not per-agent
  `--tools`. The driver uses `--mode` for the read-only boundary. See the
  comment block at the top of `drivers/cursor-cli.ts`.
- Both drivers pass `AbortSignal` into `spawn` and do not kill a process
  group. Grandchildren can outlive the turn.
- Spawn failure and non-zero exit become `DriverEvent` `final.isError` text.
  There is no shared error code enum.
- Stderr is kept (last 8 KB) and appended to error text. It is not a separate
  event.
- Concurrency is one semaphore inside `runTurn`. Anything that called
  `driver.run` directly would bypass it. Production does not.

## Protocol is recorded, not enforced

A turn with no `kind:` and no `@next:` is stored and shown. `missing` is
only a log line. Fast dispatch is off because the historical hit rate was
measured at zero when the flag was added. The length guard rewrites; it does
not refuse.

## Permissions

Grants live in agent frontmatter and are applied when the driver builds CLI
args, and again in `tools/agent-edit.ts` for writes under `agents/`. The
orchestrator can also `forge` and `applyAccess` when Dominic taps Allow.
Prompt text cannot by itself edit frontmatter except through that tool, and
the tool refuses paths outside the one-folder agent layout. This phase did
not re-test that boundary; Phase 5 is the security pass. WhatsApp inbound
uses the same `start` path once the relay has sent `broadcast`, with no
extra sender check on the server.

## Memory

One mind stone per room, overwritten on each compaction (`ON CONFLICT`
replace). No fact/decision/assumption types, no per-item source, no conflict
record. `revisions` increments. A failed compaction logs and drops that
fold; the run is already finished. Unvalidated agent prose becomes part of
the next compaction input.

## Persistence

SQLite WAL, `node:sqlite`. Schema changes are inline `ALTER TABLE` in
`db.ts`, not versioned migration files. No foreign keys, so deleting a room
by hand must clear `steps`, `goals`, `messages`, `mind_stones`, and
`agent_reads` or those rows dangle. Message insert allocates `seq` with
`MAX(seq)+1` and relies on a single writer plus a unique index.

## Notifications

Dry-run is the default (`AGORA_NOTIFY_DRY_RUN`). A missing JID is recorded
as an event, not a failed send. A real `openclaw` failure is a `notify` row
with `delivered: false` and a console error. Delivery status is a boolean,
not a provider id. Dedup is a per-room timestamp
(`AGORA_NOTIFY_MIN_INTERVAL_S`), and end-of-run reports pass `force: true`.

## Other behavior worth not "fixing" by accident

- UI is acceptable for this plan. Do not redesign it to expose these notes.
- `agents/_house-rules.md` is a stub. L0 is code.
- Room rename does not rename `agents/<slug>/`.
- The watchdog (`scripts/agora-watchdog.sh`) kills ports 8787 and 5183 when
  `/api/state` is not 200. A long typecheck does not trigger it; a hung
  server does.
- Cost figures depend on the CLI reporting usage. A driver that omits cost
  leaves `costUsd` null and the cap does not see that turn.
