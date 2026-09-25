#!/usr/bin/env bash
# Starts `pnpm demo:record` with a FIFO on stdin, waits until the stack is up, runs the live
# rehearsal spec (which sends the paycheck by writing "p" to the FIFO), then stops the stack.
# DEMO_SURFNET_PORT, DEMO_CORE_PORT, DEMO_DB_PORT and DEMO_WEB_PORT pass through to demo:record,
# and the spec follows DEMO_WEB_PORT and DEMO_CORE_PORT, e.g.
#   DEMO_WEB_PORT=3100 DEMO_DB_PORT=55432 tests/e2e/live/rehearse.sh
# DEMO_RECORD_ROOT runs demo:record from another checkout (default: this one); the spec and its
# evidence stay in this checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RECORD_ROOT="${DEMO_RECORD_ROOT:-$ROOT}"
WORK="$(mktemp -d)"
FIFO="$WORK/demo-record.in"
LOG="$WORK/demo-record.log"
READY_TIMEOUT_SECS=900

mkfifo "$FIFO"
sleep 99999 >"$FIFO" &
HOLDER=$!
(cd "$RECORD_ROOT" && pnpm demo:record <"$FIFO" >"$LOG" 2>&1) &
RECORD=$!

cleanup() {
  printf q >"$FIFO" 2>/dev/null || true
  sleep 5
  kill "$HOLDER" 2>/dev/null || true
  wait "$RECORD" 2>/dev/null || true
  echo "demo:record log: $LOG"
}
trap cleanup EXIT

waited=0
until grep -q "Demo is up" "$LOG"; do
  if ! kill -0 "$RECORD" 2>/dev/null; then
    cat "$LOG"
    exit 1
  fi
  if [ "$waited" -ge "$READY_TIMEOUT_SECS" ]; then
    echo "demo:record was not up after ${READY_TIMEOUT_SECS}s" >&2
    exit 1
  fi
  sleep 3
  waited=$((waited + 3))
done

DEMO_RECORD_INPUT="$FIFO" \
  E2E_BASE_URL="http://127.0.0.1:${DEMO_WEB_PORT:-3000}" \
  E2E_API_URL="http://127.0.0.1:${DEMO_CORE_PORT:-8787}" \
  pnpm --dir "$ROOT" e2e:live
