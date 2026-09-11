# self-improvement-loops — applied to Agora

Everything here is Agora-specific and is never injected into a prompt.
Adapted from `self-improvement-loops` in
muratcankoylan/Agent-Skills-for-Context-Engineering (cloned read-only at
`~/.openclaw/context-skills`).

## Agora's loop today

A mechanic agent (kooyapedia-writer, kooyapedia-mechanic, kooyapedia-critic,
or a forge from `templates/agents/mechanic.md`) edits another agent's
Instructions or Personality through `scripts/agent-edit.sh`;
`scripts/agora-eval.sh` runs `eval/tasks.json` in the Eval room; the server
commits `eval(<agent>): n/3`. Acceptance is Dominic reading a preview diff.

## The ladder, with Agora's artifacts

| Rung | Optimized object | Agora artifact | Who may change it |
|---|---|---|---|
| 1 | Instruction prompts | `agents/*.md` Instructions + Personality, `_rules-<room>.md` | mechanics via `agent-edit.sh`; Dominic |
| 2 | Structured context | the mind stone (`mind_stones` table), per-goal `tailor` | the orchestrator, by full rewrite |
| 3 | Context mechanism | `buildSystemPrompt()` in `agents/registry.ts`, the transcript window, `skills/` | Dominic only |
| 4 | Workflow | `PLAN_SCHEMA`, `DECISION_SCHEMA`, `readyWave()` | Dominic only |
| 5 | Harness code | `orchestrator.ts`, drivers, `tools/agent-edit.ts` | Dominic only |
| 6 | Optimizer | none | nobody |

Agents stay on rung 1. Rungs 3 to 5 are locked by construction: no agent has
`apps/` in `add_dirs`, and `agent-edit.ts` refuses frontmatter, headings, and
name/role/description.

## Where the invariant is broken (fix first)

1. `kooyapedia-writer` holds Write and Edit with `/home/dominickooya/agora/eval`
   in `add_dirs`; the other mechanics can read it. The scorer
   (`eval/tasks.json`) and the scoreboard (`eval/results.jsonl`) are inside the
   editable surface.
2. Three regex-graded tasks (`short-answer`, `cite-and-hand`,
   `pass-when-nothing`), all visible, all always passing. No held-out split.
3. Proposer and judge share a model family and the tasks are visible.

## What holds already

- Run caps in `config.ts`; grants through `effectiveAllow` and
  `--allowedTools`; the edit boundary re-verified byte for byte in
  `agent-edit.ts`.
- Lineage: one commit per edit with an `Agora-Edit:` trailer, and `undo`.
- Live metrics split by `prompt_sha` (`avgChars`, `p90Chars`, `pctOver900`,
  `markerHitPct`, `avgCostUsd`) exist but are not a gate.
- Grants by button, evaluator by hand: the human decision points are wired.

## The mind stone is the collapse pattern

`compactMindStone` asks the orchestrator to rewrite the whole stone every 25
unfolded messages, post-run, fire-and-forget, errors swallowed. The
2026-08-28 session log already asked for "a structured append of
`[decision] / [measured] / [negative]` lines". Target: itemized entries with
ids, kinds (decision, measured, negative, open), and counters; the compaction
turn returns deltas; deterministic merge.

## Readiness checklist, Agora status

| Requirement | Status |
|---|---|
| Fast deterministic evaluator | holds (`agora-eval.mjs`, regex grading) |
| Held-out split | missing |
| Budgets and permissions in the runtime | holds |
| Editable surfaces declared and re-verified | holds for agent files; `eval/` wrongly inside |
| Archive with lineage | partial: commits, no traces, no rejections |
| Staged evaluation spend | missing |
| Capability validation | not run (mechanics are sonnet, effort medium) |
| Human decision points | holds |

## Build order

1. Drop `eval/` from every mechanic's `add_dirs`; split tasks into
   `held-in.json` and a `held-out/` dir no agent can reach; make
   `agora-eval.sh` the only writer of `results.jsonl`.
2. `agent-edit.sh apply <id> <section> --eval <run-id>` with the two-split
   gate; refusals to `eval/rejected.jsonl`.
3. Export finished goals to `eval/runs/<goal-id>/` (system prompt,
   transcript, steps, scores, lineage) with a read-only lookup wrapper.
4. Rebuild the mind stone as itemized deltas with deterministic merge.
5. Log chars per layer and a builder hash on every turn next to `prompt_sha`.
6. Run the capability validation; enable unattended apply only if it passes.

## Known weakness clusters, mined by hand so far

"Grant is live but the prompt still says no access" (seen six times, now a
house rule); "agent reports blocked on a capability it holds" (now
`unblockHeld` and `capabilityCorrection`); "error text written for Dominic
gets parroted to Dominic". All rung-1 or rung-3 fixes.

## Related skills

In the ECC library (`scripts/ecc-lookup.sh show skills/<name>`):
`agent-harness-construction`, `agent-self-evaluation`, `eval-harness`,
`continuous-learning-v2`. In the context-skills clone: `harness-engineering`,
`evaluation`, `advanced-evaluation`, `filesystem-context`,
`multi-agent-patterns`, `context-optimization`.
