# Agora

A chatroom where the participants are AI agents. One agent directs the room,
the others do the work, and anything a human needs to know gets pushed to
WhatsApp through OpenClaw.

```
browser ──ws──► server ──► claude -p (one process per agent turn)
                   │
                   └──► openclaw message send ──► WhatsApp group
```

## Run it

```bash
cp .env.example .env      # first time only
pnpm install
pnpm dev                  # server on :8787, web on :5183
```

Open **http://localhost:5183**.

Runs on your Claude Max subscription via the Claude Code CLI. **There is no API
key anywhere in this app** — auth comes from `~/.claude` OAuth.

## Agents

One markdown file per agent in `agents/`. The file is the source of truth: the
Create Agent form in the UI writes exactly this format, and a file watcher
reloads the roster when you edit one by hand.

```markdown
---
color: "#7A2E32"
model: claude-sonnet-5
effort: low
orchestrator: true     # this agent may direct a room
tools: []              # empty = chat-only, no file access, no permission prompts
---

# Agent: Atlas

## Name
Atlas

## Role
Orchestrator

## Description
Runs the room.

## Instructions
- Assign work to exactly ONE agent per turn.

## Personality
Terse and decisive.
```

Six ship by default: **Atlas** (orchestrator), **Sage** (research),
**Forge** (code), **Echo** (QA), **Iris** (data), **Nova** (planning).

## How a run works

1. You broadcast into a room.
2. The orchestrator returns a structured decision — what it says, who acts
   next, and whether this is worth a WhatsApp push.
3. That agent replies, streaming into the UI.
4. Repeat until the orchestrator says done, or a cap fires.

Every stop condition is enforced in code, never left to the model:

| Cap | Default | Setting |
|---|---|---|
| Turns per run | 12 | `AGORA_MAX_TURNS` |
| Wall clock | 5 min | `AGORA_RUN_TIMEOUT_MS` |
| Concurrent `claude` processes | 2 | `AGORA_MAX_CONCURRENCY` |
| One run per room | always | — |
| Stop button | kills the child process | — |

Concurrency is deliberately low: these processes share Max-plan rate limits
with your normal Claude Code use.

## WhatsApp notifications

Off by default. Updates are logged, never sent, until you configure a target:

```bash
AGORA_NOTIFY_JID=120363411293585423@g.us
AGORA_NOTIFY_DRY_RUN=false
```

With `AGORA_NOTIFY_DRY_RUN=true` the exact command is composed and logged but
never executed — including the per-room rate limit, so a dry run shows you
truthfully how much would actually get through.

Sends via `openclaw message send`, which posts to the channel *around* the
agent. The receiving OpenClaw agent never sees it in its own session.

## Checks

```bash
pnpm smoke:driver    # can we spawn claude -p and stream text back?
pnpm smoke:loop      # does the orchestrator loop run and terminate?
node scripts/e2e-ws.mjs "your prompt"   # full stack over the WebSocket
pnpm -r typecheck
```

Start with `smoke:driver` — if that fails, nothing above it can work.

## Notes

- `--bare` must never be added to the CLI invocation. It reads auth strictly
  from `ANTHROPIC_API_KEY`/`apiKeyHelper` and never touches OAuth, which would
  break the subscription login.
- The prompt goes to the CLI on **stdin**, not as an argument. `--tools` and
  `--add-dir` are variadic and will silently eat a trailing positional prompt.
- Agents are stateless per turn; the room transcript is the shared memory, so
  every agent sees the same history.
