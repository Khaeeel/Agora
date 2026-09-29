# Contract, evidence gate, verifier, receipt

Added 2026-09-28 on top of the Phase 0–12 work. Four pieces, one idea: a goal
closes as done only when someone who did not do the work has checked it
against what was promised, with evidence.

## What changed

| Piece | Where | What it does |
|---|---|---|
| Contract | `PLAN_SCHEMA` gains `doneWhen`, `constraints`, `approvals`; stored on `goals` | The planner writes two to five conditions that must ALL hold, each with how it will be shown. Outcomes, not activities. |
| Evidence gate | `gateStepReports` in `contract.ts`, called by `Orchestrator.applySteps` | A step reported `done` with no evidence (under 8 characters) is stored as `active` with a note, and the room gets a notice. Evidence is kept on `steps.evidence`. |
| Verifier | `Orchestrator.verifyGoal`, `VERIFY_SCHEMA`, `pickVerifier` | When a review says `done`, an agent who did not own a step (a critic-shaped role first, else any non-builder, else the orchestrator with an adversarial prompt) answers each condition `pass`, `fail` or `unverified` with cited evidence. Stored on `goals.verification`. |
| Receipt | `receiptSections` in `contract.ts`, called by `buildRunReport` | The WhatsApp and room report gains Verified / Not verified / Risks / Needs your go, built from the verdicts, not from the last agent message. |
| DB guard | `closeGoal` in `db.ts` | A goal with a contract closes as `done` only when every step is done AND the stored verification passed. Otherwise `stopped`, whatever the run's stop reason said. |
| Lessons | mind-stone compaction prompt | The stone is asked to keep a `Lessons` heading: failures this room hit and what to do differently. |

## The loop now

```
plan ──► contract (doneWhen, constraints, approvals) + steps
  │
  ▼
work ──► step done + evidence ──► gate ──► board   (no evidence: stays active, room told)
  │
  ▼
review says done ──► verifier (not a builder) ──► pass all? ──► seal done ──► receipt
                                                │
                                                └─ no ──► room continues on the FAIL / unverified conditions
                                                           second failure ──► seal blocked + receipt to WhatsApp
```

## Columns

| Table | Column | Shape |
|---|---|---|
| `goals` | `done_when` | `[{"text":"…","how":"…"}]` |
| `goals` | `constraints` | `["…"]` |
| `goals` | `approvals` | `["…"]` |
| `goals` | `verification` | `{"verifierId":"rene","at":1790000000000,"passed":false,"checks":[{"index":0,"verdict":"pass","evidence":"…"}],"risks":[],"approvals":[]}` |
| `steps` | `evidence` | text |

All NULL on rows from before; `rowToGoal` reads NULL as empty, so old goals
behave exactly as they did and skip the verifier.

## Limits and what it does not do

- Verification costs one extra turn per "done". A goal that fails twice ends
  `blocked` with the receipt; auto-resume may pick it up within its own cap,
  and the WhatsApp escalation is de-duplicated through `lastBlocker`.
- The verifier can only see what the room can see. A condition that needs
  production data or a device nobody here has comes back `unverified`, and the
  receipt says so. That is the honest answer, not a bug.
- Under the Cursor driver structured output is scraped from prose, as for
  every other schema turn. A verifier that returns no `checks` array leaves
  the goal open and says so.
- Nothing here classifies step-level repeated failures or adds a per-tool
  gateway; caps and driver outcomes (Phases 4 and 8) still bound the run.

## Checks

- `pnpm --filter @agora/server test` — `contract.test.ts` covers
  normalization, the evidence gate, verdict normalization, verifier choice,
  the contract text and the receipt.
- `pnpm --filter @agora/server typecheck` — clean.
- `pnpm --filter @agora/web typecheck` — one pre-existing error in
  `ComputerScene.tsx` (`import.meta.env`), unrelated.
