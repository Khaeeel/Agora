# Skills

A skill is a shared recipe any agent in any room can run: the generic steps for
a multi-step task that comes up more than once. It is not a job description
(that is the agent file), not a room's facts (that is `_rules-<room>.md`), and
never a capability (tools, allow, add_dirs live in frontmatter and templates;
a skill can describe a wrapper, it cannot grant one).

## Format

One folder per skill, folder name = skill name, kebab-case. Inside it,
`SKILL.md`:

```markdown
---
name: planning
description: Use when … (required; one line on WHEN to apply it)
---
# Steps
1. Generic step
2. Generic step

# Rules
- Short, generic, checkable.

# Anti-patterns
- What it looks like when this goes wrong.
```

Rules that make a skill usable:

- **The description is the only thing a reader sees when deciding whether to
  use the skill.** Write it as "Use when …", name the situation, not the
  topic. It is what the orchestrator matches against, and what the eval will
  score.
- **The body is generic steps.** No repo paths, no ports, no agent ids, no
  numbers from one room's history. If a step needs a specific value, say what
  kind of value ("the room's write wrapper", "the service the room depends
  on") and let the room rules supply it.
- **Keep it short.** Under about 4,000 characters. A skill is injected into a
  turn on top of protocol, room rules, and the agent file; every line costs
  every time it loads.
- **Specifics go beside it, not in it.** `applied-to-agora.md` in the same
  folder holds the worked examples, the measured numbers, the file references,
  and the notes for Dominic. Humans and mechanics read it; the loader never
  injects it.

## Where specifics live instead

| Kind of thing | Where it goes |
|---|---|
| Which repo, port, host, wiki space, JID | `agents/_rules-<room>.md` |
| Who owns a lane, standing voice, model | `agents/<id>.md` |
| What an agent may touch | frontmatter + `templates/agents/*.md` (Dominic only) |
| How to adapt an agent for one goal | the plan's `tailor` field |
| A reusable procedure | `skills/<name>/SKILL.md` |

## How a skill reaches a prompt

Planned; nothing in `apps/server` loads this folder yet. The design, in order
of cost:

1. **Index line.** Every prompt carries one line per skill: name and
   description. Nothing else. That is enough to decide.
2. **Step pointer.** A step title that names `@<skill-name>` gets that skill's
   `SKILL.md` body injected into the owner's turn for that step only.
3. **Standing skill.** `skills: [name, …]` in an agent's frontmatter injects
   the body on every turn of that agent. Use sparingly; it is the expensive
   one.
4. **On demand.** `skill-lookup.sh show <name>` for agents with Bash, in the
   `ecc-lookup.sh` style, read-only.

## Who writes skills

Dominic writes them. A mechanic may propose one through `agent-edit.sh`
subject to the same two-split acceptance gate as a prompt edit (see
`self-improvement-loops`). No agent saves a skill on its own because it
noticed a repeated task; that is a change to the mechanism that produces
context, and it is a human decision.

## Authoring checklist

- [ ] Folder name, `name`, and the title agree.
- [ ] Description starts with "Use when" and names the situation.
- [ ] Every step is generic: no path, port, id, or room-specific number.
- [ ] Under ~4,000 chars.
- [ ] Specifics, examples, and measurements are in `applied-to-agora.md`.
- [ ] Nothing in the body grants or implies a capability.
