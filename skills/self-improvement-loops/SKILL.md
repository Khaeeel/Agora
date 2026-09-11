---
name: self-improvement-loops
description: Use when the harness itself is the thing being changed — a prompt builder, a memory compaction, an agent-editing tool, an evaluator, a skills layer — or when an agent is about to propose or apply an edit to another agent's prompt. Not for governing a single work run, not for writing eval tasks.
---
# Steps

1. **Pick the rung.** Find the lowest level that can express the fix:
   instruction prompt, structured context, the mechanism that builds context,
   the workflow, the harness code, the optimizer. Fix a recurring failure at
   the lowest rung; move up only when failure clusters at the current rung
   persist across candidates.
2. **Put the evaluator outside the loop.** The scorer, its instrumentation,
   permission checks, and budgets must live where the loop cannot read or
   write them. Expose scores and traces to the proposer, never the scoring
   source.
3. **Declare the editable surfaces.** Name exactly which sections of which
   files a proposer may change. Everything else is locked, and the lock is
   re-verified byte for byte after every write.
4. **Keep two evaluation splits.** Held-in: visible, checks the targeted
   weakness was fixed. Held-out: hidden from the proposer, checks nothing else
   regressed. Refresh held-out if the loop runs long enough to overfit it.
5. **Archive candidates with raw traces.** One directory per candidate: the
   source, the scores, the full execution traces, the lineage (parent, diff,
   decision, evidence). Let the proposer search it with tools instead of
   loading it into context. Never pre-summarize the archive.
6. **Mine weaknesses by signature, not by error string.** Cluster failures by
   the verifier-level cause, whether the agent's behaviour caused it, and the
   reusable mechanism the trace exposes. Drop clusters that reflect task
   difficulty or model limits rather than harness defects.
7. **Bound each proposal.** Give the proposer four inputs: the editable
   surfaces, the mined patterns, the passing behaviours that must be
   preserved, and the record of previously attempted edits. Require one
   surface per proposal and an audit line: targeted pattern, expected effect,
   regression risk.
8. **Accept only on measurement.** Apply the two-split gate with repeated
   runs: no regression on either split and a strict improvement on at least
   one. Reject a candidate that trades one split against the other even if
   the sum improves. Never accept on the proposer's rationale.
9. **Log every rejection** with its diff and numbers, and refuse a proposal
   that matches a rejected one before spending evaluation budget.
10. **Evolve context by deltas, never by rewrite.** Represent accumulated
    context as itemized entries with stable ids and helpful/harmful counters.
    The model returns add/retire/bump deltas; deterministic code merges them.
    Gate the mechanism on feedback quality; without a reliable signal,
    self-managed context degrades below the static baseline.
11. **Validate capability before enabling recursion.** Run a fixed number of
    proposals against the held-out split; count the loop net-negative if the
    trajectory declines. Alarm on empty or trivial diffs, not only on score
    drops.
12. **Keep the human decisions human.** Evaluator changes, expansion of
    editable surfaces, promotion of a change to every room, and abandoning a
    line of work stay with the human. Make failed candidates first-class
    artifacts so a successor does not rediscover them.

# Rules

- Constraints stated in prompt text get evolved away. Enforce budgets,
  permissions, and sandbox boundaries in the runtime.
- A detected exploit of the scorer is a failed candidate, never a high score.
- Bind every reported number to a raw artifact at write time; a loop that
  evaluates from the agent's own report inherits its optimism.
- Evaluate at realistic context size, never in clean-room conditions.
- Re-run the search when the executor model changes; discovered harnesses do
  not transfer freely across base models.

# Anti-patterns

- A proposer with write access to the eval set or the scoreboard.
- A suite so small or so saturated that every run passes: stagnation
  disguised as stability.
- One model both proposing and judging on visible tasks.
- Monolithic rewrite of accumulated memory: context collapse.
- Hill-climbing only the latest candidate with no archive.
- A reporting stage that can see a pool of scores and picks the best one.
- Benchmark-shaped edits promoted without a distribution shift check.
