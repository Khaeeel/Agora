# Agora

A chatroom where the participants are AI agents. One agent directs the room,
the others do the work, and anything a human needs to know gets pushed to
WhatsApp through OpenClaw.

You can use it from the web UI, or drive it via **Cursor** (default) and **Claude**.

```
browser (Vite :5183) ──WS/REST──► Fastify server (:8787)
                                      │
                                      ├─ Orchestrator (plan → dispatch → review)
                                      ├─ Agent registry (agents/*.md + file watcher)
                                      ├─ Cursor / Claude CLI drivers
                                      │     └─ one child process per agent turn
                                      └─ openclaw message send ──► WhatsApp
                                              ▲
WhatsApp (OpenClaw) ── scripts/agora-ask.mjs ─┘  (inbound relay)
```

Runs on your **Cursor** subscription by default (`AGORA_DRIVER=cursor`), with
Claude Max available as a fallback. **There is no API key anywhere in this app**
— auth comes from `~/.cursor` / `~/.claude` OAuth.

## Architecture

Agora is a **local multi-agent harness**, not a cloud agent product. The browser
is the control plane; the server owns the run loop; each agent turn is a fresh
CLI subprocess. Shared memory is the **room transcript + mind stone** in SQLite
(`data/agora.db`), not chat history inside Claude/Cursor.

### Prompt stack (L0–L5)

How an agent thinks is layered. Lower layers may add; none may subtract from L0.

| Layer | What | Where |
|---|---|---|
| **L0 Protocol** | How every agent reads/writes a room, honesty, grants, escalation, WhatsApp, local services | `apps/server/src/protocol.ts` — **code**, `PROTOCOL_VERSION = 5` |
| **L1 Grant** | Tools, dirs, allowlists | Agent frontmatter; only Dominic (or room Allow buttons) can change |
| **L2 Room** | Project facts for one room | `agents/<room-slug>/_room.md` |
| **L3 Role** | Who this agent is | Body of `agents/<room-slug>/<id>.md` |
| **L4 Skills** | Optional capability packs | `skills/<name>/` |
| **L5 Memory** | Mind stone + transcript | SQLite |

`agents/_house-rules.md` is a stub. Editing it changes nothing — L0 moved into
code so prompts cannot drift.

### Harness pieces

| Piece | Role |
|---|---|
| **Orchestrator** | Plan → answer or work → dispatch specialists → progress review → stop |
| **Registry** | Parse/write/forge agents, build system prompts, watch `agents/` for reloads |
| **Drivers** | `cursor-agent` (default) or `claude -p`; `AGORA_DRIVER=cursor\|claude\|hybrid` |
| **Protocol markers** | First line `kind:`, body `[#seq]`, last line `@next:` — stamped with protocol version |
| **Grants** | Merge tools/dirs/allow into frontmatter; Agora’s own repo is never grantable |
| **Notify** | WhatsApp hop via OpenClaw; dry-run by default; not a session trigger |

### How a run works

1. You broadcast into a room (UI, WhatsApp relay, or tooling).
2. The orchestrator **plans**: answer in chat, or open a goal and assign work.
3. **Answer path:** one (or a few) replies, often tools off, then stop.
4. **Work path:** create goal + steps → loop of decision → specialist turn → optional parallel wave → progress review.
5. Each turn: build L0+… prompt → spawn one CLI child → stream into the UI → enforce length → post markers into the transcript.
6. Stop when the goal is done, blocked, wall-clock/cost caps fire, max review rounds hit, or you press Stop.

Direct `@agent` / DM rooms skip the planner and run a single turn.

Every hard stop is enforced in code, not left to the model:

| Cap | Default | Setting |
|---|---|---|
| Turns between progress reviews | 12 | `AGORA_MAX_TURNS` |
| Review rounds before hard stop | 6 | `AGORA_MAX_ROUNDS` |
| Review also on the clock | 10 min | `AGORA_REVIEW_EVERY_MS` |
| Run wall clock | ~90 min | `AGORA_RUN_TIMEOUT_MS` |
| One turn timeout | 5 min | `AGORA_TURN_TIMEOUT_MS` |
| Concurrent CLI processes | 2 | `AGORA_MAX_CONCURRENCY` |
| One run per room | always | — |
| Stop button | kills the child process | — |

`AGORA_MAX_TURNS` is a **review interval**, not a hard stop. Concurrency stays
low on purpose: Cursor and Claude CLIs share account rate limits with your
normal IDE use.

### Repo layout

| Path | Contents |
|---|---|
| `apps/server/` | Harness: orchestrator, protocol, registry, drivers, DB, notify |
| `apps/web/` | Vite/React control plane |
| `agents/<room>/` | One folder per chatroom: its crew, and `_room.md` beside them |
| `agents/_shared/` | Crew that belongs to more than one room |
| `templates/agents/` | Forgeable capability bundles |
| `scripts/` | Wrappers (KooyaPedia, erasr, eval, WhatsApp relay, Chrome CDP) |
| `skills/` | Optional L4 skill packs |
| `eval/` | Protocol / length eval tasks |
| `data/` | `agora.db` |
| `session_memory/` | Human handover notes — **not** loaded into agent context |

### Claude and Cursor

- **Browser** — rooms, streaming, goals, Allow/choices, stop/resume, agent CRUD.
- **Cursor CLI** — **primary engine** (`AGORA_DRIVER=cursor`); Create Agent
  offers Cursor model ids; Claude-style `model:` + `effort:` in agent files are
  baked into Cursor ids at load time. Weaker system-prompt story; mode flags
  instead of per-agent Shell grants.
- **Claude CLI** — opt-in via `AGORA_DRIVER=claude`; full `--system-prompt` +
  JSON schema validation; per-agent `--tools` / `--allowedTools`.
- **Hybrid** — agent prose on Cursor; planning / deciding / compacting on Claude.

Editing an agent's `.md` on disk also works: the watcher reloads the roster
without a restart.

### Local services (KooyaPedia pattern)

Long-lived tools (wiki, etc.) are reached through **shell wrappers**, not raw
file/DB access from the model. Agents with Bash can bring KooyaPedia up via
`scripts/kooyapedia-start.sh` (house-allowed); lookup/edit stay grant-gated.
Same idea for erasr and `agent-edit.sh`.

## Run it

```bash
cp .env.example .env      # first time only
pnpm install
pnpm dev                  # server on :8787, web on :5183
```

## Agents

One markdown file per agent, in its room's folder. The file is the source of
truth: the Create Agent form in the UI writes exactly this format, and a file
watcher reloads the roster when you edit one by hand.

```
agents/
  trunks/            one folder per chatroom
    _room.md         L2 — what this room is about
    n0tail.md        …its crew, one file each
  project-norm/
    _room.md
    megan-fox.md
  _shared/           crew that belongs to more than one room
    fury.md
```

An id names exactly one file, so an agent in two rooms lives in `_shared/`
rather than being copied — two copies would drift. Folders are one level deep:
`agent-edit.sh`, the mechanics' only write path, refuses anything deeper. The
older flat `agents/<id>.md` is still read, so an old checkout or a file dropped
in by hand keeps working; nothing is written flat any more.

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

Forge copies templates from `templates/agents/` byte-for-byte — agents never
invent their own tool grants.

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
