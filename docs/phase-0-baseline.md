# Phase 0 baseline

Date: 2026-09-22. Scope: inventory only. Production TypeScript was not
changed.

## Checks

| Check | Command | Result |
|---|---|---|
| Server typecheck | `pnpm --filter @agora/server typecheck` (`tsc --noEmit`) | Pass, exit 0 |
| Web typecheck | `pnpm --filter @agora/web typecheck` (`tsc --noEmit`) | Pass, exit 0 |
| Unit tests | none in the repo | Not run — there is no suite |
| `pnpm smoke:driver` | real Claude CLI | Not run — spends a live session and is outside an inventory |
| `pnpm smoke:loop` | real orchestrator against `data/agora.db` | Not run — writes a room and spends driver turns |
| Lint | no lint script in either package | Not run — nothing to invoke |

## Deliverables

| Plan item | File |
|---|---|
| Architecture inventory | `docs/current-architecture.md` |
| Run lifecycle | `docs/run-lifecycle.md` |
| Events, REST, protocol | `docs/event-map.md` |
| Limits, bugs, test gaps | `docs/known-limitations.md` |
| This report | `docs/phase-0-baseline.md` |

## Acceptance

- A run can be followed from WebSocket `broadcast` / `resume` / `stop` through
  `Orchestrator.start` to `finally`. Documented in `docs/run-lifecycle.md`.
- Orchestrator responsibilities have an owner method, even though they still
  share one class. Documented in `docs/current-architecture.md`.
- Behavior above was written from the current source, before any Phase 1 edit.
- Tests and gaps are listed in `docs/known-limitations.md`.

## Limitations of this phase

- Smoke and harness-eval were not executed, so this report does not claim a
  live driver or a historical score.
- Boot-resume behavior was read from `index.ts` and `db.ts`, not reproduced
  by killing a live run.
- No production code was instrumented. Logging already present (`markers`,
  `normalized`, boot lines) was left as it is.
