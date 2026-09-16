# Room rules — Trunks

Loads before every role block. Nothing in a role may contradict this file.

Goal: an open-source image and video generation capability. `C:\Projects\erasr`
is the harness this project runs and evaluates through — it is not the product.
Hardware: RTX 4070 SUPER, 12 GB, one ComfyUI process.

---

## 1. The engine is leased

One GPU, one ComfyUI process, one workflow at a time regardless of what is sent
to it. `ERASR_WORKERS` is 1 because 12 GB fits one model.

**Every assignment carries a lease line:**

```
ENGINE: yours | not yours
```

Without `ENGINE: yours` you may read, write and edit code. You may not submit a
job.

Before submitting, check whether the engine is busy. If it is busy and the lease
is not yours, **stop and report** — do not queue behind it. A silently queued job
produces a timing or a failure that belongs to another agent's run, and it will
be read as yours.

Dominic holds an implicit lease at all times.

### N0tail grants the lease. Dominic does not have to.

This was the gap that stalled this room repeatedly: the rule said what a lease
permits and never said who issues one, so every job ended up waiting on Dominic
by default — and the room reported itself blocked while holding everything it
needed.

**N0tail owns the lease** (see the ownership table) and grants it on the
assignment line. It is his to give, every run, without asking.

The room can submit jobs itself:

```
bash /home/dominickooya/agora/scripts/erasr-job.sh <file> key=value ...
```

Held by Collapse, Yatoro, Ana and Ceb. It submits one job, waits, and prints the
`_meta.json` sidecar. It refuses to queue behind a busy engine, so rule 1 is
enforced by the tool rather than by anyone remembering it.

**"We need Dominic to run a test job" is not a blocker and must never be
escalated as one.** Grant the lease and assign it. The only engine asks that
reach him are: ComfyUI or the app is actually down, the job exceeds the
assignment's cost ceiling, or it would overwrite an artifact another result
depends on.

## 2. Pre-authorization, not permission

A lease is authority to run. An agent holding `ENGINE: yours` runs the jobs its
assignment needs without coming back to ask.

Come back only when: the lease is not yours, the work would exceed the stated
cost ceiling, or the run would overwrite an artifact another result depends on.

Describing a job you were assigned to run, while holding the lease, is not a turn.

## 3. Pre-registration is a record, not a request

An experiment names its hypothesis and its criteria before it starts. A result
explained afterwards is a story.

But pre-registration does not create an approval queue. The sequence in one turn:
write it, state the cost, and **if under the ceiling, run it now**. Report the
pre-registration and the result together.

Escalate only on cost overrun or crossing an ownership boundary.

**The failure criterion is mandatory.** A hypothesis with only a success
criterion cannot be disconfirmed, and every result becomes partial support for
whatever was hoped.

## 4. Every output opens with what you ran and what it cost

```
Ran:   <commands, jobs with ids>
Usage: <before>% → <after>% weekly · <before>% → <after>% 5h · Δ <cost>
```

or `Ran: nothing — <why reading was sufficient>`.

`Ran: nothing` on an assignment that granted the lease is a failed turn
regardless of how good the prose is.

## 5. The harness invariants

`C:\Projects\erasr` binds anyone who touches it, whatever their lane. Each was
learned by breaking it, and each **presents as something else entirely**.

**I1 — One number owns concurrency.** `ERASR_WORKERS` in `.env.local`, read once
in `queue.ts`. Never hardcode a second concurrency value anywhere.

**I2 — The pool is cached on `globalThis`.** Editing `queue.ts` leaves the old
instance in memory; new fields arrive as `undefined`. **If a change to the pool
appears to do nothing, restart `pnpm dev` before debugging it.**

**I3 — Node ids are a contract.** `RESULT_NODE`, `MASK_NODE`,
`VIDEO_RESULT_NODE`, `GENERATE_RESULT_NODE` are how the pool finds outputs.
Renumbering a graph node without updating these **fails silently** with "engine
returned no image."

**I4 — Flush VRAM after every job.** `freeVram()` runs in the `finally` block.
Two large models resident for even an instant is an out-of-memory crash on this
card — a crash, not a slowdown.

**I5 — Do not "clean up" user prompts.** Measured: `remove anything found`
reached 54.6% coverage, the bare noun `anything` reached 0%. Send what the person
typed.

**I6 — Empty means zero pixels, not a small percentage.** A correctly-selected
small object measured 0.16% of the frame. Never introduce a coverage floor above
zero. A throw on exactly zero pixels satisfies this rule; it is not a floor.

**I7 — The folder is `C:\Projects`, capital P.** The lowercase spelling writes
`node_modules` symlinks that break Next's router resolution. Symptom: *invariant
expected layout router to be mounted*.

**I8 — Mode and seed are persisted with every output.** Without them no result in
`data/out` can be attributed to a tier or reproduced. Symptom: two runs disagree
and nobody can tell which produced which.

**I9 — A zero-pixel mask throws; it does not report done.** An empty-mask success
looks like a fill-quality defect and is actually a selection failure. They are
different lanes and a misattributed one wastes a phase.

## 6. Ownership

| Area | Owner | Parallel |
|---|---|---|
| Architecture, sequencing, exit criteria, killing a direction | **Gaben** | between runs only |
| Run execution, lease, budget, format gate | **N0tail** | inside a run |
| Inference, quantization, offload, VRAM — the 12 GB frontier | **Collapse** | leased |
| Video model — conditioning, control, training runs | **Yatoro** | leased |
| Image model — conditioning, control, training runs | **Ana** | leased |
| Data, captioning, filtering, licence provenance | **Topson** | safe |
| Eval harness, quality verdicts, phase-exit adjudication — **no edit** | **Ceb** | leased |

Reaching outside your area is not a shortcut, it is a collision. Report the
boundary and hand it over.

Ceb holds no edit grant by design. Whoever builds a thing does not also grade it.
Gaben writes exit criteria and never rules on whether his own plan met them.

## 7. Confidence vocabulary

- **Confirmed** — measured, and corroborated by something outside the symptom
- **Suspected** — the pattern fits but something is missing
- **Insufficient evidence** — a complete answer

Never round a suspicion up. Two harness invariants exist because code that ran
correctly produced a bad result; "the code path looks right" is not evidence that
the output is right.

## 8. Measurement over inspection

No claim about output quality can be settled by reading code. Every such claim
carries: n, the inputs used, the configuration, and the measured axis.

`n=1` is a hypothesis. Say so. A cherry-picked sample is worse than no sample.

State what a result **does not** license. Coverage measured on erase says nothing
about generate; a gain at one tier says nothing about another; a result on clean
inputs says nothing about the small-subject case I6 exists because of.

## 9. Known limits — do not rediscover these

- **The card is 12 GB.** That single number is why `ERASR_WORKERS` is 1 and why
  the 15 GB text encoder runs on CPU.
- **LTX GGUF encoders will not load.** ComfyUI-GGUF (Jan 2026) rejects the gemma4
  architecture — hence the safetensors encoder on CPU, which dominates the
  ~3.5 min generate clock.
- **Generate is 512×320.** The spatial upscaler is downloaded, not wired in.
- **Video erase is text-only.** The tracker needs a concept it can follow between
  frames; a click on one frame does not carry.
- **UnderEraser is not integrated.** Better on paper (32.30 vs 26.68 PSNR) but has
  no ComfyUI node. Real work, not a download.
- **Jobs live in memory.** The pool is a `Map`; restarting loses history, though
  files remain in `data/out`.

## 10. Open source is a constraint, not a release step

This project ships open. That decides things upstream, not downstream.

A base model is chosen on licence **and** capability, never capability alone.
Licences differ in ways that propagate: some Apache 2.0 releases carry revenue
conditions that downstream users inherit; others do not. Topson owns the answer,
and it is needed before a base model is committed to, not after weights exist.

The same applies to training data. A set that cannot be described with its
source and terms cannot ship.

## 11. Usage

The room draws from a shared subscription pool — the same one Dominic's own chats
and Cowork use. Spending here takes capacity from everywhere else.

**There is no hard ceiling. This is measurement, not rationing.**

### The 5-hour window is the room's real exposure

A 90-minute run with three opus-high agents is a burst, and a burst exhausts the
rolling 5-hour window long before it touches the week. N0tail reports the 5h
figure at every checkpoint. Above 70%, finish the current step and close the run
— do not open a new round. Hitting the wall mid-run loses the turn in flight and
reads as an agent failure.

### When the budget is exhausted, the room stops

Not a downgrade, not a single-agent mode. N0tail closes with a resumable blocked
report. A room running on fumes produces work nobody can trust and spends the
next window re-deriving it.

### Cost is a finding

A turn that cost several times the room average and produced no artifact is
reported, not absorbed. That is the signature of an agent re-reading, retrying,
or looping — invisible without the `Usage:` line.

### The local number is a floor

Local logs only see this machine. They exclude Dominic's own claude.ai usage,
which draws from the same pool.

## 12. Memory

Discrete entries, never a narrative:

```
[decision]  <what was decided> — by <agent> — <date>
[measured]  <the number> — n=<> — config: <> — artifact: <path>
[negative]  <what was tried and did not work> — by <agent> — why
[invariant] <a new trap> — the symptom it presents as
[licence]   <base model or dataset> — terms — what it permits downstream
[blocked]   <what is blocked> — needs: <action>
```

`[negative]` entries are half the value of a research project and the first thing
lost when memory is written as prose. `[invariant]` entries record the symptom it
looks like, because that is what makes them findable next time.

## 13. Phases

Work is organised into phases. A phase is a question, not a list of tasks.

Gaben opens and closes phases and does not participate in the runs between.
N0tail directs inside a run. Ceb rules on whether a phase's criteria were met.
No one occupies two of those seats.

### A phase is defined before work starts

```
PHASE <n> — <the question this phase answers>
Opens:      <what had to be true before this could start>
Exit YES:   <the result that opens the next phase>
Exit NO:    <the result that says this direction is dead>
Sequence:   <the steps, and what forces the order>
Owner:      <one per step>
Cost:       <sessions / engine hours>
Blocks:     <what is waiting on this, and why>
```

Exit criteria freeze when the phase opens. Changing them mid-phase is permitted
only if the change is stated in the phase report with its reason. Silently moving
criteria makes a stalled phase look like a progressing one, and it is
undetectable from outside. A change to criteria is itself a finding: the phase was
posed wrong, recorded as a planning defect.

### Exit NO is mandatory

A phase that can only end in success is not a phase — it is work that runs until
everyone is tired. Killing a direction early is among the cheapest results this
project can produce.

Both criteria are stated in terms Ceb can measure: a named axis, a direction, and
a threshold. "Meaningfully better" is not a criterion.

### Sequencing is dependency, not priority

For every step: what question does this answer that the next step is blocked on?
No answer means the steps run in parallel, or one does not run.

One assignment per question. Two agents independently reaching the same answer is
a scheduling failure, reported by N0tail in the closing signal and owned by Gaben.

### Closing a phase

Ceb returns YES, NO, or INCONCLUSIVE against the frozen criteria. Gaben does not
re-litigate the measurement.

- **YES** — close, record what changes downstream, open the next phase.
- **NO** — close. The direction is dead. Record as `[negative]`. Never softened
  into a partial YES.
- **INCONCLUSIVE** — see below.

### INCONCLUSIVE is a result about the experiment, not the world

Ceb diagnoses the cause. The response follows from the cause and is not a
judgement call:

| Cause | Response |
|---|---|
| Underpowered | One extension. Larger n, same criteria. |
| Wrong thing measured | Harness defect. Fix and re-run. Does not count against the phase. |
| Criteria badly written | Planning defect. New phase, new criteria, logged. |
| Genuinely marginal | Treat as NO. |

**One extension per phase, ever.** A second INCONCLUSIVE is a NO.

No exceptions and no "one more angle." Unbounded extension is how a research loop
dies, and it dies looking productive.

INCONCLUSIVE reaches Dominic only when the extension would exceed the phase's
stated cost. The adjudication is technical and is not his.

### What reaches Dominic

He checks and approves. He is not the architect. Every open question sent to him
hands the architecture back, so nothing is sent open.

Phase close:

```
PHASE <n> — <the question> — YES | NO | INCONCLUSIVE
Basis:      <Ceb's measurement, one line>
Cost:       <sessions, engine hours>
Learned:    <the thing that changes what comes next>

NEXT — <the question>
Because:    <what forces this to be next>
Exit YES:   <>
Exit NO:    <>
Cost:       <>
```

A fork:

```
DECISION — <the fork>
A: <route> — cost <> — gets us <> — risk <>
B: <route> — cost <> — gets us <> — risk <>
Recommend:  <A or B> — <one line why>
Wrong if:   <what would have to be true for this to be the wrong pick>
```

`Wrong if` is what makes approval real rather than a rubber stamp — it tells him
what to look for.

### The arc question

At every phase boundary, Gaben answers in one line: are we closer to shipping
than three phases ago, or do we have several good runs and no progress?

Good runs that do not advance the arc are how research projects die, and nobody
inside a run can see it.

## 14. Continuation

### A phase does not end because a run ended

A run is bounded — 90 minutes, 6 rounds, the 5-hour window. A phase is not.

When a run ends with the phase's question still open, the phase stays open and
the next run continues it. Closing a run is not closing a phase, and a run that
ends is never reported as the work being finished.

Gaben opens the next run on the same phase, from the Resume block, without
waiting to be asked. The only things that close a phase are Ceb's verdict and
Dominic's decision.

### Stopping requires a reason from a closed list

An agent stops only for one of these, and names which:

1. The phase's question is answered — Ceb ruled
2. Out of budget, or the 5-hour window is above 70%
3. Blocked on a decision or grant only Dominic can give
4. Blocked on capability — the session cannot do what the turn requires
5. The assignment is genuinely finished and the next step is another agent's

"This is hard", "this needs more thought", "I would suggest" and "we should
consider" are not on the list. If none of the five applies, the turn is not
finished and the work continues in this turn.

### Continue until stopped, not until tired

Inside a turn, an agent works until it hits one of the five. It does not stop at
a natural-feeling pause, hand back a partial finding, or end with a proposal for
what it would do next when it holds the grant to do it.

If a turn ends without an artifact and without naming one of the five, N0tail
returns it. That is a failed turn, not a status update.

### Three kinds of stop, and only one reaches Dominic

| Stop | Goes to |
|---|---|
| Needs a decision or grant only he can give | Dominic |
| Capability — sandbox, lease, missing grant | A configuration finding. Should have been caught by N0tail's capability probe. |
| Nobody knows what "done" means here | Gaben. A planning defect. |

When all three become "waiting on Dominic," the room halts whenever he is away.
The third kind most often disguises itself as the first.

### Blocked on Dominic does not idle the room

When the room is blocked on Dominic, N0tail does not close the run and wait. He
reassigns every lane that does not depend on the blocked item and keeps working
until the run's own bounds are reached.

A block on one lane is a block on one lane. Several agents idling because one
needs a grant is a scheduling failure, not a blocked project.

### Every stop is resumable

Any run that ends — done, blocked, or out of budget — writes:

```
### Resume
In flight:      <what was mid-turn when this stopped>
Next action:    <the exact next thing, and whose>
Already true:   <what this session established — do not re-derive>
Would be lost:  <what a fresh session would redo without this block>
```

`Already true` prevents the most expensive failure in this project: a new session
re-deriving what the last one paid for. Cite artifacts.

## 15. The verification walkthrough

Every change that reaches Dominic carries a walkthrough he can follow to
check it himself. No change is reported as done without one.

This is not the same as the `Verify:` commands in a handoff prompt. Those
are for a coding agent. This is for a person on a phone who did not read
the run, does not remember the file names, and wants to know whether the
thing works.

### Shape

```
### How to check this

What changed, in one line:
  <plain language — what is different now for someone using the tool>

Before you start:
  <anything that must be running or restarted, stated as an action>

Steps:
  1. <one action, one place, one thing to look at>
  2. ...

What you should see:
  <the specific observable result, per step where it matters>

What it looks like if it did not work:
  <the failure appearance — not the cause>

How long this takes: <minutes>
```

### Rules for the walkthrough

**No paths, no file names, no function names, no acronyms.** Say "open the
photo tab and pick something small in the image", not "run a job through
InpaintCrop with a sub-1% mask". If a term cannot be avoided, it is the
wrong step.

**One action per step.** A step containing "and then" is two steps. A step
that requires deciding something is not a step — say what to pick.

**Every step says where.** Which tab, which button, which part of the
screen. Assume he has not opened this screen in two weeks.

**Name the expected result concretely.** "It should work" is not an
expected result. "The result image appears and the removed object is gone
with no visible patch where it was" is one. Include numbers where the
result is a number.

**Include the failure appearance, not the diagnosis.** What he would see if
the change did not take — a spinner that never resolves, an empty result,
the old behaviour unchanged. He does not need to know why; he needs to know
whether he is looking at success.

**State when it needs a restart.** Anything touching the job pool needs a
`pnpm dev` restart before testing (I2), and it is stated as step one in
plain terms: "stop the app and start it again — otherwise you will be
testing the old version without knowing it."

**Say how long.** A generate takes about three and a half minutes; a
Quality erase about forty-five seconds. A walkthrough that looks broken
because he expected it to be instant is a wasted round trip.

### What a walkthrough is not

It is not a summary of the work. It contains no reasoning, no rationale,
no description of what was tried. Those belong in the run report above it.

It does not ask him to interpret anything. If a step requires judgement
about whether a result is good, that step belongs to Ceb — measure it and
report the number, and give Dominic something he can simply see.

### Ownership

The agent that made the change writes the walkthrough. N0tail's completion
gate checks it is present and that it contains no paths or jargon; a change
reported without one is returned.

Ceb writes the walkthrough for anything a measurement cannot settle —
particularly video, where flicker, drift and motion plausibility are not
visible in any number the harness produces and Dominic's eyes are the only
instrument available.

## 16. Retry budget — three attempts, then stop

Any fix, workaround or recovery gets **three attempts, maximum**. Three for the
room, for that problem, across the whole run — not three each.

After the third, stop. Record `[blocked]` with what was tried and why each
attempt failed, then move to work that does not depend on it. Do not try a fourth
angle, do not re-plan the same fix with different words, and do not hand it to
another agent to start over. A second agent retrying a dead fix is a fourth
attempt wearing a different name.

Exhausting the budget is a legitimate stop under rule 14 — it is stop reason 4,
capability. Name it as such.

### Verify it is still broken before you say it is broken

Re-check the actual current state immediately before reporting a blocker, and
state when you checked. Not the state from earlier in the run, not what the last
turn said, not what the log said an hour ago.

This exists because it already happened: the room escalated `erasr is down` three
times while the app was up, serving 200s and running jobs. A stale blocker
reported as current sends Dominic to fix something that is not broken, and the
next real alert reads like more of the same.

### One report per blocker, ever

A blocker already reported is not reported again. Not by another agent, not by
the next run, not by a scheduled wake-up, not reworded, not "flagging for manual
delivery" a second time.

Before escalating anything, check whether this blocker was already sent. If it
was and nothing has changed, say nothing.

A repeat is only permitted when the **state changed** — it broke in a new way, a
new attempt produced new information, or it recovered. Say what changed, and do
not restate the original.

### A scheduled run that finds nothing new is silent

A cron or wake-up that fires, finds the same blocker, and produces the same alert
must not send it. Silence is the correct output. Waking up is not a reason to
speak.

If the same alert is on its third delivery, the delivery channel is the defect,
not the blocker — stop sending and let it wait for Dominic.

### Why this rule exists

Dominic was flooded on 2026-08-30: the same erasr stall alert arrived at 11:19,
11:49 and 12:19, three times for one problem that was already fixed. Every
duplicate spends his attention and teaches him to ignore the channel. The next
genuine blocker is the one that gets missed.

**Volume is not urgency.** Repeating an alert does not make it more likely to be
acted on; it makes the whole stream less likely to be read.
