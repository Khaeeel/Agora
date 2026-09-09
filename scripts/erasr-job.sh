#!/usr/bin/env bash
#
# erasr-job.sh — the Trunks room's engine door.
#
#   bash erasr-job.sh data/out/6c5bfecf_src.bin prompt="the car" mode=lama
#   bash erasr-job.sh --status
#   bash erasr-job.sh --restart
#   bash erasr-job.sh --meta <jobId>
#
# WHY THIS EXISTS
# Every goal in this room ended the same way: a finding that could only be
# settled by running something, an ask sent to Dominic, and a run that stopped
# — because `blocked` never picks itself back up. The room's rules already
# described a lease system ("an agent holding ENGINE: yours runs the jobs its
# assignment needs without coming back to ask"), but neither erasr-run.sh nor
# erasr-edit.sh can submit a job, so the lease was never something an agent
# could actually hold. This is the missing door.
#
# THE LEASE STILL GOVERNS IT. Holding this script is not holding the lease;
# `ENGINE: yours` in the assignment is. That distinction is enforced in the
# prompts, not here — a wrapper cannot know whose turn it is.
#
# WHAT IT DELIBERATELY IS NOT
# Not a general shell. Every subcommand is spelled out below; anything else is
# a usage error. The agents hold `Bash(bash .../erasr-job.sh:*)` and nothing
# else, so this file is the whole security boundary: it cannot write project
# files, cannot touch git, cannot install anything, and cannot start a second
# job while one is running.
#
# THE ONE-GPU RULE (room rule 1, invariant I4)
# 12 GB fits one model. A second concurrent job is not slower — it is an
# out-of-memory crash that also destroys the first job's timing. A submit
# therefore REFUSES when the pool reports anything active or waiting, rather
# than queueing behind it: a silently queued job produces a result belonging to
# somebody else's run, and it will be read as yours. Exiting with that message
# is a report, not a failure.
#
# WHY EVERYTHING GOES THROUGH powershell.exe
# erasr is a Windows Next app talking to a Windows ComfyUI on 127.0.0.1, and
# WSL sits behind NAT — from here, loopback is a different machine's loopback.
# Driving the Windows side through powershell.exe is not a workaround; it is
# the only address that reaches the engine.
set -uo pipefail

PROJECT_WIN='C:\Projects\erasr'
PROJECT='/mnt/c/Projects/erasr'
BASE='http://127.0.0.1:3000'
PS='/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe'
CURL='/mnt/c/WINDOWS/System32/curl.exe'

MAX_WAIT=900
DEFAULT_WAIT=300
READY_WAIT=120

die() { echo "erasr-job: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage:
  erasr-job.sh <file> key=value ...
      Submit ONE job and wait for it, then print its _meta.json sidecar.
      <file> is project-relative: data/out/6c5bfecf_src.bin — or just the job
      id whose source you want to re-run, which is how an arm is held identical
      across a sweep.

      keys:
        mode=lama|flux      which tier. default lama
        kind=photo|video|generate|image_gen   default photo
        width=512           generate/image_gen frame width. generate defaults to 512
        height=320          generate/image_gen frame height. generate defaults to 320
        steps=20            generate (wan21) sampler steps override
        cfg=5               generate (wan21) sampler cfg override
        negative="..."      generate negative prompt override
        referenceWan21=true generate (wan21) — force Comfy-Org reference preset
                            (832x480, 30 steps, cfg 6, Chinese default negative)
        referenceWan22=true generate (wan22) — force Tier 2 reference preset
                            (832x480, 30 steps, cfg 5, Wan2.1 reference negative)
        style=ai|real       generate preset. default ai (route.ts defaults it
                            too, so omitting it is the same as ai)
        prompt="the car"    what to remove, in the words the person typed (I5)
        bgPrompt="..."      background prompt, generate/flux only
        points='[{"x":380,"y":980}]'      click points, absolute pixels
        negPoints='[...]'   points to exclude
        threshold=0.5       mask threshold
        frames=81           video/generate only
        seed=161803         optional engine seed (0 .. 2^31-1). omit for random
        withAudio=false     generate only; default false (LTX skips audio nodes)
        wait=300            seconds to wait for the job. max 900

      Typical erase is ~45s; a generate is ~3.5 min.

  erasr-job.sh --status
      Is the app up, is the engine busy, and the last few jobs.

  erasr-job.sh --restart
      Restart `pnpm dev` and wait until the API answers again. Required after
      ANY edit to queue.ts: the pool is cached on globalThis (invariant I2), so
      a change to it appears to do nothing until the process is replaced.
      It does NOT start ComfyUI — that stays Dominic's.

  erasr-job.sh --meta <jobId>
      Print that job's sidecar.
USAGE
  exit 64
}

# ── the Windows side ────────────────────────────────────────────────────────
# One place, so no subcommand can invent its own command line.
ps_run() { "$PS" -NoProfile -ExecutionPolicy Bypass -Command "$1" 2>&1 | tr -d '\r'; }

api_get() {
  ps_run "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 25 '$BASE$1').Content } catch { 'ERR ' + \$_.Exception.Message }"
}

dev_up() { case "$(api_get /api/jobs)" in ERR*|'') return 1 ;; *) return 0 ;; esac; }

# node is here and jq is not; parsing the JSON properly keeps this honest
# rather than grepping structure out of a string.
json_field() {
  printf '%s' "$1" | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c)).on("end", () => {
      let v;
      try { v = JSON.parse(raw); } catch { process.exit(3); }
      for (const k of process.argv[1].split(".")) v = v?.[k];
      if (v === undefined || v === null) process.exit(4);
      console.log(typeof v === "object" ? JSON.stringify(v) : String(v));
    });
  ' "$2"
}

require_dev() {
  dev_up && return 0
  echo "erasr-job: the app is not answering on $BASE." >&2
  echo "           run: bash erasr-job.sh --restart" >&2
  exit 1
}

# ── subcommands ─────────────────────────────────────────────────────────────
cmd_status() {
  local body
  body=$(api_get /api/jobs)
  case "$body" in
    ERR*|'')
      echo "app:     DOWN — $BASE did not answer"
      echo "         run: bash erasr-job.sh --restart"
      return 0
      ;;
  esac
  echo "app:     up"
  echo "workers: $(json_field "$body" workers)"
  echo "active:  $(json_field "$body" active)"
  echo "waiting: $(json_field "$body" waiting)"
  echo
  echo "last jobs (newest first):"
  printf '%s' "$body" | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c)).on("end", () => {
      const jobs = (JSON.parse(raw).jobs ?? []).slice(0, 8);
      if (!jobs.length) console.log("  (none — the pool is fresh since the last restart)");
      for (const j of jobs) {
        const ms = j.startedAt && j.finishedAt ? `${j.finishedAt - j.startedAt}ms` : "-";
        console.log(`  ${j.id}  ${j.kind}/${j.mode ?? "-"}  ${j.status}  ${ms}  ${j.error ?? ""}`);
      }
    });
  '
}

cmd_restart() {
  echo "restarting pnpm dev ..."
  # Two things here are load-bearing and both were learned the hard way.
  #
  # pnpm is resolved to its .cmd by ABSOLUTE PATH. `cmd /c pnpm` is what a
  # person types and it fails from here: Start-Process does not hand the child
  # an interactive PATH, so the shim is not found, cmd exits silently, and the
  # only symptom is a port that stays shut after the old server was already
  # killed — worse than never restarting.
  #
  # And the replacement is not started until port 3000 is actually free. Next
  # answers normally for several seconds while it dies, so starting straight
  # away races the old process for the port, and polling straight away reports
  # "up" against the corpse — the restart looks fine while the stale pool is
  # still the one serving, which is the exact I2 failure this ends.
  ps_run "
    \$ErrorActionPreference = 'SilentlyContinue'
    Get-NetTCPConnection -LocalPort 3000 -State Listen |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object { Stop-Process -Id \$_ -Force }
    \$t = 0
    while ((Get-NetTCPConnection -LocalPort 3000 -State Listen) -and \$t -lt 20) { Start-Sleep -Seconds 2; \$t += 2 }
    \$pnpm = 'C:\Users\domin\AppData\Roaming\npm\pnpm.cmd'
    if (-not (Test-Path \$pnpm)) { \$pnpm = (Get-Command pnpm.cmd).Source }
    Start-Process -FilePath 'C:\WINDOWS\System32\cmd.exe' -ArgumentList ('/c \"' + \$pnpm + '\" dev >> dev.log 2>&1') -WorkingDirectory '$PROJECT_WIN' -WindowStyle Hidden
    'started'
  " >/dev/null

  local waited=0
  while [ "$waited" -lt "$READY_WAIT" ]; do
    if dev_up; then
      echo "app is up after ${waited}s"
      echo
      cmd_status
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  die "the app did not come up within ${READY_WAIT}s — read $PROJECT/dev.log"
}

cmd_meta() {
  local id="${1:-}"
  [ -n "$id" ] || die "--meta needs a job id"
  case "$id" in *[!a-zA-Z0-9-]*) die "that does not look like a job id: $id" ;; esac
  local f="$PROJECT/data/out/${id}_meta.json"
  [ -f "$f" ] || die "no sidecar at data/out/${id}_meta.json"
  cat "$f"
}

cmd_submit() {
  local file="$1"; shift
  local mode="lama" kind="photo" prompt="" bgprompt="" points="" negpoints=""
  local threshold="0.5" frames="" seed="" wait_s="$DEFAULT_WAIT" style="" width="" height=""
  local videoModel="" withAudio="" steps="" cfg="" negative="" referenceWan21="" referenceWan22="" referenceHunyuan15=""

  for pair in "$@"; do
    case "$pair" in
      mode=*)      mode="${pair#*=}" ;;
      kind=*)      kind="${pair#*=}" ;;
      style=*)     style="${pair#*=}" ;;
      videoModel=*) videoModel="${pair#*=}" ;;
      width=*)     width="${pair#*=}" ;;
      height=*)    height="${pair#*=}" ;;
      steps=*)     steps="${pair#*=}" ;;
      cfg=*)       cfg="${pair#*=}" ;;
      negative=*)  negative="${pair#*=}" ;;
      referenceWan21=*) referenceWan21="${pair#*=}" ;;
      referenceWan22=*) referenceWan22="${pair#*=}" ;;
      referenceHunyuan15=*) referenceHunyuan15="${pair#*=}" ;;
      prompt=*)    prompt="${pair#*=}" ;;
      bgPrompt=*)  bgprompt="${pair#*=}" ;;
      points=*)    points="${pair#*=}" ;;
      negPoints=*) negpoints="${pair#*=}" ;;
      threshold=*) threshold="${pair#*=}" ;;
      frames=*)    frames="${pair#*=}" ;;
      seed=*)      seed="${pair#*=}" ;;
      withAudio=*) withAudio="${pair#*=}" ;;
      wait=*)      wait_s="${pair#*=}" ;;
      *) die "unknown key: ${pair%%=*} (see --help)" ;;
    esac
  done

  case "$mode" in lama|flux) ;; *) die "mode must be lama or flux" ;; esac
  case "$kind" in photo|video|generate|image_gen) ;; *) die "kind must be photo, video, generate or image_gen" ;; esac
  # route.ts:103 coerces a non-positive or non-numeric size back to the graph's
  # crop target rather than erroring, so a typo would silently render at the
  # default and the sidecar would record a size nobody asked for. Refuse here.
  [ -z "$width" ]  || case "$width"  in *[!0-9]*|0) die "width must be a positive whole number of pixels" ;; esac
  [ -z "$height" ] || case "$height" in *[!0-9]*|0) die "height must be a positive whole number of pixels" ;; esac
  [ -z "$steps" ]  || case "$steps"  in *[!0-9]*|0) die "steps must be a positive whole number" ;; esac
  [ -z "$cfg" ]    || case "$cfg"    in *[!0-9.]*) die "cfg must be a positive number" ;; esac
  case "$referenceWan21" in ''|true|false) ;; *) die "referenceWan21 must be true or false" ;; esac
  case "$referenceWan22" in ''|true|false) ;; *) die "referenceWan22 must be true or false" ;; esac
  case "$referenceHunyuan15" in ''|true|false) ;; *) die "referenceHunyuan15 must be true or false" ;; esac
  [ -z "$seed" ] || case "$seed" in *[!0-9]*) die "seed must be a whole number from 0 to 2147483647" ;; esac
  [ -z "$seed" ] || [ "$seed" -le 2147483647 ] || die "seed must be a whole number from 0 to 2147483647"
  # Rejected here rather than passed through: route.ts silently coerces anything
  # that is not "real" to "ai", so a typo would run the wrong arm and report the
  # preset it was not given — a mislabelled result is worse than a usage error.
  case "$style" in ''|ai|real) ;; *) die "style must be ai or real" ;; esac
  # Same reasoning as style above: route.ts:209 coerces anything unrecognised to
  # "wan21", so a typo would run the wrong model while the sidecar named the one
  # it was not given. This room adjudicates on sidecars, so a mislabelled clip is
  # worse than a usage error.
  case "$videoModel" in ''|wan21|wan22|ltx25|hunyuan15) ;; *) die "videoModel must be wan21, wan22, ltx25 or hunyuan15" ;; esac
  case "$wait_s" in ''|*[!0-9]*) die "wait must be a number of seconds" ;; esac
  [ "$wait_s" -le "$MAX_WAIT" ] || die "wait cannot exceed ${MAX_WAIT}s"

  # Resolve the source without letting a path out of the project's data dir.
  # The room only ever re-runs sources it already produced, so `data/out/<x>`
  # or a bare job id is the whole vocabulary; anything else is a mistake.
  case "$file" in
    *..*) die "no .. in the file path" ;;
    data/out/*) : ;;
    */*) die "file must be under data/out/, or just a job id" ;;
    *) file="data/out/${file}_src.bin" ;;
  esac
  local src="$PROJECT/$file"
  [ -f "$src" ] || die "no such source: $file"
  local src_win="$PROJECT_WIN\\data\\out\\$(basename "$src")"

  require_dev

  # One GPU. Refuse rather than queue.
  local body active waiting
  body=$(api_get /api/jobs)
  active=$(json_field "$body" active); waiting=$(json_field "$body" waiting)
  if [ "${active:-0}" != "0" ] || [ "${waiting:-0}" != "0" ]; then
    echo "erasr-job: the engine is busy (active=$active waiting=$waiting)." >&2
    echo "           Stop and report — do not queue behind it. A job that waits" >&2
    echo "           behind another produces a timing that belongs to that one." >&2
    exit 1
  fi

  echo "submitting: kind=$kind mode=$mode style=${style:-ai} videoModel=${videoModel:-wan22} source=$file threshold=$threshold"
  local args=(-s -S --max-time 180 -X POST "$BASE/api/jobs"
    -F "kind=$kind" -F "mode=$mode" -F "threshold=$threshold" -F "file=@$src_win")
  [ -n "$prompt" ]    && args+=(-F "prompt=$prompt")
  [ -n "$bgprompt" ]  && args+=(-F "bgPrompt=$bgprompt")
  [ -n "$points" ]    && args+=(-F "points=$points")
  [ -n "$negpoints" ] && args+=(-F "negPoints=$negpoints")
  [ -n "$frames" ]    && args+=(-F "frames=$frames")
  [ -n "$style" ]     && args+=(-F "style=$style")
  [ -n "$videoModel" ] && args+=(-F "videoModel=$videoModel")
  [ -n "$width" ]     && args+=(-F "width=$width")
  [ -n "$height" ]    && args+=(-F "height=$height")
  [ -n "$steps" ]     && args+=(-F "steps=$steps")
  [ -n "$cfg" ]       && args+=(-F "cfg=$cfg")
  [ -n "$negative" ]  && args+=(-F "negative=$negative")
  [ -n "$referenceWan21" ] && args+=(-F "referenceWan21=$referenceWan21")
  [ -n "$referenceWan22" ] && args+=(-F "referenceWan22=$referenceWan22")
  [ -n "$referenceHunyuan15" ] && args+=(-F "referenceHunyuan15=$referenceHunyuan15")
  [ -n "$seed" ]      && args+=(-F "seed=$seed")
  if [ "$kind" = "generate" ]; then
    args+=(-F "withAudio=${withAudio:-false}")
  fi

  local resp id
  resp=$("$CURL" "${args[@]}" 2>&1 | tr -d '\r')
  id=$(json_field "$resp" job.id) || die "the app rejected it: $resp"
  echo "job:        $id"

  local waited=0 status="" one
  while [ "$waited" -lt "$wait_s" ]; do
    sleep 5; waited=$((waited + 5))
    one=$(api_get "/api/jobs/$id")
    case "$one" in ERR*|'') continue ;; esac
    status=$(json_field "$one" job.status) || continue
    case "$status" in
      done|error|failed)
        echo "status:     $status  (${waited}s)"
        local err
        err=$(json_field "$one" job.error) && [ -n "$err" ] && echo "error:      $err"
        local meta="$PROJECT/data/out/${id}_meta.json"
        if [ -f "$meta" ]; then
          echo "sidecar:    data/out/${id}_meta.json"
          echo "--- sidecar ---"
          cat "$meta"
        else
          echo "sidecar:    NOT WRITTEN — if queue.ts was edited, --restart first (I2)"
        fi
        [ "$status" = "done" ] || exit 1
        return 0
        ;;
    esac
  done
  die "job $id has not finished after ${wait_s}s — check --status. Do not resubmit."
}

# ── dispatch ────────────────────────────────────────────────────────────────
[ "$#" -ge 1 ] || usage
case "$1" in
  --status)      cmd_status ;;
  --restart)     cmd_restart ;;
  --meta)        cmd_meta "${2:-}" ;;
  -h|--help)     usage ;;
  --*)           die "unknown command: $1 (try --help)" ;;
  *)             cmd_submit "$@" ;;
esac
