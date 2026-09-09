# House rules — moved

This file is no longer read. Editing it changes nothing.

Everything that was here is now **L0**, emitted from code at
`apps/server/src/protocol.ts` and prepended to every agent's prompt
automatically.

## Why it moved

As a file, this text was a convention: an agent file could contradict it, a new
agent could be created without it, and the agent editor could round-trip it into
a different shape. Six prompts drifting apart is the failure this codebase kept
relearning — the grant, the schema, the reporting path, the per-turn prompt and
each agent's own file each encoding the old world independently.

Emitted from code it is a contract. An agent cannot fail to have it, cannot edit
it, and cannot drift from it.

## Where things live now

| Layer | What it holds | Where |
|---|---|---|
| **L0 Protocol** | How every agent reads a room, writes into it, and reports | `apps/server/src/protocol.ts` — code |
| **L1 Grant** | Which doors an agent holds | derived from its manifest, never written by hand |
| **L2 Room** | What one project IS — paths, protocol, traps | `agents/_rules-<room-slug>.md` |
| **L3 Role** | Who one agent is | the body of `agents/<id>.md` |
| **L4 Skills** | What a capability adds | `skills/<name>/` |
| **L5 Memory** | Mind stone and transcript | the database |

To change how **every** agent behaves, edit `protocol.ts` and bump
`PROTOCOL_VERSION`. To change what one **room** is about, edit that room's
`_rules-` file. To change who one **agent** is, edit its file's body.

Lower layers may add to L0. None of them may subtract from it.
