---
name: planning
description: Use when turning a request into a goal, a design, a team, and steps for agents with fixed grants — the plan turn, or re-planning a goal that stopped. Not for deciding who speaks next, not for answer-mode replies.
---
# Steps

1. **Check for a resume.** If the message is a green light, an answer to a
   blocker, or "try again" on the room's last goal, resume that goal with the
   same owners. Do not open a new goal for the same work.
2. **Read the roster with its grants.** The team is the agents listed and what
   each holds (wrappers, folders, services). An owner without the grant a step
   needs reports blocked, and the run stops.
3. **Look before you guess.** If the request names a file, folder, article, or
   config you can read, read it and plan from what is there. If you cannot,
   write the unknown down; it becomes step 0.
4. **Write the goal as an outcome.** One line someone can check afterwards:
   what will exist, and the test that shows it. An activity ("create an
   agent", "make a plan for X") is not a goal; its artifact is.
5. **Classify.** Check, fix, replace, measure, audit: skip to step 7. Build,
   add, connect, set up, run an experiment: design first.
6. **Design in five lines**, posted by the agent who read the code as the
   first working step: pieces, flow, where (repo, host, port, table),
   interfaces, risks. The design fixes the order of the steps after it. For an
   experiment: config, expected answer, cost ceiling, artifact location.
7. **Derive the team from the verbs.** Lanes: read, build, run, verify,
   decide. One owner per lane, two to four owners in total, verifier never the
   builder. An idle member costs a turn and a reply every round.
8. **Handle a lane nobody holds, honestly.** A wrapper in someone's allow
   list is the grant in another shape; a grant the human just gave counts;
   otherwise step 0 says "Blocked until X is granted to Y" so the run stops
   in turn one with a clear ask. Spawning does not create capability: a forged
   agent has exactly its template's grants.
9. **Cut two to six steps, each one turn of one agent.** Verb first, evidence
   named. Owners from step 7. Dependencies honest both ways: independent steps
   with different owners run in parallel; a step that consumes another's
   evidence waits.
10. **Precondition at step 0** when the work needs a service up, an access
    granted, or an artifact present: "check X; if down, report and stop",
    owned by someone who can run it.
11. **Last step verifies** the test from step 4, owned by someone other than
    the builder.
12. **Apply the checklist, then return the plan.** The checklist is applied by
    the planner, never turned into steps.

# Rules

- No report steps. "Report back", "summarise", "cite" are not steps.
- No plan-level powers as steps. Spawn, access, and new rooms are plan fields.
- A plan the human handed over runs as given, in their order, an owner per
  step. Note a wrong step in one line and carry on; stop only if proceeding
  would corrupt evidence or destroy an artifact.
- A document deliverable: the goal is the document existing where the human
  can read it; the last step posts it. Never a second goal to plan the plan.
- Tailor an agent only when its standing file does not fit; a few lines.

# Checklist

- Follow-up to the last goal? Then resume.
- Goal is an outcome with a test.
- Build goal? First working step is the design by whoever read the code.
- Step 0 names the precondition or the blocker only the human can clear.
- One owner per lane; two to four owners; every owner holds the grant.
- No report, spawn, grant, or room steps.
- Each step names its evidence; dependencies honest both ways.
- Last step verifies, not by the builder. Two to six steps, one turn each.

# Anti-patterns

- Activity as goal; plan to make a plan.
- A step needing a power only the planner or the human has.
- Owner chosen by availability, not by grant.
- All serial out of habit, or all parallel when steps consume each other.
- The checklist turned into steps ("check that the roster is lean").
- Steps cut before anyone read the code.
