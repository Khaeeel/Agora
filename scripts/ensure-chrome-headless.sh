#!/usr/bin/env bash
# Keep a detached headless Chrome on CDP so Agora's Computer tab stays live.
# Safe to re-run; no-ops when already up.
set -euo pipefail

PORT="${AGORA_CDP_PORT:-9222}"
PROFILE="${HOME}/agora/.chrome-profile"
LOG_DIR="${HOME}/agora/.logs"
LOG="${LOG_DIR}/chrome-headless.log"
BIN=$(ls -d "${HOME}"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)

if [[ -z "${BIN}" || ! -x "${BIN}" ]]; then
  echo "No chromium under ~/.cache/ms-playwright. Install: npx playwright install chromium" >&2
  exit 1
fi

if curl -s -m 2 "http://127.0.0.1:${PORT}/json/version" | grep -q webSocketDebuggerUrl; then
  echo "Chrome already on CDP :${PORT}"
  exit 0
fi

mkdir -p "${PROFILE}" "${LOG_DIR}"
nohup "${BIN}" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --disable-dev-shm-usage \
  --remote-debugging-port="${PORT}" \
  --user-data-dir="${PROFILE}" \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1440,900 \
  https://dev-app.helloalex.ai/ \
  >"${LOG}" 2>&1 &
echo "started pid=$! log=${LOG}"
sleep 2
if curl -s -m 3 "http://127.0.0.1:${PORT}/json/version" | grep -q webSocketDebuggerUrl; then
  echo "CDP ready on :${PORT}"
  exit 0
fi
echo "Chrome started but CDP not answering yet — check ${LOG}" >&2
exit 1
