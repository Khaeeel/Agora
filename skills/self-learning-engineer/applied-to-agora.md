# self-learning-engineer — applied to Agora

The specifics the skill leaves out on purpose: paths, commands, the agent that
carries it, and what "deterministic" means here. Humans and the engineer read
this; the loader never injects it.

## Who carries it

`agents/_shared/2cap.md` — 2CAP, "Self Learning - Engineer", in the Self
Learning room with Danny, Megan Fox and N0tail (the PMs it watches). Its
frontmatter grants are the whole of what it may touch:

| Grant | Why |
|---|---|
| Read on `skills/self-learning-engineer/` | this skill, the rubric, the edit protocol, the templates |
| Read + Write on `data/sle/` | its memory (`{MEMORY}/sle/` in the skill = `/home/dominickooya/agora/data/sle/`) |
| `node scripts/harness-eval.mjs` | the deterministic evaluator |
| `bash scripts/agent-edit.sh` | show / preview / set / undo on an agent's Instructions or Personality — the only write path into `agents/` |
| `bash scripts/git-read.sh` | read the repo history of agent files without a write grant |

It has no add_dir on `agents/`; it reads them through `agent-edit.sh show`
and `git-read.sh`, and it can never touch frontmatter (grants) — the wrapper
refuses.

## Deterministic evaluation (rule 7)

The evaluator is `scripts/harness-eval.mjs`. No model is called; the same
`data/agora.db` and the same git history give the same scores.

```
node /home/dominickooya/agora/scripts/harness-eval.mjs                      # last 7 days, table
node /home/dominickooya/agora/scripts/harness-eval.mjs --days 30 --json     # full report
node /home/dominickooya/agora/scripts/harness-eval.mjs --room "Trunks"      # one room
```

Case types it scores: `turn` (markers, length, grants held at the time),
`plan` (step owners against their grants), `forge` (was the new agent asked
for, did it join, was it used), `handoff` (did work move to the right agent,
citing the instruction, without looping). Full reports land in
`data/harness-eval/`.

A review cycle is: evaluator first → rubric scores that explain the numbers →
patches that each name the metric they must move → the same evaluator after
the check date. A patch whose metric did not move is reverted with
`agent-edit.sh undo`.

## What is NOT available

- `scripts/agora-eval.sh` runs fixed tasks through a room named "Eval". That
  room was deleted on 2026-09-17, so the wrapper fails until an Eval room
  exists again. Use `harness-eval.mjs` on real transcripts instead.
- The skill's "changelog" lives in `data/sle/changelog.md`, not in git — data/
  is gitignored. `agent-edit.sh set` makes its own git commit per edit, so
  the repo history is the second record.
- Agent files have their own local git repo, `agents/.git` (since 2026-09-29;
  the outer repo ignores `agents/` so clones never carry the crew). History of
  an agent: `bash /home/dominickooya/agora/scripts/agent-edit.sh log <id>`.
  `git-read.sh` points at helloalex2 by default, not at the agents repo.
- Cursor is the driver: the grants above are prompt-enforced there, not a
  hard boundary. The wrappers are the boundary.
