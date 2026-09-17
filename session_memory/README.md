# session_memory

Handover notes for Agora, written so a fresh session — or Dominic after a
reboot — can pick the work up without re-deriving anything.

One file per working session, named `YYYY-MM-DD-session.md`. Newest last.

| File | Covers |
|---|---|
| [2026-08-28-session.md](2026-08-28-session.md) | Auto-resume and the false-blocker guard, honest step reporting, agent discussions, clickable decisions, the mind stone, the Trunks room and its `erasr` wrappers, the WhatsApp bridge both ways, and the wrapper security hole found and closed. |
| [2026-09-11-session.md](2026-09-11-session.md) | HelloAlex on `development` tip `84ac6db93`: Call Details voice naming (UUID/Default → real names, Bland Get Voice + harden), Phone Numbers Analytics kept when rotation is off (hide Rotation tab/charts only; Analytics before Archived), Batch Call draft TDZ, empty area-code buy copy, rotation autofill/hide picker; Stephen `6cbd8d9ff` under tip; ask-before-push and no Billing/live-call process rules. |
| [2026-09-15-session.md](2026-09-15-session.md) | Project Norm: Phase 0 results, Dominic's decisions (build our own Norm from scratch, Cursor as the brain for now, no Bland Norm even as a teacher), and why Optimus stalled for 10 turns. |
| [2026-09-16-session.md](2026-09-16-session.md) | Repo layout: one folder per chatroom under `agents/`, `_shared/` for crew in two rooms, why the `scripts/` wrappers deliberately did not move, and the three traps a file move sets — `--follow` is invisible until the rename is committed, `git show <sha>:<path>` fails silently, and `agent-edit.sh log`/`undo` stop dead at a rename. |
| [2026-09-17-session.md](2026-09-17-session.md) | Erasr and Eval rooms deleted permanently (176 messages), why it took hand-written SQL — Agora has no delete-room feature and the schema has no cascade — where the backup is, and why `_shared/` is gone. |

## What belongs in one of these

- **The runbook** — how to start each service, and the traps that waste an hour.
- **Decisions and why**, especially the ones that look arbitrary later.
- **What is still open**, including anything waiting on Dominic.
- **Mistakes worth not repeating.** These are the most valuable entries and the
  first thing a summary drops. Keep them.

## What does not

Anything the repo already records — file layout, git history, what a function
does. If it can be read from the code, it does not go here.

## Not the same as the mind stone

The **mind stone** is per-room memory the agents themselves read and rewrite; it
lives in `data/agora.db` and rides ahead of the transcript in every prompt.

**This folder is for humans and for the next session.** Nothing here is loaded
into an agent's context automatically.
