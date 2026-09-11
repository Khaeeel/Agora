#!/bin/bash
#
# hq-model.sh — the HQ chatbot's model: status, verify, download. Nothing else.
#
#   hq-model.sh status     GPU, vLLM image, pinned weights (by size), download state
#   hq-model.sh verify     every weight file's sha256 against models.lock, plus the
#                          GPU as seen from INSIDE the vLLM image
#   hq-model.sh download   fetch the pinned weights only if they do not verify;
#                          detached, so it outlives the turn. Watch with `status`.
#
# Why a wrapper: an agent asks Dominic for THIS script, never for a shell. It is
# granted from the room's Allow button (ASKABLE_WRAPPERS in orchestrator.ts).
# Its only write is the pinned model directory under HelloAlex-Local-Model/
# models/llm — models.lock, the compose files and every .env are never touched.
# It does not serve: vLLM on this 12 GB card needs host settings Dominic has
# not chosen yet.
#
# Exit: 0 ok, 1 a check failed, 64 usage, 70 could not run, 75 a download is
# already running.
set -uo pipefail

STACK=/mnt/c/Projects/HelloAlex-Local-Model
KEY=llm/Qwen3-4B-Instruct-2507
IMAGE=vllm/vllm-openai:v0.22.1
PY=$STACK/serving/.venv/bin/python
LOG=/tmp/hq-model-download.log
PIDFILE=/tmp/hq-model-download.pid
# The driver lives on Windows; WSL exposes it here, and a sandboxed PATH often
# lacks it — which is how an agent once concluded "no NVIDIA driver".
SMI=$(command -v nvidia-smi 2>/dev/null || echo /usr/lib/wsl/lib/nvidia-smi)

usage() { sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 64; }
[ -x "$PY" ] || { echo "hq-model.sh: stack python missing at $PY" >&2; exit 70; }

download_pid() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && cat "$PIDFILE"; }

gpu_host() {
  local out
  if out=$("$SMI" --query-gpu=name,driver_version,memory.used,memory.total --format=csv,noheader 2>/dev/null); then
    echo "GPU (host):   $out"
  else
    echo "GPU (host):   NOT VISIBLE via $SMI"; return 1
  fi
}

image() {
  local info
  if info=$(docker image inspect "$IMAGE" --format '{{.Id}} {{.Size}}' 2>/dev/null); then
    echo "Image:        $IMAGE present (${info:7:12}, $(( ${info##* } / 1000000000 )) GB)"
  else
    echo "Image:        $IMAGE MISSING"; return 1
  fi
}

# Full check: every file's sha256 against models.lock, through the stack's own
# modelctl code, rooted explicitly so a stray MODELS_ROOT cannot redirect it.
py_verify() {
  ( cd "$STACK/serving" && "$PY" - "$KEY" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, ".")
from modelctl.manifest import Manifest
from modelctl.paths import model_dir, resolve_root
from modelctl.checksums import verify_model
key = sys.argv[1]
entry = Manifest.loads(Path("models.lock").read_text()).get(key)
if entry is None:
    print(f"Weights:      {key} is not in models.lock"); sys.exit(1)
models = str(Path("..").resolve() / "models")
problems = verify_model(entry, model_dir(resolve_root(models, {}, default=models), entry))
for p in problems:
    print(f"  FAIL {p}")
verdict = "all files match models.lock" if not problems else f"{len(problems)} problem(s)"
print(f"Weights:      {key} @ {entry.revision[:12]} — {verdict}")
sys.exit(1 if problems else 0)
PY
  )
}

# Quick check for `status`: are the lock's files there at the lock's size.
py_quick() {
  ( cd "$STACK/serving" && "$PY" - "$KEY" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, ".")
from modelctl.manifest import Manifest
key = sys.argv[1]
e = Manifest.loads(Path("models.lock").read_text()).get(key)
d = Path("..").resolve() / "models" / key
missing = [f for f in e.files if not (d / f).is_file()]
size = sum((d / f).stat().st_size for f in e.files if (d / f).is_file())
state = ("complete by size" if not missing and size == e.size_bytes
         else f"{len(missing)} file(s) missing, {size} of {e.size_bytes} bytes")
print(f"Weights:      {key} — {state} (sha256: run `verify`)")
PY
  )
}

[ $# -eq 1 ] || usage
case "$1" in
  status)
    gpu_host; image; py_quick
    if P=$(download_pid); then
      echo "Download:     RUNNING (pid $P) · $(tail -1 "$LOG" 2>/dev/null)"
    elif [ -f "$LOG" ]; then
      echo "Download:     not running · last: $(tail -1 "$LOG")"
    else
      echo "Download:     never run from this script"
    fi
    C=$(docker ps --filter "ancestor=$IMAGE" --format '{{.Names}} {{.Status}}' 2>/dev/null)
    echo "Serving:      ${C:-no vLLM container running (this script does not serve)}"
    ;;
  verify)
    rc=0
    gpu_host || rc=1
    image || rc=1
    if out=$(timeout 90 docker run --rm --gpus all --entrypoint nvidia-smi "$IMAGE" \
               --query-gpu=name,memory.total --format=csv,noheader 2>&1); then
      echo "GPU (image):  $out"
    else
      echo "GPU (image):  FAILED — $(echo "$out" | tail -1)"; rc=1
    fi
    py_verify || rc=1
    exit $rc
    ;;
  download)
    if P=$(download_pid); then
      echo "A download is already running (pid $P). Watch it with: hq-model.sh status"; exit 75
    fi
    if py_verify >/dev/null 2>&1; then
      echo "Nothing to download — $KEY already matches models.lock."; py_verify; exit 0
    fi
    setsid nohup bash "$0" _download-worker >> "$LOG" 2>&1 < /dev/null &
    echo $! > "$PIDFILE"
    echo "Download started (pid $!), detached. Log: $LOG. Check with: hq-model.sh status"
    ;;
  _download-worker)
    echo "$(date '+%F %T') download start: $KEY"
    ( cd "$STACK/serving" && "$PY" - "$KEY" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, ".")
from modelctl.manifest import Manifest
from huggingface_hub import snapshot_download
key = sys.argv[1]
e = Manifest.loads(Path("models.lock").read_text()).get(key)
d = Path("..").resolve() / "models" / key
d.mkdir(parents=True, exist_ok=True)
snapshot_download(repo_id=e.repo, revision=e.revision, local_dir=str(d), allow_patterns=list(e.files))
print("snapshot done")
PY
    )
    echo "$(date '+%F %T') snapshot exit=$?"
    py_verify
    echo "$(date '+%F %T') verify exit=$?"
    rm -f "$PIDFILE"
    ;;
  *) usage ;;
esac
