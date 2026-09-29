# Rubric

Score each dimension 1–5 per agent per cycle. Every score needs at least one cited excerpt (`room / msg-id / quote`). If you can't cite it, you can't score it — mark `N/A`.

| Score | Meaning |
|---|---|
| 5 | Exemplary — use as an example in other agents' skills |
| 4 | Solid, minor nits |
| 3 | Acceptable, one recurring weakness |
| 2 | Weak — pattern is hurting delivery |
| 1 | Broken — causing rework, delays, or false "done" |

---

## 1. Communication

**Good signals**
- Leads with the answer or decision, then detail.
- One message per update; no re-stating what the room already knows.
- Uses names, file paths, IDs — not "the thing", "that file".

**Bad signals**
- Filler openers ("Great question!", "Absolutely, I'll get right on that").
- Re-pasting full context that's already in the thread.
- Status updates with no new information ("still working on it").
- Long plans for work that's shorter than the plan.

**Metric:** words per task-closing message; % of messages with no new info.

---

## 2. Handoff

A handoff is good if the receiver can start without asking anything.

**Required fields in a handoff** (check each):
- [ ] Goal — what outcome, in one line
- [ ] Definition of done — how the receiver will know it's finished
- [ ] Inputs — files, links, prior decisions, constraints
- [ ] Out of scope — what not to touch
- [ ] Owner of the result — who reviews/accepts it

**Bad signals**
- Receiver's first reply is a clarifying question the sender could have answered.
- Work lands with the wrong agent and is handed off again (ping-pong).
- Receiver redoes work the sender already did because it wasn't passed along.

**Metric:** bounce rate = handoffs followed by a clarifying question ÷ total handoffs. Target < 15%.

---

## 3. Pace (effort proportional to task size)

Classify each task by size *before* looking at how long it took:

| Size | Examples | Expected turns to done | Expected agents involved |
|---|---|---|---|
| XS | rename, config value, one-line fix, answer a factual question | 1–2 | 1 |
| S | small feature, single-file bug, short doc | 2–5 | 1–2 |
| M | multi-file feature, integration, research + write-up | 5–15 | 2–3 |
| L | new subsystem, cross-agent project | 15+ | 3+ |

**Red flag:** actual turns > 2× the upper bound for its size, or more agents involved than the table allows.

**Common causes to check**
- Planning ceremony (plan → approval → re-plan) on XS/S work.
- Asking permission for reversible steps.
- Routing a one-agent task through the PM and back.
- Waiting on a reviewer for work that doesn't need review.
- Retrying a failing approach without changing it.

**Metric:** median turns-to-done by task size; % of tasks over 2× norm.

> Calibrate these norms to agora after 2 weeks of data. Store the calibrated table in `{MEMORY}/sle/norms.md` and use that instead. Changing the norms is Tier 3.

---

## 4. Evidence

"Done" must come with proof the reviewer can check without trusting the agent.

**Acceptable evidence by work type**
| Work | Evidence |
|---|---|
| Code change | diff or commit hash + test output (command and result) |
| Bug fix | reproduction before + passing check after |
| Deploy / infra | log line, health check, URL returning expected response |
| UI | screenshot or recording of the actual state |
| Research | sources with links; claims traceable to a source |
| Data / numbers | the query or script that produced them, and its output |
| Voice agent (e.g. call flow) | call transcript or recording ID + the expected vs actual behavior |

**Bad signals (each is an instance)**
- "Done", "fixed", "tested", "works now", "should be good" with no artifact.
- Tests claimed but no command or output shown.
- A reviewer approves by restating the claim ("Looks good, the fix handles the edge case") without running or opening anything.
- Evidence exists but doesn't match the claim (screenshot of a different page, test output for a different file).

**Severity:** a false "done" that reached the user or a client is **damaging** — act on one instance.

**Metric:** % of done-claims with valid evidence. Target ≥ 95%.

---

## 5. Escalation

**Good signals**
- Blocker raised within one failed attempt, with what was tried.
- Raised to the agent who can unblock it, not broadcast.
- Asks one specific question, not "any ideas?"

**Bad signals**
- Same error retried 3+ times with no change in approach.
- Long silence on an open task.
- Agent works around a blocker in a way that changes scope without telling the PM.

**Metric:** median time from first failure to escalation.

---

## Red flags (skip the ≥3 rule — act on first instance)

- A false "done" reached the user or a client.
- An agent edited files outside its scope and broke something.
- Secrets, credentials, or client data posted in a room that shouldn't have them.
- An agent overrode another agent's work without a handoff.
- An agent ignored an explicit human instruction.

Red flags go straight into the review report's top finding. Harness-level causes still need Tier 3 approval.
