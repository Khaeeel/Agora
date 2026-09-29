# Edit protocol

How the Self-Learning Engineer (SLE) changes skills and the harness without breaking them.

## Tiers

| Tier | What | Who approves | How |
|---|---|---|---|
| 1 | Agent skill wording: add an example, tighten a rule, add a checklist line, add a "don't" | Auto-apply | Apply, log, post in report |
| 2 | Agent role/scope, handoff template, add/remove a skill from an agent, routing hint for a PM | That agent's PM | Post patch in PM room, wait for `APPROVE <patch-id>` |
| 3 | Core harness: loop, dispatch, routing logic, memory layer, driver/model choice, tool permissions, any safety rule, the rubric, the task-size norms, this protocol, the SLE's own skill | Human owner | Post patch, tag the owner, wait for `APPROVE <patch-id>` |

If unsure which tier, go one tier up.

## Before applying

1. Evidence meets the threshold (≥3 instances across ≥2 sessions, or one damaging instance).
2. Root cause is named and is not `MODEL_LIMIT`.
3. No other open patch touches the same section.
4. The target agent is not mid-task.
5. Agent has had < 3 Tier 1 patches this cycle.

If any check fails, park the patch in `{MEMORY}/sle/patterns.md` with the reason.

## Applying

1. **Snapshot.** Copy the current file to `{MEMORY}/sle/snapshots/<patch-id>/<original-path>` before touching it.
2. **Edit.** Change only the lines in the patch diff. No drive-by cleanups.
3. **Mark.** Add a trailing comment on the changed line or block:
   `<!-- sle:<patch-id> -->`
   So future reviews can tell which rules came from the SLE and when.
4. **Log.** Append to `changelog.md` (format below).
5. **Announce.** Include in the next review report.

## Writing good skill edits

- State the behavior, then the reason in one clause. *"Attach the test command and its output to every 'done' — reviewers can't verify a claim they can't rerun."*
- Prefer one concrete example from the transcript (sanitized) over an abstract rule.
- Say what to do, not only what not to do.
- Don't add ALL CAPS, "CRITICAL", or "NEVER EVER". If a rule is ignored, it's usually vague or buried — fix that instead.
- Don't let a skill grow without bound. If a patch adds > 10 lines, look for lines it makes redundant and remove them in the same patch.

## Verify and rollback

- Every patch has a **metric** (from the rubric) and a **check date** (default: 7 days or 10 relevant tasks, whichever is later).
- On the check date, compare the metric to its pre-patch baseline for the same agent.
  - Improved clearly → `KEPT`
  - Flat or noisy with little data → `EXTEND` (once; second time counts as flat)
  - Flat after extension, or worse → `REVERTED`
- **Revert** = restore from snapshot, remove the `sle:` marker, log it. Reverts are always Tier 1 — you can undo your own change without approval.
- **Immediate revert** if a patch causes a red flag or the owning PM/human says revert.

## Changelog format

Append-only. One entry per state change.

```
## <patch-id> — <YYYY-MM-DD> — <APPLIED|KEPT|EXTEND|REVERTED|PENDING|REJECTED>
- Tier: <1|2|3>
- Target: <agent> / <file path> / <section>
- Root cause: <MISSING_RULE|CONFLICTING_RULE|VAGUE_RULE|WRONG_ROLE|HARNESS>
- Metric: <name> baseline <value> → <value at check, if verifying>
- Evidence: <room/msg-id>, <room/msg-id>, <room/msg-id>
- Note: <one line>
```

Patch IDs: `SLE-<YYYYMMDD>-<nn>` (e.g. `SLE-20260929-01`).
