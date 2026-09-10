---
name: planning
description: Use on every plan turn — when the orchestrator turns Dominic's message into a goal, an approach, a team, and steps (PLAN_SCHEMA), and when a stopped goal is about to be re-planned. Covers what to read before planning, how to write a goal that can be proven done, how to design the architecture of the solution before cutting steps, how to pick the smallest team that holds the grants the work needs, how to size and order steps so each is one turn, and the plan shapes that have stopped 40 of Agora's 67 goals. Not for the per-turn decision (who speaks next) and not for answer-mode replies.
---

# Planning a goal in Agora

A plan is not a to-do list. It answers four questions, in this order:

1. **What will exist when this is done, and how will we know?** (the goal)
2. **How does it get built or found?** (the approach: the architecture of the
   solution, its pieces and the order they depend on)
3. **Who in this room can do each piece, with the grants they hold, and who is
   not needed?** (the team)
4. **What is the smallest set of one-turn steps that proves it?** (the steps)

Most stopped goals in Agora skipped question 2 or got question 3 wrong. The
numbers as of 2026-09-10: 67 goals, 26 done, 40 stopped, 1 active, 4.4 steps
on average. The stopped shapes are listed at the end; read them before writing.

## 1. Before you write anything

The plan turn is the one turn that misdirects every turn after it. Spend it.

1. **Check the last goal first.** The prompt shows the room's most recent goal
   and its step states. If Dominic's message is a green light, an answer to a
   blocker, or "try again", **do not plan a new goal**: the run resumes the
   stalled goal with the same owners. The ERP room made four goals on the
   morning of 2026-09-09 for one objective; three stopped, the fourth finished
   because it was a resume.
2. **Read the roster line, including the grants.** Each agent is listed as
   `id: Name, Role` plus what it holds: wrappers, dirs, the wiki. That list is
   the team you have. An owner without the grant a step needs will report
   blocked and the run stops.
3. **Look before you guess.** You hold Read, Glob and Grep. If the ask names a
   folder, a file, an article, a config, open it now and plan from what is
   there. A plan written from the message alone is a plan written from memory,
   and it is why the plans feel weaker than Claude Code's or Cursor's: those
   planners read the code first.
4. **Name the precondition.** If the work depends on a service being up
   (KooyaPedia on 4711, the erasr engine, pnpm dev, ComfyUI), on access that
   must be granted, or on an artifact that must already exist, that check is
   **step 0**, owned by someone who can run it, with "if it is down, report and
   stop" in the title. The Erasr room does this and finishes; the ERP room did
   not and stopped twice on a server that was simply off.

## 2. The goal: an outcome with a test

One line, written so that someone can look at the room afterwards and say yes
or no.

- Bad: `Create a new agent that critiques KooyaPedia writing quality` (an
  activity; done when?)
- Bad: `May buong build plan at recommended agent roster para sa RAG chatbot`
  (a plan to make a plan; name the document and where it lands)
- Good: `Replace all occurrences of "HelloAlex BE" with "HelloAlex Bot" across
  KooyaPedia articles` (search for the old string afterwards, expect zero)
- Good: `A measured, current picture of erasr's erase and generate paths, with
  losses split into app-caused vs model-caused` (artifact named, split
  checkable)

The schema has no `verify` field, so the acceptance test lives in the **last
step**, owned by a different agent than the one who did the work. A goal whose
last step is the doer saying "done" has no acceptance test.

## 3. The approach: architecture before steps

Ask: **does this goal create something new, or check or change something that
exists?**

- **Check, fix, replace, measure, audit** → no design needed. Go to the team.
- **Build, add, connect, set up, automate, run an experiment, create an agent
  or a room** → design first. Steps cut without a design are guesses about
  pieces that do not exist yet, and that is where owners end up assigned to
  work nobody can do.

A design in Agora is short, five lines, and it is the **first step's
deliverable**, posted as a `result` by the agent who will build the core, so
every later owner reads the same picture:

| Line | Question it answers | Example (KooyaPedia write path, 2026-09-09) |
|---|---|---|
| Pieces | What components will exist? | wrapper script → HTTP endpoint on the wiki server → SQLite `content` table with revisions |
| Flow | What calls what, in what order? | agent runs `kooyapedia-edit.sh set <slug>` → POST /api/articles → insert revision → lookup reads it back |
| Where | Which repo, path, port, table? | `C:\Projects\Alexandria`, server routes file, port 4711 |
| Interfaces | What does each piece take and return? | `get <slug>`, `set <slug> <file>`, `new <slug> <title>`; non-zero exit with a one-line reason |
| Risks | What could break, and what do we do then? | articles marked read-only refuse edits (exit 77): treat as designed, not as failure |

Rules for the design step:

- The designer is the agent who holds the read grant on the thing being built
  on. Design without reading is the same mistake as planning without reading.
- Keep it to what the next owners need. A diagram nobody consumes is a report.
- The design decides the dependency order of the steps that follow. If the
  design says the wrapper needs the endpoint, the wrapper step depends on the
  endpoint step. If two pieces do not touch, their steps run in parallel.
- Experiments are designs too: pre-register the config, the expected answer,
  the cost ceiling, and where the artifact lands, before anything runs. The
  Voicemail room's finished goals all do this.

For a goal Dominic scoped as "make me a plan", the design **is** the
deliverable: the goal is that document existing, the steps produce its
sections, the last step posts it. Do not open a second goal to plan the plan.

## 4. The team: who, and not more

Derive lanes from the verbs in the approach, then fill each lane with **one**
agent who holds the grant. Stop there.

| Lane | Verb in the work | Needs | Typical holder in a room |
|---|---|---|---|
| Read | find, map, inventory, locate, confirm | dir or wiki read, or a lookup wrapper | a runner / scout |
| Build | write, edit, add, fix, draft | the write wrapper for that project | the writer / mechanic |
| Run | execute, launch, benchmark, test | the run wrapper (`claude-run.sh`, `erasr-run.sh`, `train-launch.sh`) | the executor |
| Verify | audit, check against, confirm zero, compare | read grant only, and **not** the builder | an auditor (Denver-shaped) |
| Decide | choose, weigh, close | nothing; the orchestrator | you |

Sizing rules, because "hindi OA":

- **One owner per lane.** Two agents on one lane is a discussion, not work.
- **Two to four agents for most goals.** The done goals in the history average
  three owners. Seven owners (the Erasr benchmark) was right only because there
  were seven independent measurements.
- **No verifier for a two-step fix** where the last step is a trivial check the
  builder's own wrapper can prove (a search returning zero). Add an independent
  verifier when the claim is a number, a judgement, or a "works".
- **No discussion inside work mode.** `discuss` is for answer mode. If the room
  needs to weigh an approach, that is the design step, posted by one agent,
  and the others consume it.
- **Do not add an agent to be safe.** Every extra owner is a turn, a cost, and
  a reply the human has to read. An agent with nothing to do replies `PASS`
  and the run pays for it anyway.
- **Spawn only when a lane has no holder and a template can fill it**:
  researcher for web and library lookups, mechanic for prompt edits, helper
  for reasoning over the transcript. A forged agent has exactly its template's
  grants. Spawning does not create capability, and it is never the fix for a
  missing grant on a project folder.
- **Match the model to the lane.** Opus-class members for design, audit, and
  anything that must state numbers with their caveats; sonnet-class for
  search, edit-through-wrapper, and mechanical steps. The roster tells you who
  is which.

If a lane has no holder and no template fits, the goal cannot be achieved by
this room as it stands. Say that in the goal line or step 0 ("Blocked until
Dominic grants X to Y") so the run stops in the first turn with a clear ask.
Never assign the lane anyway and hope.

## 5. Steps

Two to six. Each one is **one turn by one agent**: the turn times out at
300 s, the reply is capped at about 80 words, the goal at $5. If a step needs
several turns, it is several steps.

Each step:

- **Starts with a verb and names the evidence it produces.** Not "Explore the
  Alexandria codebase" but "Find the SQLite schema and the article routes in
  C:\Projects\Alexandria and post the table and route names". The evidence is
  what the verifier checks and what the next step consumes.
- **Has an owner from the team in section 4** who holds the grant. `owner:
  null` means "whoever is free", which means the orchestrator picks under time
  pressure. Avoid it.
- **Has honest dependencies.** Steps whose dependencies are met start at the
  same time, one per owner. Two steps with different owners and no real
  dependency get empty `dependsOn`; that is free parallelism. A step that
  consumes another's evidence says so. Do not chain everything serially out of
  habit; do not mark a step independent when it reads the previous result.
- **Is not a report.** "Report back", "summarise", "cite the source" are not
  steps: every reply is already a report and the run report goes to WhatsApp
  by itself. Three finished goals spent a third of their steps on this.
- **Is not something only you or Dominic can do.** Spawning, granting access,
  creating a room are plan fields (`spawn`, `access`, `createRoom`), not
  steps. "Spawn kooyapedia-critic via mechanic template" assigned to a mechanic
  stopped a goal in its first turn; the mechanic cannot spawn. "Give the critic
  read access" assigned to an agent is the same mistake; only Dominic grants.

## 6. When nobody can do a step

In order of preference:

1. **Somebody can, through a wrapper.** A direct Write or Edit is denied for
   most agents, but a wrapper in their allow list is the grant in another
   shape. Assign the wrapper holder.
2. **Dominic just said so.** If his message names a folder or the wiki with a
   look-word, that is a grant: fill `access` with the kind, the path as he
   wrote it, and the agents who need it.
3. **Nobody can and he did not grant it.** Say so in the goal line or step 0
   and let the run stop with a clear ask.

## 7. Tailoring

Use `tailor` when an agent's standing file does not fit this goal: what counts
as its skills here, how to work it, the voice. Two or three short lines per
field, Taglish. It lasts for the goal and is gone after. Null for agents that
already fit, which is most of them.

## 8. When a plan he handed you arrives

His steps are the steps, in his order, each with an owner attached. Do not
re-derive, improve, or hand it back. If a step is wrong, note it in one line
inside that step's title and carry on; stop only if proceeding would corrupt
evidence or destroy an artifact. Already in the plan prompt; repeated here
because it is the rule most often broken.

## Worked example

Dominic, in ERP / KooyaPedia, 2026-09-09: *"Unblock KooyaPedia content edits
by building a write path into its SQLite content, then apply the client-friendly
template to the existing articles."*

- **Goal:** `Existing technical articles rewritten with the client-friendly
  template through a working write path; a lookup shows the new text.`
- **Kind:** build → design first.
- **Precondition:** KooyaPedia on 4711 answers `kooyapedia-lookup.sh recent`.
- **Design (step 1's deliverable):** the five lines in section 3.
- **Team:** kooyapedia-writer (read + write wrapper on Alexandria: Read,
  Build), kooyapedia-runner (wiki write wrapper: Build on articles), fury
  (wiki read: Verify). Three owners. No spawn; no discussion.
- **Steps:**
  0. Confirm KooyaPedia answers `kooyapedia-lookup.sh recent`; if not, report
     and stop. — runner, deps []
  1. Find the SQLite schema and the article routes in Alexandria and post the
     design (pieces, flow, where, interfaces, risks). — writer, deps [0]
  2. Build `kooyapedia-edit.sh get/set/new` against the endpoint and prove it
     with one test edit on a low-risk article shown by lookup. — writer, deps [1]
  3. Apply the template to helloalex-ai, architecture-overview,
     project-architecture-map, 18fund through the wrapper; a refused read-only
     article is reported, not retried. — runner, deps [2]
  4. Spot-check the rewritten articles against the template and post which
     pass. — fury, deps [3]

That is the plan that finished at 11:23 for $0.36, after three earlier goals
for the same objective stopped: one because no owner held a shell grant, one
because the writer lacked Write, one because the run re-planned instead of
resuming.

## Checklist before returning the plan

- [ ] Follow-up to the last goal? Then it is a resume, not a plan.
- [ ] Goal line is an outcome someone can check.
- [ ] Build-type goal? Then step 1 is the design, by the agent who read the code.
- [ ] Step 0 checks the precondition if there is one.
- [ ] Lanes derived from the verbs; one owner per lane; two to four owners.
- [ ] Every owner holds the grant the step needs (roster line).
- [ ] No step is a report, a summary, or a citation.
- [ ] No step is a spawn, a grant, or a room; those are plan fields.
- [ ] Each step names the evidence it produces.
- [ ] `dependsOn` honest both ways.
- [ ] Last step verifies the outcome, owned by someone other than the builder.
- [ ] Two to six steps, each one turn.

## The shapes that stopped goals (from the database)

| Shape | Example | What happened |
|---|---|---|
| Step needs a plan-level power | "Spawn kooyapedia-critic via mechanic template" owned by a mechanic | stopped turn 1 |
| Owner lacks the grant | lookup step given to fury before fury held the wrapper | "no agent has shell access", stopped |
| No precondition check | "Confirm kooyapedia-lookup.sh returns recent articles" with the server off | blocked, blocked, stopped |
| Re-plan instead of resume | four ERP goals on one morning for one objective | three stopped, the resume finished |
| Report steps | "Report back to room with pass/fail" | a third of the run on filler |
| Activity as goal | "Create a new agent that critiques…" | no acceptance test, stopped |
| Plan to make a plan | two RAG goals for the same build plan | first abandoned, second still active |
| Build without design | write-path goal cut into steps before anyone read Alexandria | owner assigned to work it could not do |

## The shapes that finished

- **Erasr benchmark:** precondition step first, one owner per independent
  measurement, evidence named in every title, an independent compile step that
  sorts without synthesising.
- **Voicemail 10:58:** each step names the number it must state ("n,
  out-of-fold vs full-fit, gate placement"), owners match their wrappers, the
  last step is a pre-registration with a cost ceiling.
- **ERP 07:16:** search, edit through the wrapper, verify by a different agent
  that zero matches remain. Three steps, $0.46, done.

## Notes for Dominic (harness changes that would make plans better)

These cannot be fixed from inside a plan; they are rung-3 and rung-4 changes.

1. **Add `verify` to PLAN_SCHEMA**: a one-line "done when" predicate, stored
   on the goal (the column exists) and shown to the progress review.
2. **Add `approach` to PLAN_SCHEMA**, or make the design step a convention the
   plan prompt names: five lines, posted as the first result on build goals.
3. **Tell the plan turn it may look.** The orchestrator holds Read/Glob/Grep
   but the plan prompt never says to use them, so plans are written from the
   message alone. One line in the prompt changes that.
4. **Reject bad owners deterministically.** After the plan parses, check each
   step's owner against the grant its verbs imply (edit, run, open wiki). Post
   the mismatch and re-ask once. Cheaper than a stopped run.
5. **Treat a null plan as an error.** Today a plan that fails to parse is cast
   and the run continues with no goal. Post a notice and stop.
6. **Detect the resume case in code.** `lastGoalContext` asks the model to
   notice a follow-up; a stalled goal plus a short affirmative message could
   route straight to resume without a plan turn.
