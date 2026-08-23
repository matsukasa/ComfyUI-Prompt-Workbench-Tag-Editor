#!/usr/bin/env sh
set -u

cd "$(dirname "$0")" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm was not found. Install Node.js 20 or later."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "First-time setup: installing dependencies..."
  npm install --prefer-offline --no-audit --no-fund || {
    echo "[ERROR] Dependency installation failed."
    exit 1
  }
fi

TAG_EDITOR_URL="http://127.0.0.1:5173/"

open_url() {
  if command -v open >/dev/null 2>&1; then
    open "$TAG_EDITOR_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$TAG_EDITOR_URL" >/dev/null 2>&1 || true
  fi
}

if node -e "fetch(process.argv[1]).then(r=>process.exit(r.status >= 200 && r.status < 500 ? 0 : 1)).catch(()=>process.exit(1))" "$TAG_EDITOR_URL"; then
  echo "Tag Editor is already running. Opening $TAG_EDITOR_URL"
  open_url
  echo
  echo "If the browser still shows a black screen, reload without cache."
  exit 0
fi

echo "Starting ComfyUI Prompt Workbench Tag Editor..."
echo "Open $TAG_EDITOR_URL in your browser."
open_url
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
status=$?
if [ "$status" -ne 0 ]; then
  echo
  echo "[ERROR] Tag Editor could not start. Port 5173 may already be in use."
  echo "Close the old Tag Editor window or stop the old node process, then run ./start.sh again."
fi
exit "$status"
