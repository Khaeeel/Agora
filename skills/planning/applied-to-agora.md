# planning — applied to Agora

Everything here is Agora-specific and is never injected into a prompt. It is
for Dominic and for mechanics reading the history.

## Where the plan turn lives

- Schema: `PLAN_SCHEMA` in `apps/server/src/orchestrator.ts` (mode, responder,
  discuss, needsLookup, spawn, access, tailor, createRoom, goal, steps with
  title/owner/dependsOn). No `verify` and no `approach` field yet.
- Prompt: the plan turn in `Orchestrator.start()` — mind stone, the human
  text, the roster with `grantsLine`, `lastGoalContext`, and the mode rules.
- Caps that size a step: turn timeout 300 s, reply limits 45/80 words with a
  900-char hard cap, goal cost cap $5, concurrency 2, steps sliced at 12.

## The numbers (2026-09-10)

67 goals: 26 done, 40 stopped, 1 active. Average 4.4 steps, max 7.

## Shapes that stopped goals (from `data/agora.db`)

| Shape | Example | What happened |
|---|---|---|
| Step needs a plan-level power | "Spawn kooyapedia-critic via mechanic template" owned by a mechanic | stopped turn 1 |
| Owner lacks the grant | lookup step given to fury before fury held the wrapper | "no agent has shell access", stopped |
| No precondition check | "Confirm kooyapedia-lookup.sh returns recent articles" with the wiki server off | blocked, blocked, stopped |
| Re-plan instead of resume | four ERP goals on the morning of 2026-09-09 for one objective | three stopped, the resume finished |
| Report steps | "Report back to room with pass/fail" | a third of the run on filler |
| Activity as goal | "Create a new agent that critiques…" | no acceptance test, stopped |
| Plan to make a plan | two RAG goals for the same build plan | first abandoned |
| Build without design | write-path goal cut into steps before anyone read Alexandria | owner assigned to work it could not do |

## Shapes that finished

- **Erasr benchmark:** precondition step first ("confirm both engines up, else
  report and stop"), one owner per independent measurement, evidence named in
  every title, an independent compile step at the end.
- **Voicemail 2026-09-09 10:58:** each step names the number it must state
  ("n, out-of-fold vs full-fit, gate placement"), owners match their wrappers,
  the last step is a pre-registration with a cost ceiling.
- **ERP 2026-09-10 07:16:** search, edit through the wrapper, verify by a
  different agent that zero matches remain. Three steps, $0.46, done.

## Worked example: the KooyaPedia write path

Dominic, ERP / KooyaPedia, 2026-09-09: "Unblock KooyaPedia content edits by
building a write path into its SQLite content, then apply the client-friendly
template to the existing articles."

- Goal: existing technical articles rewritten with the template through a
  working write path; a lookup shows the new text.
- Kind: build, so design first.
- Precondition: KooyaPedia on 4711 answers `kooyapedia-lookup.sh recent`.
- Design (step 1's deliverable): pieces = wrapper script → HTTP endpoint on
  the wiki server → SQLite content table with revisions; flow =
  `kooyapedia-edit.sh set <slug>` → POST → insert revision → lookup reads it
  back; where = `C:\Projects\Alexandria`, server routes, port 4711;
  interfaces = `get`, `set`, `new`, non-zero exit with a reason; risks =
  read-only articles refuse edits (exit 77), treat as designed.
- Team: kooyapedia-writer (Read + Build on Alexandria), kooyapedia-runner
  (Build on articles through the wiki wrapper), fury (Verify, wiki read).
- Steps: 0 precondition (runner); 1 design (writer); 2 build the wrapper and
  prove it with one test edit (writer, after 1); 3 apply the template to the
  four articles, refused read-only article reported not retried (runner,
  after 2); 4 spot-check against the template (fury, after 3).

That is the plan that finished at 11:23 for $0.36 after three earlier goals
for the same objective stopped.

## Live test in the RAG room (2026-09-10 ~13:00)

A 3.6k condensed version was installed as `agents/_rules-rag.md` and the room
was asked to expand its build plan. Run: 8 min 23 s, 4/4 steps. What changed
versus the earlier run: step 0 named the blockers only Dominic can clear (HQ
repo path, host, write grant, services up); roster went from six agents to
four (one `hq-builder`); verifier separated from builder; goal line became
outcome-checkable. What the test exposed: the 45/80-word reply cap squashed
the "full build plan" into two one-line messages (documents need a channel:
fenced blocks up to 20 lines are exempt from the length guard, or the goal's
handoff field); the checklist items were turned into steps; "spawn
hq-builder" still appeared although no template can hold a write grant; one
agent claimed to have checked a folder it cannot see.

## Notes for Dominic (harness changes)

1. Add `verify` (done-when) and `approach` (the five-line design) to
   `PLAN_SCHEMA`; the goals table already has a `verify` column.
2. Tell the plan turn it may Read/Glob/Grep; the prompt never says so.
3. After the plan parses, check each step's owner against the grant its verbs
   imply and re-ask once on a mismatch.
4. Treat a null plan as an error: post a notice and stop, instead of
   continuing goal-less.
5. Detect the resume case in code (stalled goal plus a short affirmative), not
   by asking the model to notice.
6. Give document deliverables a channel that the length guard does not
   rewrite.
