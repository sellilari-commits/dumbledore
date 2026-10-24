#!/bin/bash
# Builds Dumbledore.app (Swift helper + Electron app), signs it locally and installs it in
# /Applications, then starts it.
#
#   npm run install-app                 build, sign, install, start
#   npm run install-app -- --no-open    same, without starting it
#
# Env: SIGN_IDENTITY (default "-" = ad hoc). The helper runs as Dumbledore's child process, so
# the Accessibility / Screen Recording grants belong to Dumbledore.app. An ad-hoc signature changes
# with every build, so macOS stops honouring them after a rebuild (remove and re-add the app in
# System Settings); a stable identity keeps them (README → Run).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run package   # builds the Swift helper too

ARCH_DIR="release/mac-$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )"
[ -d "$ARCH_DIR" ] || ARCH_DIR="release/mac"
APP="$ARCH_DIR/Dumbledore.app"
HELPER="$APP/Contents/Library/LoginItems/Dumbledore Helper.app"
IDENTITY="${SIGN_IDENTITY:--}"

# Inside out: the whole bundle, then the helper with its own identifier, then the outer app again.
codesign --force --deep --sign "$IDENTITY" "$APP"
codesign --force --sign "$IDENTITY" --identifier org.stuhi.dumbledore.helper "$HELPER/Contents/MacOS/dumbledore-helper"
codesign --force --sign "$IDENTITY" --identifier org.stuhi.dumbledore.helper "$HELPER"
codesign --force --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"

osascript -e 'quit app "Dumbledore"' >/dev/null 2>&1 || true
sleep 1
pkill -f "/Applications/Dumbledore.app/Contents/MacOS/Dumbledore" >/dev/null 2>&1 || true
rm -rf /Applications/Dumbledore.app
ditto "$APP" /Applications/Dumbledore.app
echo "Installed /Applications/Dumbledore.app"

if [ "${1:-}" != "--no-open" ]; then
  open /Applications/Dumbledore.app
fi
