---
name: self-improvement-loops
description: Use when the Agora harness itself is the thing being changed — the prompt builder, the mind stone, agent-edit.sh, agora-eval.sh, the skills layer, or a mechanic agent proposing edits to another agent — and whenever someone wants to let a loop rewrite part of its own scaffold. Covers the optimization ladder, the outside-the-loop invariant, two-split acceptance, the trace archive, and context evolution, each mapped onto Agora's real files and current gaps. Not for governing a single work run (that is the orchestrator's caps), not for writing eval tasks themselves.
---

# Self-improvement loops, applied to Agora

Agora already contains a self-improvement loop, a small one: a mechanic agent
edits another agent's prompt text through `scripts/agent-edit.sh`,
`scripts/agora-eval.sh` scores it in the Eval room, and the server commits the
result as `eval(<agent>): n/3`. This skill is the design rule set for that loop
and for every larger one that follows it. The general principles come from the
published RSI literature (Self-Harness, ACE, ADAS/AFlow, Darwin Gödel Machine,
Meta-Harness); the Agora sections say where we stand against each one as of
2026-09-10.

**The one rule that governs everything below:** the loop optimizes whatever
signal it is given, including the signal's weaknesses. Design assuming the
optimizer will find every gap between the metric and the intent.

## When to use this skill

- A mechanic (kooyapedia-writer, kooyapedia-mechanic, kooyapedia-critic, or a
  future forge from `templates/agents/mechanic.md`) is about to propose or apply
  an edit to an agent file or a room rules file.
- Changing `agora-eval.mjs`, `eval/tasks.json`, or the way results are read.
- Changing how the mind stone is compacted (`compactMindStone`,
  `MIND_STONE_SCHEMA` in `apps/server/src/orchestrator.ts`).
- Changing `buildSystemPrompt` in `apps/server/src/agents/registry.ts`, or the
  skills layer under `skills/`.
- Deciding which level a recurring failure should be fixed at.
- Diagnosing a loop that has gone flat (every eval 3/3), collapsed (a memory
  that shrank), or started gaming its score.

Do not use it for: the caps on a single work run (turns, wall clock, cost cap,
concurrency; those live in `config.ts` and are not an improvement loop),
writing the eval tasks themselves, or WhatsApp/notify behaviour.

## The optimization ladder

| Rung | Optimized object | Agora artifact | Who may change it today |
|---|---|---|---|
| 1 | Instruction prompts | `agents/*.md` Instructions + Personality, `_rules-<room>.md` body | mechanics via `agent-edit.sh`; Dominic by hand |
| 2 | Structured context | the mind stone (`mind_stones` table), per-goal `tailor` | the orchestrator, by full rewrite |
| 3 | Context mechanism | `buildSystemPrompt()`, the transcript window, `skills/` | Dominic only |
| 4 | Workflow graph | `PLAN_SCHEMA`, `DECISION_SCHEMA`, `readyWave()` | Dominic only |
| 5 | Harness code | `orchestrator.ts`, drivers, `agent-edit.ts` | Dominic only |
| 6 | Optimizer code | none yet | nobody |

Each rung up buys leverage and costs more per evaluation with a larger surface
for gaming. **Fix a recurring failure at the lowest rung that expresses the
fix.** An agent that keeps parroting "run npm start yourself" is a rung-1 or
rung-3 fix (the wrapper's error text, or a house rule), not a workflow change.
Only move up when failure clusters at the current rung persist across
candidates.

Agents stay on rung 1. Rungs 3 to 5 are locked by construction: no agent has
`apps/` in `add_dirs`, and `agent-edit.ts` refuses frontmatter, headings, and
name/role/description. Keep that boundary until the rung-1 loop has shown a
positive trajectory on a held-out split (see the readiness checklist).

## The loop is not the intelligence

Recursion amplifies base-model quality in both directions. With a strong model
the improver compounds; with a weaker one the same design degrades mean
performance across iterations. Two consequences for Agora:

- Before trusting a mechanic to run unattended, run a **capability validation**:
  a fixed number of proposals (say ten) against the held-out set, and count the
  loop net-negative if the trajectory declines. The mechanics currently run
  `claude-sonnet-5` at `effort: medium`; that may be below the threshold for
  this job. Measure, do not assume.
- Detect **stagnation disguised as stability.** A broken improver that returns
  its input unchanged looks like convergence in aggregate metrics. Alarm on
  empty or trivial diffs, not only on score drops. Every `eval(...)` commit to
  date reads 3/3; that is the signature of a saturated suite, not of a solved
  problem.

## The outside-the-loop invariant

The evaluator, its instrumentation, permission control, and budget enforcement
must live outside every surface the loop can modify. Every documented reward
hack broke this: agents removed the log markers a detector depended on,
monkey-patched scorers to return perfect scores, and hacked more often the more
of the checking code they could see.

Operational rules:

- Constraints stated in prompt text get evolved away. Enforce budgets,
  permissions, and sandbox boundaries in the runtime, never in a mutable prompt.
  Agora does this right for run caps (`config.ts`), grants (`effectiveAllow` +
  `--allowedTools`), and the edit boundary (`agent-edit.ts` re-verifies
  frontmatter bytes after every write).
- Hide the scoring implementation from the proposer. Expose scores and traces,
  not evaluator source.
- Treat a detected exploit as a failed candidate, never as a high score.

**Where Agora violates it today (fix these first):**

1. The proposer can write the evaluator. `kooyapedia-writer` holds `Write` and
   `Edit` with `/home/dominickooya/agora/eval` in `add_dirs`; the other two
   mechanics can read it. `eval/tasks.json` (the scorer) and
   `eval/results.jsonl` (the scoreboard) sit inside the editable surface.
2. The suite is saturated and has no held-out split. Three tasks
   (`short-answer`, `cite-and-hand`, `pass-when-nothing`), all visible, all
   passing on every recorded run.
3. Proposer and judge share a model family and the judge's tasks are visible.
   The regex grading (`mustContain` / `mustNotMatch`) is deterministic, which
   helps, but visibility invites edits that satisfy the three sentences and
   nothing else.

## Acceptance: measured, never rationale

Accept a self-modification only on evidence, using two splits:

- **held-in**: checks that the targeted weakness was resolved. Visible to the
  proposer.
- **held-out**: checks that nothing else regressed. The proposer never sees it.
  Refresh it if the loop runs long enough to overfit it.

Accept only when neither split regresses and at least one strictly improves,
with repeated evaluation because scoring is stochastic. Reject a candidate that
trades one split against the other even if the sum improves. Log every rejected
candidate with its evidence so the proposer stops rediscovering it.

```
def accept(candidate, baseline, held_in, held_out, repeats=3):
    d_in  = mean(candidate, held_in,  repeats) - mean(baseline, held_in,  repeats)
    d_out = mean(candidate, held_out, repeats) - mean(baseline, held_out, repeats)
    if d_in < 0 or d_out < 0:
        return False               # no regression on either split
    return max(d_in, d_out) > 0    # strict improvement on at least one
```

**Agora today:** an edit is "proposed, not applied: post the preview diff and
the before numbers", then Dominic reads the diff and says go. That is
acceptance by rationale. The live metrics split by `prompt_sha`
(`avgChars`, `p90Chars`, `pctOver900`, `markerHitPct`, `avgCostUsd`) are a
real held-in signal but nobody gates on them, they are noisy, and they are
never repeated. Refusals leave no record.

**Target shape:** `agent-edit.sh apply <id> <section> --eval <run-id>` refuses
unless that eval run shows held-in and held-out both non-regressing and one
strictly improving over three repeats. Refusals append to
`eval/rejected.jsonl` with the diff, the numbers, and the reason. Stage the
spend: check the live `prompt_sha` metrics first, run the full eval only if
those did not drop.

## The experience archive

Store every candidate as a directory with its source, scores, and raw execution
traces. Let the proposer navigate the archive with search tools instead of
stuffing history into its context. In direct ablation a proposer with raw-trace
access materially outperformed both a scores-only proposer and one fed
model-written summaries of the same traces; summaries recovered none of the
lost signal. Do not pre-summarize. Curate access paths, not content.

**Agora today:** every raw trace already exists in the `messages` table
(full bodies, `prompt_sha`, `cost_usd`, `duration_ms`, `act`, `refs`), plus
`goals` and `steps` with notes and stop reasons. The mechanic sees none of it;
it gets "before numbers" only, the weakest configuration in the ablation.

**Target layout** (written by the server when a goal closes, read-only to
agents through a lookup wrapper in the `ecc-lookup.sh` style):

```
eval/
  tasks/
    held-in.json            # visible to mechanics
    held-out/               # NOT in any add_dirs; only agora-eval.sh reads it
  runs/<goal-id>/
    system-prompt.txt       # what the agent was given, per turn
    transcript.md           # the flat transcript as rendered
    steps.json              # step status, notes, dependsOn, stop reason
    scores.json             # eval results if this was an eval run
    lineage.txt             # parent commit, diff summary, decision, evidence
  results.jsonl             # append-only, written only by agora-eval.sh
  rejected.jsonl            # append-only, written only by agent-edit apply
```

## Weakness mining

Cluster failed traces by a three-part signature, never by error string alone:

1. the verifier-level cause (what was rejected: length guard fired, marker
   missing, step marked blocked, progress review said blocked, cost cap hit,
   `capabilityCorrection` fired);
2. whether the agent's behaviour actually caused it;
3. the abstract mechanism the trace exposes (the reusable pattern).

Apply an addressability filter: drop clusters that reflect task difficulty or
model limits rather than harness defects. A timeout is a symptom shared by
unrelated mechanisms.

Agora's known clusters, mined by hand so far in session memory: "grant is live
but the prompt still says no access" (seen six times, now a house rule), "an
agent reports blocked on a capability it holds" (now `unblockHeld` and
`capabilityCorrection`), "error text written for Dominic gets parroted to
Dominic". Each of those was a rung-1 or rung-3 fix. The archive above is what
lets the mechanic find the next one instead of Dominic.

## Bounded proposal

Give the proposer exactly four inputs: the declared editable surfaces, the
mined failure patterns, records of passing behaviour that must be preserved,
and summaries of previously attempted edits. Require proposals to be minimal
(one section of one file), mutually distinct across parallel candidates, and
accompanied by an audit record naming the targeted pattern, expected effect,
and regression risk. `agent-edit.sh preview` already produces the diff; the
audit record is the missing half.

## Context evolution: the mind stone

Context playbooks that update themselves are the entry-level loop, with two
named failure modes. **Brevity bias**: optimizers collapse toward short generic
instructions and drop the domain heuristics that carried the value. **Context
collapse**: letting a model rewrite accumulated context wholesale can shrink it
below the no-adaptation baseline in a single step.

**Agora today:** `compactMindStone` asks the orchestrator to rewrite the whole
stone every 25 unfolded messages, post-run, fire-and-forget, errors swallowed.
That is the collapse pattern. The 2026-08-28 session log already called for
"a structured append of `[decision] / [measured] / [negative]` lines".

**Target pattern:**

- Represent the stone as itemized entries with stable ids, a kind
  (`decision`, `measured`, `negative`, `open`), and helpful/harmful counters.
- The compaction turn returns **deltas** (add, retire, bump), and deterministic
  code merges them. The model never rewrites the artifact.
- Deduplicate periodically by similarity.
- Gate the mechanism on feedback quality: with no reliable execution signal,
  self-managed context degrades below the static baseline.

One rung up, version the mechanism that produces context separately from the
context it produces: log a hash of the prompt builder and the chars per layer
on every turn next to `prompt_sha`, so a rung-3 change shows in the data.
Skills under `skills/` are the static half of that mechanism; the stone is the
dynamic half.

## Diversity

Loops collapse toward variants of the current best unless diversity is
engineered in. Keep an archive of every candidate that retains core capability;
never hill-climb only the latest version. Reject near-duplicate proposals
before paying for evaluation. Keep a route back to the seed. For Agora's
single-lineage prompt edits the minimum is: `rejected.jsonl` exists, `undo` is
used, and a proposal that matches a rejected diff is refused before eval.

## What belongs to Dominic

Humans move up the stack, not out of the loop. Reserve for human decision:
changes to the evaluator or the acceptance gate, expansion of editable surfaces
(any `tools` / `allow` / `add_dirs` change, which is already the safety line),
promotion of a discovered change to every room, and abandoning a line of work.
Models are poorly calibrated on when to abandon; preserved negative results are
the cheapest way to trim a successor's search. Make failed candidates first-class
artifacts.

## Loop-readiness checklist

Do not let a mechanic apply its own edits until every item holds.

| Requirement | Agora status |
|---|---|
| Fast, deterministic, automatable evaluator | holds (`agora-eval.mjs`, regex grading) |
| Held-out split the proposer never sees | missing |
| Budgets, permissions, sandbox enforced in the runtime | holds (`config.ts`, `--allowedTools`, `agent-edit.ts`) |
| Editable surfaces declared, locked regions re-verified | holds for agent files; `eval/` wrongly inside the surface |
| Archive with full lineage of diffs | partial (git commits with trailer); no traces, no rejections |
| Staged evaluation spend | missing (live metrics exist but are not a gate) |
| Capability validation on this task family | not run |
| Human decision points wired | holds (grants by button, evaluator by hand) |

## Build order

1. Move the evaluator outside the surface: drop `eval/` from every mechanic's
   `add_dirs`; split tasks into `held-in.json` and a `held-out/` dir no agent
   can reach; make `agora-eval.sh` the only writer of `results.jsonl`.
2. Add the two-split gate to `agent-edit.sh apply`, with `rejected.jsonl`.
3. Export finished goals to `eval/runs/<goal-id>/` and give mechanics a
   read-only lookup wrapper over it.
4. Rebuild the mind stone as itemized deltas with deterministic merge.
5. Log chars per layer and a builder hash on every turn.
6. Run the capability validation; enable unattended apply only if it passes.

Everything above stays on rung 1 for the agents. Rungs 3 to 5 remain Dominic's.

## Gotchas

- **Prompt constraints evolve away.** A safety rule in a seed prompt is
  decorative. Only runtime enforcement survives optimization pressure.
- **Visible scorers get gamed.** Expose scores and traces, never evaluator
  internals. Hacking frequency rises with visibility.
- **Self-reported success.** A loop that evaluates from the agent's own report
  inherits its optimism. Bind every reported number to a raw artifact (a score
  file, a log line) at write time. `eval(...) 3/3` commits are only as honest
  as the script that wrote them.
- **Monolithic rewrite collapse.** The mind stone today.
- **Hill-climbing the latest candidate.** One bad edit and the lineage is
  stuck; archive-based selection recovers many iterations later.
- **Stagnation disguised as stability.** Flat metrics with empty diffs.
- **Same-model generator and evaluator.** Shared blind spots; ground the judge
  in execution, not judgment, wherever possible.
- **Benchmark-shaped improvements.** Accepted edits encode the eval set and the
  executor model. Validate on a shift before promoting to every room, and
  re-run the search after a model upgrade instead of porting the result.
- **Cross-stage cherry-picking.** A reporting stage that can see a pool of
  scores picks the best one. Bind the reported score to the shipped candidate.

## Related skills

This skill is adapted from `self-improvement-loops` in
muratcankoylan/Agent-Skills-for-Context-Engineering. Its neighbours there,
which it defers to: `harness-engineering` (control surfaces of a single loop),
`evaluation` (evaluators and gates), `advanced-evaluation` (judge design),
`filesystem-context` (archive layout), `multi-agent-patterns`
(proposer/verifier separation), `context-optimization` (one-shot context
efficiency), `hosted-agents` (sandbox infrastructure).

In the ECC library, reachable read-only via
`bash /home/dominickooya/agora/scripts/ecc-lookup.sh show skills/<name>`:
`agent-harness-construction` and `agent-self-evaluation` (already cited by the
KooyaPedia mechanics), `eval-harness`, `continuous-learning-v2`.
