# SLE Review — <YYYY-MM-DD> (cycle <n>)

Rooms reviewed: <list> · Messages: <n> · Tasks closed: <n>

## Scores

| Agent | Room | Comm | Handoff | Pace | Evidence | Escalation | Δ vs last |
|---|---|---|---|---|---|---|---|
| <agent> | <room> | 4 | 2 | 3 | 1 | 4 | ↓ Evidence |

Room-level: bounce rate <x%> · tasks over 2× norm <x%> · done-claims with evidence <x%>

## Top findings (max 3)

### 1. <one-line finding>
- **Who:** <agent(s)>
- **Pattern:** <what happens>
- **Evidence:**
  - `<room>/<msg-id>` — "<short excerpt>"
  - `<room>/<msg-id>` — "<short excerpt>"
  - `<room>/<msg-id>` — "<short excerpt>"
- **Root cause:** <code> — <where in the skill/harness>
- **Action:** <patch-id> (Tier <n>, <applied|pending>)

### 2. …

## Patches this cycle
- Applied: <patch-id> → <agent> — <one line>
- Pending approval: <patch-id> → <who must approve> — <one line>
- Parked (not enough evidence yet): <pattern> — <count>/3

## Earlier patches checked
- <patch-id> — <KEPT|EXTEND|REVERTED> — <metric> <baseline> → <now>

## Exemplars
- `<room>/<msg-id>` — <agent> — <why this is the bar others should hit> (candidate example for other skills)
