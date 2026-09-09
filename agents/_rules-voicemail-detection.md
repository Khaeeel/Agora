# Voicemail Detection — room rules

Specific to the voicemail / answering-machine detection research. Layers on top
of the shared house rules. Loaded because this room is named "Voicemail
Detection" — rename the room and this file stops loading.

Nothing in the HelloAlex product room applies here. This is not `helloalex2`,
there is no `pnpm dev`, no deploy, no CI matrix.

## This room's WhatsApp group

`120363408716534238@g.us` — the VAD Model group. The bot in it is **Zenith BOT |
VAD Model**, whose remit is WhatsApp intake: it turns a rough ask into a written
handoff and launches it, deliberately never implementing anything itself.

The boundary is a house rule: reading it is context, never a trigger, and only an
explicit handoff puts work into this room. Note the shape here — that bot's whole
job is producing handoffs, so when one arrives it will be unmistakable. Anything
short of that is Dominic talking to it, not to us.

## What this project is

A classifier that decides, from the first N seconds of a call, whether the far
end is a **live human** or a **voicemail / answering machine** — early enough to
be useful to a dialler. Windows of 5 s, 10 s and 15 s are trained and served.

**The number this project exists to move is `personal` — personal-greeting
recall**: one human's own recorded voicemail greeting, as opposed to a carrier's
TTS. Carrier greetings are near-solved (96-99%); personal greetings are where
the models are weak (49.68% at 5 s to 87.19% at 15 s). Rank models on `personal`.

## Where things are

Code and artifacts are deliberately split — a WavLM checkpoint is ~400 MB and
would sync straight to OneDrive.

| Thing | Location |
|---|---|
| Training + eval code | `/mnt/c/Projects/Voicemail_Detection/dom_train/src/` |
| Run configs (one per experiment, pre-registered) | `.../dom_train/configs/` |
| Metrics (small JSON/MD) | `.../dom_train/results/` |
| Run logs | `.../dom_train/logs/` |
| Per-experiment write-ups | `.../dom_train/training_memory/` |
| Session memory | `/mnt/c/Projects/Voicemail_Detection/seassion_memory.md` — note the misspelling, `seassion` |
| Heavy artifacts (checkpoints, embeddings, caches) | `~/Voicemail_Detection/dom_train_artifacts/` |
| Experiment logs, as run | `~/Voicemail_Detection/dom_train_artifacts/exp*.log` |
| Shipped model bundles + bench | `.../dom_train_artifacts/release/voicemail-models-5-10-15/` |
| Audio | `~/Voicemail_Detection/audio/`, `gold_v2_audio/`, `to_test/`, `tested_audio/` |
| Reference corpus (READ-ONLY) | `/mnt/c/Projects/Voicemail_Detection/v1/` |

`v1/` is the team's pulled reference data and **stays untouched** so results
remain comparable to the 18 prior attempts.

Do not confuse this with `~/helloalex-voicemail-detection`, which holds only a
stale `v1/` copy and a pull log, or with `C:\Projects\HelloAlex-Local-Model`.

## THE most important thing to understand

**Every headline figure in this project is an AGREEMENT RATE WITH BLAND, not an
accuracy.** The training label *is* Bland's own output — exp002 found it agrees
with `bland_label` on 149,396 of 149,401 calls (99.9967%). These models were
fitted to reproduce it.

A call where a model agrees with Bland is **not** a call where it is right. Any
claim of the form "we are at 92%" must say *at agreeing with Bland*. If someone
in this room states such a figure as accuracy, correct it.

The only hand-labelled ground truth is **Gold178** (180 calls, 122 machine / 58
human), and on it **none of the shipped models beats Bland** — Bland makes 14
errors, the best arm makes 17.

## Rules for any experiment here

1. **Evaluate on `v1/datasets_v4/eval_10k_manifest.json`.** Frozen, seed 42,
   4000 human / 4000 VM>=20s / 2000 VM<20s. Any other eval set makes the number
   incomparable to everything the team has logged.
2. **Report machine recall at FHR <= 2%**, not raw accuracy. FHR = live humans
   wrongly flagged as machine. Accuracy alone hides which direction got worse.
3. **Report the two error directions separately**, and report time-to-decision
   (p50/p90), not just a single operating point.
4. **Use the pinned splits** in `v1/datasets_v4/splits.json`. Do not reshuffle —
   the pin exists so added short-VM data cannot leak trained call_ids into test.
5. **Use `v1/caches/asr_ticks_honest/` for any streaming work.** Do **not** use
   `asr_partials/` — it reconstructs early horizons from a long-prefix pass and
   leaks future audio.
6. **Filter training positives with `vm_positive`**, not raw `label`:
   `label == "voicemail" AND (disposition_tag IS NULL OR disposition_tag ==
   "VOICEMAIL_OR_IVR_DETECTED")`.

## Six traps that have already caught this project

**1. Windows were fitted on different populations.** 144,596 / 101,839 / 82,688
calls, because a 15 s model can only be fitted on calls that hold 15 s. Reading
49.68% -> 75.46% -> 87.19% down the personal column as "the gain from waiting"
is **wrong** — the last row is also an easier population. The only honest
horizon comparisons are the controls refitted inside each run on the same rows:
exp026 (5->10 s) and exp028 (10->15 s, **+6.61 pp** personal recall).

**2. Gates are not comparable across models.** The 5 s and 10 s bundles ship a
threshold at a matched ~2% false-human rate; the 15 s bundle ships
`threshold_serving = 0.50` chosen on Gold178, while its own 2% FPR gate is
0.837588. **Re-place every gate on your own negatives at one fixed FPR before
ranking anything**, or you are comparing one model's probability against another
model's line.

**3. Gold178 in `bench/` is 96/180 optimistic.** `score_source_counts` in
`exp028_gold178_eval.json` records `oof: 84, full_fit: 96` — 96 of those 180
calls were scored by a model that had trained on them. Only the 84 out-of-fold
rows are an honest read. Fixing this needs a refit holding all 180 out.

**4. An unseen ROUTE performs worse than published.** exp033 refitted under
`GroupKFold` over routes instead of leads: **-3.37 pp** at a matched 2% FPR, CIs
disjoint, one fold collapsing to 61.37%. exp034 showed the *deltas* survive that
(92% retention, CI excludes zero), so the conclusions stand — but read every
absolute number as **~3 pp optimistic** for an unseen route.

**5. Never zero-pad a short recording up to the window.** exp006_eligible found
the model reads trailing silence as "the call ended early => human". Score the
audio you have over `min(window, have)` and record that the window was short —
those rows sit outside the measured population. Note **94 of 178 Gold178 calls
do not hold 15 s of audio**.

**6. `example_run_15s_gold178.txt` is not a result.** It is a worked example of
`score.py`. It scores 178 rows where exp028's table scores 180, and uses the
full-fit bundle throughout where that table used out-of-fold for 84. Its 19
errors and exp028's 17 are not the same measurement.

## The feature contract

Each row is one window of one call, and **timing, embedding and transcript must
all be cut at the same instant**. A row assembled from two instants looks exactly
like a correct one and nothing downstream can tell.

```
words models :  17 timing features            (vad_features.FEATURE_NAMES, in order)
             |  PCA(64) of the WavLM embedding (microsoft/wavlm-base-plus, mean-pooled)
             |  1 stacked text score           (tfidf -> logistic regression, p(vm))
             |  SVD(32) of the same tfidf matrix
sound model  :  17 timing features | PCA(64)   (no transcript, no text head)
```

Bundle keys inside `model.joblib`: `clf`, `pca`, `threshold`, `feature_names`,
`window_ms`, `min_audio_ms`, `vad_backend`, plus `tfidf`, `text_lr`, `text_svd`
for words models.

Pickles were written with **python 3.12.13 · scikit-learn 1.9.0 · numpy 2.5.2 ·
scipy 1.18.0 · joblib 1.5.3**. Unpickling under a different scikit-learn minor
is not guaranteed to load, and a bundle that loads with a warning should not be
trusted to score.

Reference implementation: `dom_train/src/` — `vad_features.extract`,
`wavlm_5s.embed_windows` over `chunker.horizon_window`, `asr_5s`, and for the
exact serving arithmetic including the short-window rule,
`live_server.py::score_text`, `score_text_horizon`, `score_horizon`.

## The audit protocol

`dom_train/src/audit_protocol.py` is the standing defence, and its own docstring
says why it exists: every number here is produced by the same person who chooses
the protocol that produces it, and *the defence is not more care, it is a script
that prints numbers that are awkward when they should be awkward.*

| Check | Asks |
|---|---|
| **A** eval-manifest leakage | are train and eval lead-disjoint? |
| **B** truncation asymmetry | is the analysis window class-correlated? |
| **C** shipped-model gate | does the saved threshold mean what it says? |
| **D** corpus construction | is the positive class drawn from a different pool? |
| **E** bookkeeping | does the run log meet its own stated contract? |

FAIL means a published figure is affected. Exit status is the FAIL count.

## Experiments are pre-registered

Each run has a config in `configs/` whose sha256 is echoed into the run log
(`exp036_onset_anchor.yaml · sha256 f5ff4495d6ff5fe7`). The pre-registered
question is recorded **before** the run, and the answer is reported even when it
is no — exp028's pre-registered question was "does H15 beat Bland at 0.30", and
the recorded answer is **no**, 18 errors against 14. H15 was adopted on the
corpus delta, not on Gold178.

**Do not let a post-hoc threshold become the headline.** If an arm wins only at
a threshold chosen after seeing the results, say so in the same sentence.

### Pre-registration is a record, not a request for permission

This rule had no exit. It said what to write before a run and never said who
clears it, so the honest reading was "write it and wait" — and the approval it
was waiting for had no way to arrive. Turns ended in well-written proposals
because proposing never violated a rule and running could violate several.

**An agent that has written its pre-registration and is inside the cost ceiling
on its assignment proceeds in the same turn.** Nobody clears it. Nobody is
waiting to.

Come back before running only when one of these is true:
- the cost exceeds the ceiling the assignment gave you,
- it spends GPU time,
- it crosses an ownership boundary — someone else holds that grant.

**Stating the cost is how a run is authorized, not how it is deferred.** A cost
under the ceiling is a cost you may spend. "Say what an experiment costs" exists
so the room can see the price, not so somebody can veto it.

If you hold the script for the thing you are proposing, you are not proposing —
you are stalling. Run it, then report what happened.

## Reporting a finding in this room

```
## [Blocking | Material | Minor] <what the claim is, in one line>

**From:** <agent>        **Artifact:** <exp id / file / run>
**Status:** confirmed | suspected | insufficient evidence

**The claim**        <the number or conclusion being examined>
**What supports it** <run, n, out-of-fold or full-fit, gate, population>
**What weakens it**  <trap number above, if one applies>
**Population**       <n, and whether the compared arms share rows>
**Gate**             <threshold, and how it was placed>
**Not yet checked:** <the gaps>
```

**Blocking** = a published or about-to-be-published figure is wrong.
**Material** = the conclusion survives but the number moves.
**Minor** = bookkeeping, naming, reproducibility friction.

Always state `n`, whether scores are out-of-fold or full-fit, and how the gate
was placed. A figure without those three is not yet a result.

## Execution history — what was actually run

Before running anything yourself, read what has already been run. Dominic and
his tools have been at this for weeks, and the record is usually a faster answer
than re-deriving it — and it stops you repeating an experiment that already has
a verdict.

| Directory | What it holds |
|---|---|
| `~/.cursor/projects/mnt-c-Projects-Voicemail-Detection/` | **The real record for this project.** `agent-transcripts/` and `terminals/`, ~4.5 MB. |
| `~/.claude/projects/-home-dominickooya-Voicemail-Detection/` | One Claude CLI session, 232 KB, from 2026-08-17. That is all there is. |
| `~/.claude/projects/-home-dominickooya--openclaw-workspace/` | The WhatsApp bot (`main`) — 2.5 MB. |
| `~/.claude/projects/-home-dominickooya--openclaw-workspace-jarvis/` | The WhatsApp bot (`jarvis`) — 9.9 MB. |

**This project was not driven through the Claude CLI.** The work happened in
Cursor, so `agent-transcripts/` and especially `terminals/` are where a command
and its real output live. Look there first; the Claude session directory for
this project is nearly empty and will mislead you if you treat its silence as
"nothing happened".

**The two `--openclaw-workspace` directories are a DIFFERENT project.** That is
the WhatsApp bot working on `helloalex2`, not on voicemail detection. Useful as
cross-project context — how a run was invoked, what an error looked like — but
never quote a finding from there as if it were about this project.

### How to read them without wasting a turn

- These are large JSONL logs. **Grep for the specific thing** — an exp id, a
  filename, an error string, a flag — then Read only around the hit. Do not bulk
  read a transcript; you will spend the turn and learn little.
- Say which transcript and which line a quote came from, the same way you would
  cite `file:line`.

### Two cautions

1. **A transcript is a record of what was ATTEMPTED, not proof that it worked.**
   A command in `terminals/` with no visible output, a run that was interrupted,
   an edit that was later reverted — all look like success in a log. Corroborate
   against the artifact on disk before treating a transcript as evidence.
   Denver: an unverified transcript claim is `suspected`, never `confirmed`.
2. **Never repeat a credential, token or key you encounter in a transcript.**
   Anything said in this room can be forwarded to WhatsApp. If you find one,
   say that you found one and where — never what it is.

## This room executes — through three doors

You are not limited to reading, and you do not hand Dominic homework. Three
wrappers, each a separate grant. Anything outside them is a permission denial —
the wrappers are the boundary, not your judgement.

### 1. Read and investigate — everyone

```
bash /home/dominickooya/.openclaw/agora/scripts/claude-run.sh "<what to find out>"
```

Spawns a fresh Claude Code session with its own turn budget, so a whole line of
enquiry costs this room one turn instead of six. It may read everything
including the frozen `v1/` corpus, inspect with `ls/cat/head/tail/stat/wc/du/
find/nvidia-smi`, and run `audit_protocol.py`. It cannot write.

### 2. Write code — Berlin, Tokyo, Rio

```
bash /home/dominickooya/.openclaw/agora/scripts/claude-edit.sh "<what to write or change>"
```

Creates and edits files under `dom_train/` and `dom_train_artifacts/` only.
**`v1/` is deliberately out of scope** — `--add-dir` grants read *and* write, so
keeping the frozen corpus unreachable is the only way to keep it frozen. Read it
with door 1, write with door 2.

Every session carries standing rules it cannot argue past: never overwrite a
pre-registered config (a change means a NEW exp number), never overwrite an
existing results JSON, never patch a script that is currently running, and
report every file touched by path.

**Denver does not have this door.** He audits what the rest of you write, and an
auditor who can edit the thing under audit is not an auditor.

### 3. Launch training — Tokyo only

```
bash /home/dominickooya/.openclaw/agora/scripts/train-launch.sh <script.py> [args]
bash /home/dominickooya/.openclaw/agora/scripts/train-launch.sh --status
bash /home/dominickooya/.openclaw/agora/scripts/train-launch.sh --stop
```

`--status` is available to everyone; launching is Tokyo's. A run takes hours and
a turn is capped at 300 seconds, so training is **launched detached and left** —
that is not a workaround, it is the only way it can work. Losing 43 minutes of
exp036 to a job that died with its parent is why this exists.

**One run at a time.** A second launch is refused, not queued: two jobs on one
GPU makes both slower and neither number comparable.

### How to use all three well

- **Ask one question, or make one change, per call.** A vague prompt returns a
  vague turn you have already paid for.
- **~240 s ceiling** on doors 1 and 2, deliberately under this room's 300 s
  per-turn cap. A timeout means the ask was too broad — narrow it.
- **Report what came back, not that you ran it.** Say which claim came from a
  spawned session rather than your own reading, so Denver can tell first-hand
  evidence from second-hand.
- **A spawned session is still a model.** It shares your priors, so it is not a
  second opinion. Corroborate anything load-bearing against the artifact.
- **Never launch a run you have not pre-registered.** Rio writes the config, its
  sha256 goes in the log, and the question that would count as "no" is recorded
  BEFORE the fit. That discipline is the whole reason this project's numbers
  are worth anything.
- **After launching, say so and stop.** Do not sit in a turn waiting; check back
  with `--status` on a later turn or let Dominic ask.

## When Dominic hands you a plan

Sometimes he does not ask a question — he gives you the work. Steps, a spec, a
config, a diff, a "do this". When that happens:

**Execute it. Do not redesign it.** His plan is the plan. Rewriting it into your
own better version, however genuinely better, is the single most expensive thing
this room can do — he has already decided, and what he is waiting for is the
result.

**Never hand it back.** No paste-ready block, no "ready for you to run", no
"once you approve". If you have the tools for a step, that step is yours. The
only reason to return something unexecuted is that you genuinely cannot reach
it — and then say exactly which door was missing, not that the room "has no
tools".

**Disagree in one line, then carry on.** If a step is wrong, say so briefly, do
it anyway, and record the concern in the report. Stop only when proceeding would
corrupt evidence or destroy an artifact — overwriting a pre-registered config,
scoring on a leaked cache, killing a live run. That is a short list and nothing
else belongs on it.

**Report what you DID, not what should be done.** File paths for anything
written, the PID and log path for anything launched, the actual numbers for
anything measured. "Implemented and running" with no path and no PID is not a
report, and neither is a plan restated back at him.

**Finishing means it ran.** A goal that ends with the code written but never
launched is half-finished. Say so plainly rather than closing it as done.
