# Event map

What the server sends, what the client sends, and how protocol markers
relate. There is no second event bus. WebSocket `ServerEvent` is the live
contract. SQLite messages are the durable transcript. Protocol markers are
parsed out of agent prose into columns on those rows.

## WebSocket

Path: `GET /ws` on the API server (port 8787). The Vite dev server proxies
it. Every socket receives every event. `ClientCommand` includes `subscribe`,
and the server ignores it: there is no per-room filter.

### Client → server

| `type` | Fields | Handler |
|---|---|---|
| `broadcast` | `roomId`, `text` | `@id` → `direct`; `dm:` room → `direct`; else `start` |
| `answer` | `roomId`, `messageId`, `label` | `answerChoice`, then `decideAccess` or `start` |
| `resume` | `roomId`, `goalId` | `start(roomId, "", goalId)` |
| `stop` | `roomId` | `stop`; emits `error` if nothing is running |
| `subscribe` | `roomId` | Defined on the type, not handled |

Malformed JSON is dropped. An empty `broadcast` text is dropped.

### Server → client

Defined as `ServerEvent` in `apps/server/src/types.ts`.

| `type` | When | Payload |
|---|---|---|
| `hello` | Socket open | rooms, agents, notify flag, driver, model catalog |
| `status` | Socket open | per-agent idle/busy map |
| `runs` | Socket open, and whenever the run map changes | every live `RunState` |
| `agents` | Roster reload or forge/delete | full agent list |
| `rooms` | Room create, members, forge, DM | full room list |
| `message` | `Orchestrator.post` | one new `Message` |
| `message_update` | A choice was answered | the same message, updated |
| `turn_start` | Before a streamed turn | `roomId`, `agentId`, `directedBy`, `turn` |
| `delta` | Driver stdout text | `roomId`, `agentId`, `text` |
| `turn_end` | Turn finished streaming | `roomId`, `agentId` |
| `run` | Phase or field change on one run | `RunState` |
| `goal` | Plan, step update, close, reopen | full `Goal` with steps |
| `mind_stone` | Compaction saved | `roomId`, `MindStone` |
| `rate_limit` | Driver reported a limit | `roomId`, `detail` |
| `error` | Missing room, bad stop, thrown run | `roomId`, `detail` |

`run` and `runs` are both emitted from `publishRun`. Clients that only
listen to one of them still see the change if they listen to the other.

Ordering: events are sent in the order the server emits them, on a single
Node thread, with no per-run sequence number on the envelope. The durable
order is `messages.seq`, unique per room. Deltas are not persisted and have
no sequence of their own. A reconnect gets a fresh `hello` plus current
`runs`; it does not replay deltas. The transcript is loaded with
`GET /api/rooms/:id/messages`.

### Inbound WhatsApp

`scripts/agora-ask.mjs` is a separate process. It opens the same WebSocket
and sends `broadcast`. It is not a REST route. Authorization is whatever the
relay process already trusts; the server does not check a sender on the
socket.

## REST

No auth middleware. CORS origin is `true`.

| Method | Path | Run-related |
|---|---|---|
| `GET` | `/api/state` | Includes `statuses` and `driver`. Not the live `RunState` |
| `GET` | `/api/rooms/:id/messages` | Transcript (capped), current `run`, mind stone, memory |
| `GET` | `/api/rooms/:id/mind-stone` | Mind stone only |
| `GET` | `/api/rooms/:id/goals` | Goals and steps |
| `GET` | `/api/stats` | Counts and cost |
| `POST` | `/api/rooms` | Create room |
| `PUT` | `/api/rooms/:id/members` | Replace members |
| `DELETE` | `/api/rooms/:id/members/:agentId` | Remove one member |
| `POST` | `/api/dm/:agentId` | Open a DM room |
| `POST` | `/api/agents/preview` | Markdown preview |
| `POST` | `/api/agents` | Write a new agent file |
| `GET` | `/api/agents/:id` | One agent |
| `PUT` | `/api/agents/:id` | Edit agent file |
| `DELETE` | `/api/agents/:id` | Retire a forged agent only |

Runs are started only over the WebSocket. REST does not start, stop, or
resume one.

## Protocol markers

`PROTOCOL_VERSION` is `6`. `parseMarkers` in `protocol.ts` reads agent prose:

| Marker | Rule |
|---|---|
| `kind:` | First non-empty line. Act is `claim`, `question`, `result`, or `pass`. A body that is only `PASS` counts as `pass`. |
| `[#seq]` | Any citation in the body. Stored as `messages.refs` JSON. |
| `@next:` | Last non-empty line. Agent id, stored as `messages.next_id`. |

`Orchestrator.post` is the only insert path for room messages. For
`kind === "agent"` it parses markers, logs `{event:"markers",...}`, and
writes `act`, `refs`, `next_id`, plus `protocol_version`. Missing markers
are logged (`missing`) and stored as SQL NULL. They do not reject the turn.

`normalizeReply` runs before post, inside the length path: if `kind:` is not
already the first line, narration before it is dropped and logged
(`event: "normalized"`). `@next:` glued to the last sentence is moved onto
its own line.

`AGORA_FAST_DISPATCH` defaults off. `@next` is recorded and not used to skip
the decision turn. Turning it on is a behavior change and is out of this phase.

Speech-act word budgets (`REPLY_LIMITS`): 45 words for non-results, 80 for
`result`, 900 characters as the hard size that triggers a rewrite when
`AGORA_LENGTH_GUARD` is on. The rewrite is another model call. The original
is not sliced.

## Structured model output vs events

Planning, deciding, progress review, and mind-stone compaction ask the
driver for JSON (`schema` on `DriverRequest`). That JSON is not a
`ServerEvent`. The orchestrator turns accepted fields into goal rows, step
updates, and transcript messages. Cursor has no `--json-schema`; the cursor
driver extracts JSON from prose. Claude validates against the schema. A
structured turn that yields no object is a driver error string, not a
silent success.

## What is not an event

- Tool calls are a `DriverEvent` of type `tool_use`. The orchestrator folds
  the name into `RunState.phaseDetail` and may emit `status`. They are not
  their own WebSocket type.
- Process exit codes stay inside the driver and surface as `final.isError`
  plus text. They are not a column.
- Cap hits are `stopReason` on `RunState` and a system transcript line.
  There is no `cap_fired` event.
- Notification failure is a `notify` message with `delivered: false`, or a
  system `event` line when the room has no JID. `notify()` also
  `console.error`s.
