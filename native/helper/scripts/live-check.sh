#!/bin/bash
# Live checks of the built helper on this Mac (needs a GUI login session).
#
#   native/helper/scripts/live-check.sh [--watch 20] [--write-test]
#
# Starts build/dumbledore-helper on a private temporary socket (never the app's default socket),
# runs scripts/live_check.py against it and stops it again. The helper inherits this terminal's
# Accessibility / Screen Recording grants. Passive by default: windows and focus are read, nothing
# is typed or clicked and the clipboard is untouched; output is counts, timings and roles only.
# While the screen is locked the screen checks are skipped (perceive must return []).
# --watch N     also print helper events for N seconds (press right ⌥, switch apps, lock the screen)
# --write-test  manual only: writes one test line into the focused field after a 3 s countdown
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${HELPER_BIN:-$HERE/../build/dumbledore-helper}"
[ -x "$BIN" ] || { echo "build the helper first: native/helper/build.sh" >&2; exit 2; }

LOCKED=()
if ioreg -n Root -d1 | grep -q '"CGSSessionScreenIsLocked"=Yes'; then LOCKED=(--locked); fi

DIR="$(mktemp -d -t dh-live)"
SOCK="$DIR/h.sock"
"$BIN" serve --socket "$SOCK" --parent-pid $$ > "$DIR/stdout.log" 2> "$DIR/stderr.log" &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -rf "$DIR"
}
trap cleanup EXIT

for _ in $(seq 1 50); do
  grep -q '"ready":true' "$DIR/stdout.log" 2>/dev/null && break
  kill -0 "$PID" 2>/dev/null || { echo "helper exited early:" >&2; cat "$DIR/stderr.log" >&2; exit 1; }
  sleep 0.1
done
grep -q '"ready":true' "$DIR/stdout.log" || { echo "helper did not get ready" >&2; exit 1; }

STATUS=0
python3 -I "$HERE/live_check.py" "$SOCK" ${LOCKED[@]+"${LOCKED[@]}"} "$@" || STATUS=$?
if ! kill -0 "$PID" 2>/dev/null; then
  echo "FAIL helper died during the checks:" >&2
  tail -20 "$DIR/stderr.log" >&2
  STATUS=1
fi
exit "$STATUS"
