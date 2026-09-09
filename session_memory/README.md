# session_memory

Handover notes for Agora, written so a fresh session — or Dominic after a
reboot — can pick the work up without re-deriving anything.

One file per working session, named `YYYY-MM-DD-session.md`. Newest last.

| File | Covers |
|---|---|
| [2026-08-28-session.md](2026-08-28-session.md) | Auto-resume and the false-blocker guard, honest step reporting, agent discussions, clickable decisions, the mind stone, the Trunks room and its `erasr` wrappers, the WhatsApp bridge both ways, and the wrapper security hole found and closed. |

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
