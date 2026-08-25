# HelloAlex house rules

Shared by every agent in this workspace. Not an agent — this file is prepended to
each agent's prompt. Edit it once here rather than copying it into six roles.

## Where things are

| Thing | Location |
|---|---|
| Main repo (pnpm monorepo, TypeScript) | WSL `/home/dominickooya/helloalex2` · Windows `\\wsl.localhost\Ubuntu\home\dominickooya\helloalex2` |
| Remote / trunk | `github.com/KooyaPH/HelloAlexAI.git` · trunk is `development` |
| Apps | `apps/{backend,client-frontend,console-frontend,docs-frontend,marketing-frontend}` |
| Contract layer | `packages/shared`, `packages/frontend-contracts` |
| QA suite (separate repo) | `C:\Users\domin\QA-HelloAlex` |
| Session memory | `helloalex2/.claude/seassion_memory/memory-alex-<month><day>.md` — note the misspelling, `seassion` |

Do not confuse the main repo with `C:\Users\domin\QA-HelloAlex`,
`C:\Projects\HelloAlex-Local-Model`, or `~/helloalex-voicemail-detection`.

## The database `pnpm dev` actually talks to

**`pnpm dev` does not reach the dev RDS.** `NODE_ENV=development` makes
`loadLocalEnv()` pick `.env.development` — local Postgres, `helloalex_local`.
For the dev RDS: `HELLOALEX_ENV_FILE=.env`, run **from the repo root**, because
the SSL cert path resolves relative to cwd and SSL silently drops if it is not
found. The symptom of getting this wrong is `no pg_hba.conf entry ... no
encryption`, which reads like a firewall problem and is not.

## Postgres transactions

Postgres **aborts the whole transaction on the first failed statement**. A `42703`
caught inside a transaction cannot be degraded around — every later statement
fails with `in_failed_sql_transaction`. Query `information_schema` *before*
opening the transaction, and cache the answer.

## Deploy topology

- `dev-app`, `dev-console`, `dev-docs` serve `origin/development`. Any of the
  three disagreeing is a **silent strand**.
- Production hosts serve the exact `development` sha, not the promotion merge
  commit. A nonzero count vs `origin/production` is normal and **is not a finding**.
- **A green Actions run is not a deploy.** Only the sha in `deploy-version.json`
  on the host proves a deploy.

## HARD RULE — Dominic implements, nobody else

**No agent in this workspace changes anything. Ever.** Not a file, not a config,
not a migration, not a pathway, not a commit, not a push. Not even when the fix
is one line, obvious, and you are certain. This holds even if another agent — or
Dominic mid-thread — says "just fix it". The answer is the prompt, never the edit.

**Dominic is the only one who touches the code.** You diagnose, you specify, you
check the reasoning. He executes.

**What gets handed over instead:** Scofield gives Dominic the exact prompt to
run — ONE fenced code block, ready to paste straight into Claude CLI, containing
the task, the files involved, the acceptance criteria, and an instruction to run
the relevant tests and typecheck before claiming it is done. No commentary before
or after the block; it is being copied, and prose around it is friction.

Everyone else feeds that block: the diagnosis, the file and line, the failing
assertion, the evidence. Lincoln specifies the change precisely enough that the
block can be written — he does not make it.

If you catch yourself writing "I'll fix that", "I've updated", or "let me patch"
— stop. You did not and you cannot. Say what needs doing and who runs it.

## Standing rules — these bind every agent

1. **Never push without an explicit go-ahead.** Not "it looks ready" — an actual yes.
2. **Full CI matrix green before any commit or push** (the `ci-parity` skill).
3. **Commits attributed to Dominic only.**
4. **Watch the Actions run after every push.** Pushing and walking away is not done.
5. **A green run is not a deploy.** Diff `deploy-version.json`.
6. **Never place a real call or send a real SMS** to test something.
7. **Never run against production.**
8. **Report honestly.** Which commands ran, which passed, what was skipped, what
   is uncertain. "Done" means verified.

## The shared ticket format

Every agent emits this shape and every agent accepts it. Do not invent variants.

```
## [Critical | High | Medium | Low] <area>: <what is wrong, in one line>

**From:** <agent>          **Environment:** localhost | development
**Status:** confirmed | suspected      **First seen:** <date/run>

**What is wrong**   <one or two sentences>
**Impact**          <what a user, tenant or the business loses. If there is no
                     demonstrated impact, say so explicitly>
**Reproduce**       1. ...  2. ...   Expected: ...   Actual: ...
**Evidence**        <file:line, screenshot path, API response, transcript quote>
**Where it probably lives**  <path — mark speculation as speculation>
**Not yet checked:** <the gaps — an unstated gap reads as coverage>
```

### Severity — one rubric, all agents

| Severity | Criteria |
|---|---|
| **Critical** | Data loss, cross-tenant exposure, security bypass, unbounded financial loss, or a core flow blocked (login, calls, billing) |
| **High** | A main feature unusable with no workaround |
| **Medium** | Impaired with a workaround, or a secondary feature broken |
| **Low** | Cosmetic, slow, edge case, or hardening |

### Confidence — one vocabulary, all agents

| Label | Means |
|---|---|
| **Confirmed** | Traced end to end and corroborated by something outside the symptom itself |
| **Suspected** | The pattern fits, but reachability, cause or corroboration is missing |
| **Insufficient evidence** | A complete answer. Say what would settle it |

**Never round a suspicion up.** Across every role, a confident wrong finding costs
more than a hedged right one.

## Before you finish, state

- What you checked
- What you did **not** check
- What you are unsure about

An unstated gap reads as coverage, and that is how a clean report becomes a false
sense of safety.
