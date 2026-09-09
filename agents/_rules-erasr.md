# Room rules — Erasr

Everything here is specific to the erasr application. It layers on top of the
shared house rules, which already carry the escalation limits and the rule about
how a message to Dominic's phone must read. Loaded because this room is named
"Erasr" — rename the room and this file stops loading.

## What this room owns, and what it does not

erasr is a local-only erase-and-generate studio: a Next.js app at
`C:\Projects\erasr` driving ComfyUI on `127.0.0.1:8188`. Nothing leaves the box.

**This room owns the application.** The workspace and its design system, the
worker pool and job lifecycle, the graph templates and engine client, the mask
pipeline, the API routes, and the benchmark.

**The Trunks room owns the models.** Which video model, what quantization, what
fits in 12 GB, what the eval says about generation quality — that is theirs, and
they use erasr as a harness to answer it. A question about *choosing* a model is
not this room's. A question about *wiring* one is.

Both rooms can write this tree. If a change touches `workflows.ts` model
constants or the generate route, say so before making it — a silent collision
between two rooms costs more than the message.

## The invariants

Each of these cost hours the first time. They are not style.

### I1. `ERASR_WORKERS` stays 1 on this machine

12 GB fits exactly one model. A second concurrent job is not slower — it is an
out-of-memory crash that also destroys the first job's timing. The number appears
in exactly one place (`queue.ts:77`) so that scaling to a rented 80 GB card never
becomes a rewrite. Raising it here is not that.

### I2. The pool is cached on `globalThis` — restart after every `queue.ts` edit

```
queue.ts:980   export const pool = g.__erasrPool ?? (g.__erasrPool = new Pool());
```

Hot reload does not respawn it. A change to `queue.ts` appears to do nothing until
the process is replaced, and the natural next move — change it again, harder —
makes it worse. `erasr-job.sh --restart` is the restart.

### I3. Node ids are a contract, and breaking it is silent

```
RESULT_NODE = "7"      MASK_NODE = "91"      VIDEO_RESULT_NODE = "9"
```

Renumbering without updating these does not throw. The submit succeeds and the
app reports **"engine returned no image"** — a message that points at the engine
rather than at the constant.

### I4. The path is `C:\Projects\erasr` — capital P

Casing has cost this project time before.

### I5. A script edited from Windows over `//wsl.localhost` loses its exec bit

It presents as `RC=126` and an idle engine while the room believes it submitted.
Anything under `scripts/` that is edited needs `chmod +x` afterwards, and the
check is `ls -la`, not assumption.

### I6. The prompt reaches the engine in the words the person typed

The app deliberately does **not** strip words from a prompt. `remove anything`
works and `anything` does not, so stripping the verb would have made it worse.
That behaviour is guarded by a benchmark case; if you find yourself normalising
user text, stop.

### I7. The benchmark drives the running app

Both the engine and `pnpm dev` must be up. A set that fails on one shared cause is
a wasted run, not a measurement.

## Measurement over inspection

The project's own README puts it plainly: the benchmark is how a change gets
proven instead of argued about.

- **`residual` low is bad.** Inside the mask, small pixel change means the model
  rebuilt the object instead of removing it.
- **`drift` above ~0 is bad.** Pixels outside the mask were damaged. The measure
  ignores a 20px band around the mask on purpose — feathering is supposed to
  change those.
- **`seconds` alone says nothing.** It moves with engine warmth. A case at 6.6s
  against a 3.4s baseline with byte-identical metrics is a cold engine.

Nothing is "better" until it has been run `--against baseline`.

## Add a case whenever a bug is found

Every case in `bench/cases.json` carries a `why` naming what it guards. Two exist
only to catch a regression rather than to look good:

- `car-verb-prefix` drops to zero the moment someone adds prompt-stripping
- `abstract-noun-finds-nothing` fails if detection becomes indiscriminate

A bug found and fixed without a case is a bug that can come back quietly.

## Do not rediscover the settled findings

These were measured here and are recorded in the README and `session_memory/`.
Overturning one is a real finding; repeating the investigation is not.

| Settled | Measured |
|---|---|
| Text is vocabulary-bound | `car` 54.5%, `anything` 0.0%, `object` 0.2% |
| Clicking generalises where text cannot | a graph node with no nameable concept selected exactly |
| Shift-click subtracts | 54.5% → 34.9% with two shift-clicks |
| `refine_iterations` 1 vs 3 | identical mask; stays at the node default |
| Box prompts | 66× noisier than a point; box+point, the point dominates |
| Crop-and-stitch has a limit | on a ~55% mask it does not help — that is the Quality tier's job |

## Ownership

| Area | Owner | Needs the card |
|---|---|---|
| Workspace UI, components, design system | **Rusty** | no |
| Worker pool, job lifecycle, SSE, `/api/jobs` | **Livingston** | no |
| Graph templates, engine client, capabilities | **Basher** | no |
| Mask quality, coverage, the polish pass | **Linus** | yes |
| Benchmark, metrics, baseline, verdicts | **Saul** | yes |
| Routing, sequencing, the lease | **Danny** | no |

Reaching outside your area is a collision, not a shortcut. Report the boundary
and hand it over.

**Saul holds no edit grant by design.** Whoever builds a thing does not also
grade it. Do not route an edit to Saul because he is free.

## The engine lease

One GPU, one job — see I1. Danny grants the lease in the assignment, in words:

```
ENGINE: yours — <what may be run>
```

Holding `erasr-job.sh` or `erasr-bench.sh` is not holding the lease. Submitting
outside it means two results arrive interleaved on a one-worker pool and neither
set of timings is worth anything.

The engine door refuses to queue behind an active job rather than waiting. That
refusal is a report, not a failure.

**ComfyUI itself stays Dominic's to start.** No wrapper starts it, and a room
that finds the engine down says so rather than working around it.

## The design system is a system

Monochrome, no hue anywhere. State is carried by form: **solid** finished,
**hatched** working, **dashed** waiting or absent. Space Mono for data and
numbers, Work Sans for prose, both self-hosted. Light and dark follow the OS.

Adding a colour, a third typeface or a fourth state form is a change to the
system and is said out loud, not made inside a component.

## Working log

`session_memory/memory-erasr-<month><day>.md`, one file per working day, same
shape as the entries already there. Measurements, not impressions. Traps, flagged
clearly. Parallel edits by another room or person, flagged so they are neither
claimed nor reverted by accident.

What does not belong there: anything the repo already says. Code structure lives
in the code, how to run it is in the root README, and repeating them creates a
second copy to go stale.
